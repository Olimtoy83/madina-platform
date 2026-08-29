import type {
  AccountingReport,
  AccountingReportQuery,
  IncomeReport,
  IncomeReportQuery,
  ReportingAllTimeSummary,
  ReportingQueryRepository,
  SalesReport,
  SalesReportQuery,
} from './ReportingQueryRepository.js'

export class ReportingReadService {
  private readonly repository: ReportingQueryRepository

  constructor(
    repository: ReportingQueryRepository,
  ) {
    this.repository = repository
  }

  async getAllTimeSummary(
    now?: Date,
  ): Promise<ReportingAllTimeSummary> {
    return this.repository.getAllTimeSummary(now)
  }

  async getIncomeReport(
    query: IncomeReportQuery,
    now?: Date,
  ): Promise<IncomeReport> {
    return this.repository.getIncomeReport(query, now)
  }

  async getAccountingReport(
    query: AccountingReportQuery,
  ): Promise<AccountingReport> {
    return this.repository.getAccountingReport(query)
  }

  async getSalesReport(query: SalesReportQuery): Promise<SalesReport> {
    return this.repository.getSalesReport(query)
  }
}
