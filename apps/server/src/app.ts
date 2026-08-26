import type { HealthResponse } from '@madina/api'
import Fastify from 'fastify'

export function buildApp() {
  const app = Fastify({
    logger: true,
  })

  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
    }
  })

  return app
}