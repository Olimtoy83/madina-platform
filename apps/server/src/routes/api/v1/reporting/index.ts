import type { ReportingSummaryResponse } from '@madina/api'
import type { ReportingReadService } from '@madina/core'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../../../plugins/authentication.js'

interface ReportingRoutesOptions {
  reportingReadService: ReportingReadService
}

export async function reportingRoutes(
  app: FastifyInstance,
  options: ReportingRoutesOptions,
) {
  app.get(
    '/summary',
    {
      preHandler: requirePermission(app, 'reports:read'),
    },
    async (): Promise<ReportingSummaryResponse> =>
      options.reportingReadService.getAllTimeSummary(),
  )
}
