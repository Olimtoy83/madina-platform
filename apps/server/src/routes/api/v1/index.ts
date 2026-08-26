import type { ApiV1Response } from '@madina/api'
import type { FastifyInstance } from 'fastify'
import { clientsRoutes } from './clients/index.js'

export async function apiV1Routes(app: FastifyInstance) {
  app.get('/', async (): Promise<ApiV1Response> => {
    return {
      version: 'v1',
    }
  })

  app.register(clientsRoutes, {
    prefix: '/clients',
  })
}
