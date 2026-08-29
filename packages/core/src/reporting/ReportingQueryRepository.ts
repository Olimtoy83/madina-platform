import type { ProductUnit } from '../inventory/index.js'
import type { SaleStatus } from '../sales/index.js'
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

export type AccountingReportPeriod =
  | 'all'
  | 'today'
  | '7days'
  | 'month'

export interface AccountingReportWindow {
  from?: Date
  to: Date
}

export interface AccountingReportQuery {
  period: AccountingReportPeriod
  type?: TransactionType
  limit: number
  window: AccountingReportWindow
  cursor?: {
    transactionDate: Date
    id: string
  }
}

export interface AccountingReport {
  summary: {
    totalIncome: number
    totalExpense: number
    financialBalance: number
    transactionCount: number
  }
  categories: Record<Transaction['category'], number>
  transactions: Transaction[]
}

export type SalesReportPeriod = AccountingReportPeriod

export interface SalesReportQuery {
  period: SalesReportPeriod
  window: AccountingReportWindow
}

export interface SalesReport {
  period: SalesReportPeriod
  statusCounts: Record<SaleStatus, number>
  completedAmount: number
}

export interface ReportingQueryRepository {
  getAllTimeSummary(now?: Date): Promise<ReportingAllTimeSummary>
  getIncomeReport(
    query: IncomeReportQuery,
    now?: Date,
  ): Promise<IncomeReport>
  getAccountingReport(
    query: AccountingReportQuery,
  ): Promise<AccountingReport>
  getSalesReport(query: SalesReportQuery): Promise<SalesReport>
}
