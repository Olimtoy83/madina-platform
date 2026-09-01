import type { RetailCapability } from '@madina/retail'
import { hasRetailCapability } from '@madina/retail'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'

export interface RetailLocationAccessRepository {
  findLocation(locationId: string): Promise<{ status: 'active' | 'inactive' } | undefined>
  hasActiveGrant(userId: string, locationId: string): Promise<boolean>
}

export function requireRetailLocationAccess(
  app: FastifyInstance,
  repository: RetailLocationAccessRepository,
  capability: RetailCapability,
  getLocationId: (request: FastifyRequest) => string | undefined,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const principal = await app.authenticateRequest(request)

    if (!principal) {
      reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required.',
      })
      return
    }

    if (!hasRetailCapability(principal.role, capability)) {
      reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Retail permission denied.',
      })
      return
    }

    const locationId = getLocationId(request)
    if (!locationId) {
      reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Retail Location identifier is required.',
      })
      return
    }

    const location = await repository.findLocation(locationId)
    if (!location || location.status !== 'active') {
      reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Active Retail Location access is required.',
      })
      return
    }

    if (!await repository.hasActiveGrant(principal.id, locationId)) {
      reply.code(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Active Retail Location access is required.',
      })
    }
  }
}
