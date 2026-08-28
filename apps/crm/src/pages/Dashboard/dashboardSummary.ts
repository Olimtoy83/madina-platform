import type { ReportingSummaryResponse } from '@madina/api'

export interface DashboardKpis {
  completedSalesCount: number
  totalIncome: number
  totalExpense: number
  financialBalance: number
  productCount: number
  stockByUnit: ReportingSummaryResponse['inventory']['stockByUnit']
}

export function toDashboardKpis(
  summary: ReportingSummaryResponse,
): DashboardKpis {
  return {
    completedSalesCount: summary.sales.completedCount,
    totalIncome: summary.financial.totalIncome,
    totalExpense: summary.financial.totalExpense,
    financialBalance: summary.financial.financialBalance,
    productCount: summary.inventory.productCount,
    stockByUnit: summary.inventory.stockByUnit,
  }
}
