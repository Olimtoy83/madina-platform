import type {
  CommandContext,
} from '@madina/shared'
import type {
  ClientRepository,
  ClientUnitOfWork,
} from '../repositories/ClientRepository.js'
import type { Client } from '../types/client.js'
import {
  createClient,
  ClientValidationError,
  type CreateClientInput,
  updateClient,
  type UpdateClientInput,
} from './ClientService.js'

export class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
  }
}

export interface ClientImportResult {
  created: number
  updated: number
}

export class ClientMutationService {
  private readonly repository: ClientRepository

  constructor(
    repository: ClientRepository,
  ) {
    this.repository = repository
  }

  async create(
    input: CreateClientInput,
    context: CommandContext,
  ): Promise<Client> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const client = createClient(input)
      await unitOfWork.save(client)
      await appendClientAudit(unitOfWork, context, 'client.created', client.id)
      return client
    })
  }

  async update(
    clientId: string,
    updates: UpdateClientInput,
    context: CommandContext,
  ): Promise<Client> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const client = await unitOfWork.findById(clientId)
      if (!client) throw new ClientNotFoundError()

      const updatedClient = updateClient(client, updates)
      await unitOfWork.update(updatedClient)
      const statusChanged = client.status !== updatedClient.status
      const hasNonStatusUpdates = Object.keys(updates).some(
        (field) => field !== 'status',
      )

      if (hasNonStatusUpdates || !statusChanged) {
        await appendClientAudit(unitOfWork, context, 'client.updated', updatedClient.id)
      }
      if (statusChanged) {
        await appendClientAudit(unitOfWork, context, 'client.status_changed', updatedClient.id)
      }
      return updatedClient
    })
  }

  async import(
    clients: readonly Client[],
    context: CommandContext,
  ): Promise<ClientImportResult> {
    assertUniqueClientIds(clients)
    return this.repository.withTransaction(async (unitOfWork) => {
      let created = 0
      let updated = 0
      for (const client of clients) {
        if (await unitOfWork.findById(client.id)) {
          await unitOfWork.update(client)
          updated += 1
        } else {
          await unitOfWork.save(client)
          created += 1
        }
      }
      await appendClientAudit(unitOfWork, context, 'clients.imported', 'clients-import', {
        created,
        updated,
        total: clients.length,
      })
      return { created, updated }
    })
  }
}

function assertUniqueClientIds(clients: readonly Client[]): void {
  const ids = new Set<string>()
  for (const client of clients) {
    if (ids.has(client.id)) {
      throw new ClientValidationError(
        `Duplicate client id: ${client.id}`,
      )
    }
    ids.add(client.id)
  }
}

async function appendClientAudit(
  unitOfWork: ClientUnitOfWork,
  context: CommandContext,
  action: 'client.created' | 'client.updated' | 'client.status_changed' | 'clients.imported',
  entityId: string,
  metadata?: { created: number; updated: number; total: number },
): Promise<void> {
  await unitOfWork.appendAuditEvent({
    id: crypto.randomUUID(),
    occurredAt: new Date(),
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    domain: 'clients',
    action,
    entityType: action === 'clients.imported' ? 'client_import' : 'client',
    entityId,
    metadata,
  })
}
