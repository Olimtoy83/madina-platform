import type {
  HealthResponse,
  ReadinessResponse,
} from '@madina/api'
import type { FastifyInstance } from 'fastify'
import { DatabaseSync } from 'node:sqlite'
import { getDatabaseFile } from '../database.js'

export interface HealthRouteOptions {
  getDatabaseFile?: () => string
}

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions = {},
) {
  const databaseFile = options.getDatabaseFile ?? getDatabaseFile

  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
    }
  })

  app.get('/ready', async (_, reply): Promise<ReadinessResponse> => {
    try {
      const database = new DatabaseSync(databaseFile(), { readOnly: true })
      try {
        database.prepare('SELECT 1').get()
      } finally {
        database.close()
      }

      return { status: 'ready' }
    } catch {
      reply.code(503)
      return { status: 'not_ready' }
    }
  })
}
