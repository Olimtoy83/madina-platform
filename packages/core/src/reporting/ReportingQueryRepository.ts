import type { ProductUnit } from '../inventory/index.js'

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

export interface ReportingQueryRepository {
  getAllTimeSummary(now?: Date): Promise<ReportingAllTimeSummary>
}
