import type {
  ApiErrorResponse,
  AuditEventsListQuery,
  AuditEventsListResponse,
} from '@madina/api'
import type { FastifyInstance } from 'fastify'
import {
  requirePermission,
} from '../../../../plugins/authentication.js'
import {
  AuditReadService,
  AuditReadValidationError,
} from '../../../../services/AuditReadService.js'

interface AuditRoutesOptions {
  auditReadService: AuditReadService
}

function badRequestResponse(message: string): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message,
  }
}

export async function auditRoutes(
  app: FastifyInstance,
  options: AuditRoutesOptions,
) {
  app.get<{
    Querystring: AuditEventsListQuery
  }>(
    '/events',
    {
      preHandler: requirePermission(app, 'audit:read'),
    },
    async (request, reply): Promise<AuditEventsListResponse | ApiErrorResponse> => {
      try {
        return await options.auditReadService.listEvents(request.query)
      } catch (error) {
        if (error instanceof AuditReadValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }

        throw error
      }
    },
  )
}
