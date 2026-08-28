import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { apiV1Routes } from './routes/api/v1/index.js'
import { healthRoutes } from './routes/health.js'

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
  const app = Fastify({
    logger: true,
    genReqId: () => randomUUID(),
  })

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
