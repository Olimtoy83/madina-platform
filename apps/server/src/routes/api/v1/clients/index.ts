import type {
  ClientResponse,
  ClientsListResponse,
} from '@madina/api'
import type {
  Client,
  ClientRepository,
} from '@madina/core'
import { InMemoryClientRepository } from '@madina/database'
import type { FastifyInstance } from 'fastify'

interface ClientsRoutesOptions {
  clientRepository?: ClientRepository
}

function toClientResponse(
  client: Client,
): ClientResponse {
  return {
    ...client,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  }
}

export async function clientsRoutes(
  app: FastifyInstance,
  options: ClientsRoutesOptions = {},
) {
  const clientRepository =
    options.clientRepository ??
    new InMemoryClientRepository()

  app.get(
    '/',
    async (): Promise<ClientsListResponse> => {
      const clients =
        await clientRepository.findAll()

      return {
        clients: clients.map(toClientResponse),
      }
    },
  )
}
