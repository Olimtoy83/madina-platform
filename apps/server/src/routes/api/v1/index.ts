import type { ApiV1Response } from '@madina/api'
import {
  AuthService,
  UserManagementService,
} from '@madina/auth'
import {
  ClientMutationService,
  CommerceService,
  ReportingReadService,
  StockMovementReadService,
  TaskMutationService,
} from '@madina/core'
import {
  SqliteAuthRepository,
  SqliteAuditQueryRepository,
  SqliteClientRepository,
  SqliteCommerceRepository,
  SqliteReportingQueryRepository,
  SqliteTaskRepository,
  initializeDatabase,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import {
  ensureDatabaseDirectory,
  getDatabaseFile,
} from '../../../database.js'
import { authenticationPlugin } from '../../../plugins/authentication.js'
import { LoginRateLimiter } from '../../../security/LoginRateLimiter.js'
import { AuditReadService } from '../../../services/AuditReadService.js'
import { auditRoutes } from './audit/index.js'
import { authRoutes } from './auth/index.js'
import { clientsRoutes } from './clients/index.js'
import { commerceRoutes } from './commerce/index.js'
import { reportingRoutes } from './reporting/index.js'
import { tasksRoutes } from './tasks/index.js'

export async function apiV1Routes(
  app: FastifyInstance,
) {
  const databaseFile = getDatabaseFile()

  ensureDatabaseDirectory(databaseFile)
  initializeDatabase(databaseFile)

  const clientRepository =
    new SqliteClientRepository(databaseFile)
  const clientMutationService = new ClientMutationService(
    clientRepository,
  )

  const authRepository =
    new SqliteAuthRepository(databaseFile)
  const auditQueryRepository =
    new SqliteAuditQueryRepository(databaseFile)

  const authService = new AuthService(authRepository)
  // Fastify has no trustProxy configuration here, so request.ip remains the
  // direct peer address rather than an untrusted X-Forwarded-For value.
  const loginRateLimiter = new LoginRateLimiter()
  const userManagementService = new UserManagementService(
    authRepository,
  )
  const auditReadService = new AuditReadService(auditQueryRepository)

  const taskRepository =
    new SqliteTaskRepository(databaseFile)
  const taskMutationService = new TaskMutationService(
    taskRepository,
  )

  const commerceRepository =
    new SqliteCommerceRepository(databaseFile)

  const reportingQueryRepository =
    new SqliteReportingQueryRepository(databaseFile)

  const commerceService = new CommerceService(
    commerceRepository,
  )
  const stockMovementReadService = new StockMovementReadService(
    commerceRepository,
  )
  const reportingReadService = new ReportingReadService(
    reportingQueryRepository,
  )

  app.addHook('onClose', async () => {
    authRepository.close()
    auditQueryRepository.close()
    clientRepository.close()
    commerceRepository.close()
    reportingQueryRepository.close()
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
    loginRateLimiter,
    userManagementService,
  })

  app.register(auditRoutes, {
    prefix: '/audit',
    auditReadService,
  })

  app.register(clientsRoutes, {
    prefix: '/clients',
    clientRepository,
    clientMutationService,
  })

  app.register(tasksRoutes, {
    prefix: '/tasks',
    taskRepository,
    taskMutationService,
  })

  app.register(commerceRoutes, {
    prefix: '/commerce',
    commerceRepository,
    commerceService,
    stockMovementReadService,
  })

  app.register(reportingRoutes, {
    prefix: '/reports',
    reportingReadService,
  })
}
