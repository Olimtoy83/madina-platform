import type {
  IncomeReport,
  IncomeReportQuery,
  ReportingAllTimeSummary,
  ReportingQueryRepository,
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
}
