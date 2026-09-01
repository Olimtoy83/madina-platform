import type { SqliteRetailAccessRepository } from '@madina/database'
import type { RetailCapability } from '@madina/retail'
import { hasRetailCapability } from '@madina/retail'
import type { FastifyPluginAsync } from 'fastify'
import { getAuthenticatedCommandContext, requireAuthentication, requireTrustedOrigin } from '../../../../plugins/authentication.js'
import { requireRetailLocationAccess } from '../../../../security/retailLocationAccess.js'

interface RetailRoutesOptions {
  retailAccessRepository?: SqliteRetailAccessRepository
}

function sendRetailPermissionError(reply: { code(statusCode: number): { send(payload: unknown): void } }): void {
  reply.code(403).send({
    statusCode: 403,
    error: 'Forbidden',
    message: 'Retail permission denied.',
  })
}

function hasRetailPermission(
  role: Parameters<typeof hasRetailCapability>[0],
  capability: RetailCapability,
): boolean {
  return hasRetailCapability(role, capability)
}

export const retailRoutes: FastifyPluginAsync<RetailRoutesOptions> = async (app, options) => {
  if (!options.retailAccessRepository) return
  const retailAccessRepository = options.retailAccessRepository

  app.get('/locations', { preHandler: requireAuthentication(app) }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:locations:read')) {
      sendRetailPermissionError(reply)
      return
    }
    const locations = principal.role === 'admin'
      ? await retailAccessRepository.listLocations()
      : await retailAccessRepository.listPermittedLocations(principal.id)
    return { locations }
  })

  app.get('/locations/:locationId', {
    preHandler: requireRetailLocationAccess(
      app,
      retailAccessRepository,
      'retail:locations:read',
      (request) => (request.params as { locationId?: string }).locationId,
    ),
  }, async (request) => {
    const locationId = (request.params as { locationId: string }).locationId
    return { location: await retailAccessRepository.findLocation(locationId) }
  })

  app.post('/locations', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:locations:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const body = request.body as Partial<{
      code: string
      name: string
      type: 'central_warehouse' | 'store'
      status: 'active' | 'inactive'
    }> | undefined
    if (!body || typeof body.code !== 'string' || !body.code.trim() ||
      typeof body.name !== 'string' || !body.name.trim() ||
      (body.type !== 'central_warehouse' && body.type !== 'store')) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail Location input is invalid.' }
    }
    const location = await retailAccessRepository.createLocation({
      code: body.code.trim(),
      name: body.name.trim(),
      type: body.type,
      status: body.status === 'inactive' ? 'inactive' : 'active',
    }, getAuthenticatedCommandContext(request))
    reply.code(201)
    return { location }
  })

  app.post('/locations/:locationId/grants', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:access:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const body = request.body as { userId?: string } | undefined
    const locationId = (request.params as { locationId?: string }).locationId
    if (!body || typeof body.userId !== 'string' || body.userId !== body.userId.trim() ||
      !body.userId || !locationId) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail grant input is invalid.' }
    }
    await retailAccessRepository.grant(body.userId, locationId, getAuthenticatedCommandContext(request))
    return { success: true }
  })

  app.delete('/locations/:locationId/grants/:userId', { preHandler: [requireAuthentication(app), requireTrustedOrigin()] }, async (request, reply) => {
    const principal = await app.authenticateRequest(request)
    if (!principal) return
    if (!hasRetailPermission(principal.role, 'retail:access:manage')) {
      sendRetailPermissionError(reply)
      return
    }
    const { locationId, userId } = request.params as {
      locationId?: string
      userId?: string
    }
    if (!locationId || !userId) {
      reply.code(400)
      return { statusCode: 400, error: 'Bad Request', message: 'Retail grant input is invalid.' }
    }
    try {
      await retailAccessRepository.revoke(userId, locationId, getAuthenticatedCommandContext(request))
      return { success: true }
    } catch {
      reply.code(404)
      return { statusCode: 404, error: 'Not Found', message: 'Active Retail Location grant not found.' }
    }
  })
}
