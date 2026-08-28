import { describe, expect, it, vi } from 'vitest'
import {
  ReportingReadService,
  type ReportingAllTimeSummary,
  type IncomeReport,
  type AccountingReport,
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

const incomeReport: IncomeReport = {
  summary: {
    totalIncome: 120,
    totalExpense: 50,
    financialBalance: 70,
  },
  transactions: [],
}

const accountingReport: AccountingReport = {
  summary: {
    totalIncome: 120,
    totalExpense: 50,
    financialBalance: 70,
    transactionCount: 2,
  },
  categories: { sale: 100, purchase: 40, other: 30 },
  transactions: [],
}

describe('ReportingReadService', () => {
  it('returns the repository all-time summary without materializing domain collections', async () => {
    const repository: ReportingQueryRepository = {
      getAllTimeSummary: vi.fn().mockResolvedValue(summary),
      getIncomeReport: vi.fn().mockResolvedValue(incomeReport),
      getAccountingReport: vi.fn().mockResolvedValue(accountingReport),
    }
    const service = new ReportingReadService(repository)

    await expect(service.getAllTimeSummary()).resolves.toBe(summary)
    expect(repository.getAllTimeSummary).toHaveBeenCalledTimes(1)
  })

  it('passes a normalized income report query through to the repository', async () => {
    const repository: ReportingQueryRepository = {
      getAllTimeSummary: vi.fn().mockResolvedValue(summary),
      getIncomeReport: vi.fn().mockResolvedValue(incomeReport),
      getAccountingReport: vi.fn().mockResolvedValue(accountingReport),
    }
    const service = new ReportingReadService(repository)
    const query = { limit: 51, type: 'income' as const }

    await expect(service.getIncomeReport(query)).resolves.toBe(incomeReport)
    expect(repository.getIncomeReport).toHaveBeenCalledWith(query, undefined)
  })

  it('passes the frozen accounting window through to the repository', async () => {
    const repository: ReportingQueryRepository = {
      getAllTimeSummary: vi.fn().mockResolvedValue(summary),
      getIncomeReport: vi.fn().mockResolvedValue(incomeReport),
      getAccountingReport: vi.fn().mockResolvedValue(accountingReport),
    }
    const service = new ReportingReadService(repository)
    const query = {
      period: 'today' as const,
      limit: 51,
      type: 'income' as const,
      window: {
        from: new Date('2026-08-27T21:00:00.000Z'),
        to: new Date('2026-08-28T12:00:00.000Z'),
      },
    }

    await expect(service.getAccountingReport(query)).resolves.toBe(accountingReport)
    expect(repository.getAccountingReport).toHaveBeenCalledWith(query)
  })
})
