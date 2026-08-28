import type { ProductUnit } from '../inventory/index.js'
import type {
  Transaction,
  TransactionType,
} from '../transactions/index.js'

export interface ReportingStockByUnit {
  unit: ProductUnit
  quantity: number
}

export interface ReportingAllTimeSummary {
  sales: {
    completedCount: number
  }
  financial: {
    totalIncome: number
    totalExpense: number
    financialBalance: number
    revenue: number
    purchaseExpense: number
  }
  inventory: {
    productCount: number
    activeProductCount: number
    stockByUnit: ReportingStockByUnit[]
  }
}

export interface IncomeReportQuery {
  limit: number
  type?: TransactionType
  cursor?: {
    transactionDate: Date
    id: string
  }
}

export interface IncomeReport {
  summary: Pick<
    ReportingAllTimeSummary['financial'],
    'totalIncome' | 'totalExpense' | 'financialBalance'
  >
  transactions: Transaction[]
}

export interface ReportingQueryRepository {
  getAllTimeSummary(now?: Date): Promise<ReportingAllTimeSummary>
  getIncomeReport(
    query: IncomeReportQuery,
    now?: Date,
  ): Promise<IncomeReport>
}
