import type { HealthResponse } from '@madina/api'
import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
    }
  })
}