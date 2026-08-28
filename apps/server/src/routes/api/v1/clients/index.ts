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
  ClientMutationService,
  ClientNotFoundError,
  ClientValidationError,
  type Client,
  type ClientRepository,
} from '@madina/core'
import type { FastifyInstance } from 'fastify'
import {
  getAuthenticatedCommandContext,
  requirePermission,
  requireTrustedOrigin,
} from '../../../../plugins/authentication.js'

interface ClientsRoutesOptions {
  clientRepository: ClientRepository
  clientMutationService: ClientMutationService
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

function isClientValidationError(
  error: unknown,
): error is ClientValidationError {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ClientValidationError' &&
    'message' in error &&
    typeof error.message === 'string'
}

export async function clientsRoutes(
  app: FastifyInstance,
  options: ClientsRoutesOptions,
) {
  const {
    clientRepository,
    clientMutationService,
  } = options

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
        const client = await clientMutationService.create(
          request.body,
          getAuthenticatedCommandContext(request),
        )

        reply.code(201)

        return toClientResponse(client)
      } catch (error) {
        if (isClientValidationError(error)) {
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

        return await clientMutationService.import(
          clients,
          getAuthenticatedCommandContext(request),
        )
      } catch (error) {
        if (isClientValidationError(error)) {
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
      try {
        const updatedClient = await clientMutationService.update(
          request.params.clientId,
          request.body,
          getAuthenticatedCommandContext(request),
        )

        return toClientResponse(updatedClient)
      } catch (error) {
        if (error instanceof ClientNotFoundError) {
          reply.code(404)
          return {
            statusCode: 404,
            error: 'Not Found',
            message: error.message,
          }
        }
        if (isClientValidationError(error)) {
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
