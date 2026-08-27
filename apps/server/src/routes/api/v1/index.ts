import { mkdirSync } from 'node:fs'
import {
  dirname,
  resolve,
} from 'node:path'
import type { ApiV1Response } from '@madina/api'
import { CommerceService } from '@madina/core'
import {
  SqliteClientRepository,
  SqliteCommerceRepository,
  SqliteTaskRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { clientsRoutes } from './clients/index.js'
import { commerceRoutes } from './commerce/index.js'
import { tasksRoutes } from './tasks/index.js'

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

  const taskRepository =
    new SqliteTaskRepository(databaseFile)

  const commerceRepository =
    new SqliteCommerceRepository(databaseFile)

  const commerceService = new CommerceService(
    commerceRepository,
  )

  app.addHook('onClose', async () => {
    clientRepository.close()
    commerceRepository.close()
    taskRepository.close()
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

  app.register(tasksRoutes, {
    prefix: '/tasks',
    taskRepository,
  })

  app.register(commerceRoutes, {
    prefix: '/commerce',
    commerceRepository,
    commerceService,
  })
}
