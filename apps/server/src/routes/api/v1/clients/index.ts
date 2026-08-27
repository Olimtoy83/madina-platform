import type {
  ApiErrorResponse,
  ClientResponse,
  ClientsListResponse,
  CreateClientRequest,
  ImportClientsRequest,
  ImportClientsResponse,
  UpdateClientRequest,
} from '@madina/api'
import {
  ClientValidationError,
  createClient,
  updateClient,
  type Client,
  type ClientRepository,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'
import {
  requirePermission,
  requireTrustedOrigin,
} from '../../../../plugins/authentication.js'

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
    {
      preHandler: requirePermission(app, 'clients:read'),
    },
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
    {
      preHandler: [
        requirePermission(app, 'clients:write'),
        requireTrustedOrigin(),
      ],
    },
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

  app.post<{
    Body: ImportClientsRequest
  }>(
    '/import',
    {
      preHandler: [
        requirePermission(app, 'data:import'),
        requireTrustedOrigin(),
      ],
    },
    async (
      request,
      reply,
    ): Promise<
      ImportClientsResponse | ApiErrorResponse
    > => {
      try {
        const clients = request.body.clients.map(
          (input): Client => {
            const id = input.id.trim()
            const name = input.name.trim()
            const createdAt = new Date(
              input.createdAt,
            )
            const updatedAt = new Date(
              input.updatedAt,
            )

            if (!id) {
              throw new ClientValidationError(
                'Client id is required.',
              )
            }

            if (!name) {
              throw new ClientValidationError(
                'Имя клиента обязательно.',
              )
            }

            if (
              Number.isNaN(createdAt.getTime()) ||
              Number.isNaN(updatedAt.getTime())
            ) {
              throw new ClientValidationError(
                'Client dates are invalid.',
              )
            }

            if (
              input.status !== 'active' &&
              input.status !== 'inactive'
            ) {
              throw new ClientValidationError(
                'Client status is invalid.',
              )
            }

            return {
              id,
              createdAt,
              updatedAt,
              name,
              phone: input.phone?.trim() ||
                undefined,
              email: input.email?.trim() ||
                undefined,
              company: input.company?.trim() ||
                undefined,
              note: input.note?.trim() ||
                undefined,
              status: input.status,
            }
          },
        )

        let created = 0
        let updated = 0

        for (const client of clients) {
          const existing =
            await clientRepository.findById(
              client.id,
            )

          if (existing) {
            await clientRepository.update(client)
            updated += 1
          } else {
            await clientRepository.save(client)
            created += 1
          }
        }

        return {
          created,
          updated,
        }
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

  app.patch<{
    Params: ClientParams
    Body: UpdateClientRequest
  }>(
    '/:clientId',
    {
      preHandler: [
        requirePermission(app, 'clients:write'),
        requireTrustedOrigin(),
      ],
    },
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

      try {
        const updatedClient = updateClient(
          client,
          request.body,
        )

        await clientRepository.update(
          updatedClient,
        )

        return toClientResponse(updatedClient)
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
    {
      preHandler: requirePermission(app, 'clients:read'),
    },
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
