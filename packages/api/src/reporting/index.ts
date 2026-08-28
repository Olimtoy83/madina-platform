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
