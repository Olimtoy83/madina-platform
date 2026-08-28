import { describe, expect, it, vi } from 'vitest'
import {
  ReportingReadService,
  type ReportingAllTimeSummary,
  type ReportingQueryRepository,
} from './index.js'

const summary: ReportingAllTimeSummary = {
  sales: { completedCount: 2 },
  financial: {
    totalIncome: 120,
    totalExpense: 50,
    financialBalance: 70,
    revenue: 100,
    purchaseExpense: 40,
  },
  inventory: {
    productCount: 3,
    activeProductCount: 2,
    stockByUnit: [{ unit: 'kg', quantity: 10 }],
  },
}

describe('ReportingReadService', () => {
  it('returns the repository all-time summary without materializing domain collections', async () => {
    const repository: ReportingQueryRepository = {
      getAllTimeSummary: vi.fn().mockResolvedValue(summary),
    }
    const service = new ReportingReadService(repository)

    await expect(service.getAllTimeSummary()).resolves.toBe(summary)
    expect(repository.getAllTimeSummary).toHaveBeenCalledTimes(1)
  })
})
