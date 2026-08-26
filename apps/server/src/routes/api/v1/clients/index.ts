import type {
  ClientResponse,
  ClientsListResponse,
} from '@madina/api'
import { InMemoryClientRepository } from '@madina/database'
import type { FastifyInstance } from 'fastify'

const clientRepository =
  new InMemoryClientRepository()

function toClientResponse(
  client: Awaited<
    ReturnType<typeof clientRepository.findAll>
  >[number],
): ClientResponse {
  return {
    ...client,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  }
}

export async function clientsRoutes(
  app: FastifyInstance,
) {
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
