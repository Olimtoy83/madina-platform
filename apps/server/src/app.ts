import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { apiV1Routes } from './routes/api/v1/index.js'
import { healthRoutes } from './routes/health.js'

export function buildApp() {
  const app = Fastify({
    logger: true,
  })

  app.register(cookie)
  app.register(healthRoutes)
  app.register(apiV1Routes, {
    prefix: '/api/v1',
  })

  return app
}
