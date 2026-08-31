import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { apiV1Routes } from './routes/api/v1/index.js'
import { healthRoutes } from './routes/health.js'
import { GlobalRateLimiter } from './security/GlobalRateLimiter.js'
import {
  installProductionSecurity,
  logRedactionPaths,
} from './security/productionSecurity.js'
import { firstPilotTrustedProxyAddresses } from './security/trustedProxy.js'

export const productWorkbookMultipartLimits = {
  fieldNameSize: 100,
  fieldSize: 1_024,
  fields: 0,
  fileSize: 10 * 1_024 * 1_024,
  files: 1,
  headerPairs: 20,
  parts: 1,
} as const

export function buildApp() {
  const isProduction = process.env.NODE_ENV === 'production'
  const globalRateLimiter = new GlobalRateLimiter()
  const app = Fastify({
    logger: {
      redact: {
        paths: [...logRedactionPaths],
        censor: '[REDACTED]',
      },
    },
    genReqId: () => randomUUID(),
    trustProxy: isProduction
      ? [...firstPilotTrustedProxyAddresses]
      : false,
  })

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/ready') return

    const limit = globalRateLimiter.check(request.ip)
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfterSeconds))
      reply.code(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests. Try again later.',
      })
      return reply
    }

    globalRateLimiter.record(request.ip)
  })

  installProductionSecurity(app, isProduction)

  app.register(cookie)
  app.register(multipart, {
    limits: productWorkbookMultipartLimits,
    throwFileSizeLimit: true,
  })
  app.register(healthRoutes)
  app.register(apiV1Routes, {
    prefix: '/api/v1',
  })

  return app
}
