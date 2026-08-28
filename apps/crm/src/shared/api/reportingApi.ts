import type { ReportingSummaryResponse } from '@madina/api'
import { requestJson } from './httpClient'

const reportingUrl = '/api/v1/reports'

export function getReportingSummary(): Promise<ReportingSummaryResponse> {
  return requestJson<ReportingSummaryResponse>(
    `${reportingUrl}/summary`,
  )
}
