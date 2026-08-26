import type { ApiV1Response } from '@madina/api'
import type { FastifyInstance } from 'fastify'

export async function apiV1Routes(app: FastifyInstance) {
  app.get('/', async (): Promise<ApiV1Response> => {
    return {
      version: 'v1',
    }
  })
}
