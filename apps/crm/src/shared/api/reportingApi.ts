import type {
  IncomeReportQuery,
  IncomeReportResponse,
  ReportingSummaryResponse,
} from '@madina/api'
import { requestJson } from './httpClient'

const reportingUrl = '/api/v1/reports'

export function getReportingSummary(): Promise<ReportingSummaryResponse> {
  return requestJson<ReportingSummaryResponse>(
    `${reportingUrl}/summary`,
  )
}

export interface IncomeReportRequest {
  type?: IncomeReportQuery['type']
  limit?: number
  cursor?: string
}

export function getIncomeReport(
  input: IncomeReportRequest = {},
): Promise<IncomeReportResponse> {
  const searchParams = new URLSearchParams()

  if (input.type) {
    searchParams.set('type', input.type)
  }

  if (input.limit !== undefined) {
    searchParams.set('limit', String(input.limit))
  }

  if (input.cursor) {
    searchParams.set('cursor', input.cursor)
  }

  const query = searchParams.toString()
  const url = query
    ? `${reportingUrl}/income?${query}`
    : `${reportingUrl}/income`

  return requestJson<IncomeReportResponse>(url)
}
