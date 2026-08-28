import { describe, expect, it } from 'vitest'
import { toDashboardKpis } from './dashboardSummary'

describe('toDashboardKpis', () => {
  it('maps every Dashboard KPI from the server reporting summary', () => {
    expect(toDashboardKpis({
      sales: { completedCount: 7 },
      financial: {
        totalIncome: 900,
        totalExpense: 300,
        financialBalance: 600,
        revenue: 700,
        purchaseExpense: 250,
      },
      inventory: {
        productCount: 3,
        activeProductCount: 2,
        stockByUnit: [
          { unit: 'box', quantity: 4 },
          { unit: 'kg', quantity: 12 },
        ],
      },
    })).toEqual({
      completedSalesCount: 7,
      totalIncome: 900,
      totalExpense: 300,
      financialBalance: 600,
      productCount: 3,
      stockByUnit: [
        { unit: 'box', quantity: 4 },
        { unit: 'kg', quantity: 12 },
      ],
    })
  })
})
