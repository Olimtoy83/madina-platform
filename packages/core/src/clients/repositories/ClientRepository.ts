import type { Client } from '../types/client'
import type { AuditEvent } from '@madina/shared'

export interface ClientReadRepository {
  findAll(): Promise<Client[]>
  findById(
    clientId: string,
  ): Promise<Client | undefined>
}

export interface ClientUnitOfWork
  extends ClientReadRepository {
  save(
    client: Client,
  ): Promise<void>
  update(
    client: Client,
  ): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
}

export interface ClientRepository
  extends ClientReadRepository {
  withTransaction<T>(
    operation: (
      unitOfWork: ClientUnitOfWork,
    ) => Promise<T>,
  ): Promise<T>
}
