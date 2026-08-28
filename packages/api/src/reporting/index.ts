export interface ReportingStockByUnitResponse {
  unit: 'kg' | 'piece' | 'liter' | 'box'
  quantity: number
}

export interface ReportingSummaryResponse {
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
    stockByUnit: ReportingStockByUnitResponse[]
  }
}

export type IncomeReportTransactionType =
  | 'income'
  | 'expense'

export interface IncomeReportQuery {
  type?: IncomeReportTransactionType
  limit?: string
  cursor?: string
}

export interface FinancialTransactionRowResponse {
  id: string
  type: IncomeReportTransactionType
  category: 'sale' | 'purchase' | 'other'
  amount: number
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'other'
  transactionDate: string
  description?: string
  status: 'completed'
}

export interface IncomeReportResponse {
  summary: {
    totalIncome: number
    totalExpense: number
    financialBalance: number
  }
  transactions: {
    items: FinancialTransactionRowResponse[]
    nextCursor?: string
  }
}

export type AccountingReportPeriod =
  | 'all'
  | 'today'
  | '7days'
  | 'month'

export interface AccountingReportQuery {
  period?: AccountingReportPeriod
  type?: IncomeReportTransactionType
  limit?: string
  cursor?: string
}

export interface AccountingReportResponse {
  summary: {
    totalIncome: number
    totalExpense: number
    financialBalance: number
    transactionCount: number
  }
  categories: {
    sale: number
    purchase: number
    other: number
  }
  transactions: {
    items: FinancialTransactionRowResponse[]
    nextCursor?: string
  }
}
