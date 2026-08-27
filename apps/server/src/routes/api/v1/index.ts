import type { ApiV1Response } from '@madina/api'
import { AuthService } from '@madina/auth'
import { CommerceService } from '@madina/core'
import {
  SqliteAuthRepository,
  SqliteClientRepository,
  SqliteCommerceRepository,
  SqliteTaskRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import {
  ensureDatabaseDirectory,
  getDatabaseFile,
} from '../../../database.js'
import { authenticationPlugin } from '../../../plugins/authentication.js'
import { authRoutes } from './auth/index.js'
import { clientsRoutes } from './clients/index.js'
import { commerceRoutes } from './commerce/index.js'
import { tasksRoutes } from './tasks/index.js'

export async function apiV1Routes(
  app: FastifyInstance,
) {
  const databaseFile = getDatabaseFile()

  ensureDatabaseDirectory(databaseFile)

  const clientRepository =
    new SqliteClientRepository(databaseFile)

  const authRepository =
    new SqliteAuthRepository(databaseFile)

  const authService = new AuthService(authRepository)

  const taskRepository =
    new SqliteTaskRepository(databaseFile)

  const commerceRepository =
    new SqliteCommerceRepository(databaseFile)

  const commerceService = new CommerceService(
    commerceRepository,
  )

  app.addHook('onClose', async () => {
    authRepository.close()
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

  await authenticationPlugin(app, {
    authService,
  })

  app.register(authRoutes, {
    prefix: '/auth',
    authService,
  })

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
