import type {
  ApiErrorResponse,
  ClientResponse,
  ClientsListResponse,
  CreateClientRequest,
} from '@madina/api'
import {
  ClientValidationError,
  createClient,
  type Client,
  type ClientRepository,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'

interface ClientsRoutesOptions {
  clientRepository: ClientRepository
}

interface ClientParams {
  clientId: string
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
  options: ClientsRoutesOptions,
) {
  const { clientRepository } = options

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

  app.post<{
    Body: CreateClientRequest
  }>(
    '/',
    async (
      request,
      reply,
    ): Promise<
      ClientResponse | ApiErrorResponse
    > => {
      try {
        const client = createClient(
          request.body,
        )

        await clientRepository.save(client)

        reply.code(201)

        return toClientResponse(client)
      } catch (error) {
        if (
          error instanceof
          ClientValidationError
        ) {
          reply.code(400)

          return {
            statusCode: 400,
            error: 'Bad Request',
            message: error.message,
          }
        }

        throw error
      }
    },
  )

  app.get<{
    Params: ClientParams
  }>(
    '/:clientId',
    async (
      request,
      reply,
    ): Promise<
      ClientResponse | ApiErrorResponse
    > => {
      const client =
        await clientRepository.findById(
          request.params.clientId,
        )

      if (!client) {
        reply.code(404)

        return {
          statusCode: 404,
          error: 'Not Found',
          message: 'Client not found',
        }
      }

      return toClientResponse(client)
    },
  )
}
