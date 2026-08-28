import type {
  AccountingReportPeriod,
  AccountingReportQuery,
  AccountingReportResponse,
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

export interface AccountingReportRequest {
  period?: AccountingReportPeriod
  type?: AccountingReportQuery['type']
  limit?: number
  cursor?: string
}

export function getAccountingReport(
  input: AccountingReportRequest = {},
): Promise<AccountingReportResponse> {
  const searchParams = new URLSearchParams()

  if (input.period) {
    searchParams.set('period', input.period)
  }

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
    ? `${reportingUrl}/accounting?${query}`
    : `${reportingUrl}/accounting`

  return requestJson<AccountingReportResponse>(url)
}
