import { mkdirSync } from 'node:fs'
import {
  dirname,
  resolve,
} from 'node:path'
import type { ApiV1Response } from '@madina/api'
import { SqliteClientRepository } from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { clientsRoutes } from './clients/index.js'

function getDatabaseFile(): string {
  return (
    process.env.DATABASE_FILE ??
    resolve(
      process.cwd(),
      'data',
      'madina.sqlite',
    )
  )
}

export async function apiV1Routes(
  app: FastifyInstance,
) {
  const databaseFile = getDatabaseFile()

  mkdirSync(
    dirname(databaseFile),
    {
      recursive: true,
    },
  )

  const clientRepository =
    new SqliteClientRepository(databaseFile)

  app.addHook('onClose', async () => {
    clientRepository.close()
  })

  app.get(
    '/',
    async (): Promise<ApiV1Response> => {
      return {
        version: 'v1',
      }
    },
  )

  app.register(clientsRoutes, {
    prefix: '/clients',
    clientRepository,
  })
}
