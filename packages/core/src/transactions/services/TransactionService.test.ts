import {
  describe,
  expect,
  it,
} from 'vitest'
import type { Transaction } from '../types/transaction'
import {
  calculateCategoryCounts,
  calculateBalance,
  calculateCategoryTotals,
  calculateExpenses,
  calculateIncome,
  filterTransactions,
  getCompletedTransactions,
  getTransactionTotals,
  getTransactionsByPeriod,
  getRecentTransactions,
  isDuplicateTransaction,
} from './TransactionService'

function createTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    type: 'income',
    category: 'sale',
    amount: 1000,
    paymentMethod: 'cash',
    transactionDate: now,
    status: 'completed',
    ...overrides,
  }
}

describe('TransactionService', () => {
  describe('getCompletedTransactions', () => {
    it('returns only completed transactions', () => {
      const transactions = [
        createTransaction({
          status: 'completed',
        }),
        createTransaction({
          status: 'pending',
        }),
        createTransaction({
          status: 'cancelled',
        }),
      ]

      const result =
        getCompletedTransactions(
          transactions,
        )

      expect(result).toHaveLength(1)
      expect(result[0]?.status).toBe(
        'completed',
      )
    })
  })

  describe('getRecentTransactions', () => {
    it('returns transactions sorted by newest date first', () => {
      const older = createTransaction({
        transactionDate: new Date(
          '2026-08-10T12:00:00',
        ),
      })

      const newer = createTransaction({
        transactionDate: new Date(
          '2026-08-15T12:00:00',
        ),
      })

      const newest = createTransaction({
        transactionDate: new Date(
          '2026-08-16T12:00:00',
        ),
      })

      const result =
        getRecentTransactions(
          [older, newer, newest],
          3,
        )

      expect(result[0]?.id).toBe(newest.id)
      expect(result[1]?.id).toBe(newer.id)
      expect(result[2]?.id).toBe(older.id)
    })

    it('limits the number of returned transactions', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            '2026-08-10T12:00:00',
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            '2026-08-15T12:00:00',
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            '2026-08-16T12:00:00',
          ),
        }),
      ]

      const result =
        getRecentTransactions(
          transactions,
          2,
        )

      expect(result).toHaveLength(2)
    })

    it('does not mutate the original array', () => {
      const older = createTransaction({
        transactionDate: new Date(
          '2026-08-10T12:00:00',
        ),
      })

      const newer = createTransaction({
        transactionDate: new Date(
          '2026-08-15T12:00:00',
        ),
      })

      const transactions = [
        older,
        newer,
      ]

      getRecentTransactions(
        transactions,
        2,
      )

      expect(transactions[0]?.id).toBe(
        older.id,
      )
      expect(transactions[1]?.id).toBe(
        newer.id,
      )
    })
  })

  describe('filterTransactions', () => {
    const now = new Date(
      2026,
      7,
      16,
      12,
      0,
      0,
    )

    it('filters completed transactions by type', () => {
      const transactions = [
        createTransaction({
          type: 'income',
          status: 'completed',
        }),
        createTransaction({
          type: 'expense',
          status: 'completed',
        }),
        createTransaction({
          type: 'income',
          status: 'pending',
        }),
      ]

      const result = filterTransactions(
        transactions,
        {
          type: 'income',
          status: 'completed',
        },
        now,
      )

      expect(result).toHaveLength(1)
      expect(result[0]?.type).toBe('income')
      expect(result[0]?.status).toBe('completed')
    })

    it('filters transactions by period', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            16,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            10,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            9,
          ),
        }),
      ]

      const result = filterTransactions(
        transactions,
        {
          period: '7days',
        },
        now,
      )

      expect(result).toHaveLength(2)
    })

    it('returns all transactions when no filters are provided', () => {
      const transactions = [
        createTransaction({
          status: 'completed',
        }),
        createTransaction({
          status: 'pending',
        }),
      ]

      const result = filterTransactions(
        transactions,
        {},
        now,
      )

      expect(result).toHaveLength(2)
    })
  })

  describe('calculateCategoryTotals', () => {
    it('calculates totals for all categories', () => {
      const transactions = [
        createTransaction({
          category: 'sale',
          amount: 1000,
        }),
        createTransaction({
          category: 'sale',
          amount: 500,
        }),
        createTransaction({
          category: 'purchase',
          amount: 700,
        }),
        createTransaction({
          category: 'other',
          amount: 200,
        }),
      ]

      expect(
        calculateCategoryTotals(
          transactions,
        ),
      ).toEqual({
        sale: 1500,
        purchase: 700,
        other: 200,
      })
    })

    it('returns zero for categories without transactions', () => {
      const transactions = [
        createTransaction({
          category: 'sale',
          amount: 1000,
        }),
      ]

      expect(
        calculateCategoryTotals(
          transactions,
        ),
      ).toEqual({
        sale: 1000,
        purchase: 0,
        other: 0,
      })
    })
  })

  describe('calculateIncome', () => {
    it('calculates completed income only', () => {
      const transactions = [
        createTransaction({
          type: 'income',
          amount: 1000,
          status: 'completed',
        }),
        createTransaction({
          type: 'income',
          amount: 500,
          status: 'pending',
        }),
        createTransaction({
          type: 'expense',
          amount: 200,
          status: 'completed',
        }),
      ]

      expect(
        calculateIncome(transactions),
      ).toBe(1000)
    })
  })

  describe('calculateExpenses', () => {
    it('calculates completed expenses only', () => {
      const transactions = [
        createTransaction({
          type: 'expense',
          amount: 300,
          status: 'completed',
        }),
        createTransaction({
          type: 'expense',
          amount: 200,
          status: 'cancelled',
        }),
        createTransaction({
          type: 'income',
          amount: 1000,
          status: 'completed',
        }),
      ]

      expect(
        calculateExpenses(transactions),
      ).toBe(300)
    })
  })

  describe('calculateBalance', () => {
    it('calculates income minus expenses', () => {
      const transactions = [
        createTransaction({
          type: 'income',
          amount: 1500,
        }),
        createTransaction({
          type: 'expense',
          amount: 400,
        }),
      ]

      expect(
        calculateBalance(transactions),
      ).toBe(1100)
    })
  })

  describe('getTransactionTotals', () => {
    it('returns income, expense and balance', () => {
      const transactions = [
        createTransaction({
          type: 'income',
          amount: 2000,
        }),
        createTransaction({
          type: 'expense',
          amount: 750,
        }),
      ]

      expect(
        getTransactionTotals(
          transactions,
        ),
      ).toEqual({
        income: 2000,
        expense: 750,
        balance: 1250,
      })
    })
  })

  describe('getTransactionsByPeriod', () => {
    const now = new Date(
      2026,
      7,
      16,
      12,
      0,
      0,
    )

    it('returns all transactions for all period', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            2026,
            0,
            1,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            16,
          ),
        }),
      ]

      expect(
        getTransactionsByPeriod(
          transactions,
          'all',
          now,
        ),
      ).toHaveLength(2)
    })

    it('returns transactions from today', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            16,
            9,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            15,
            23,
          ),
        }),
      ]

      const result =
        getTransactionsByPeriod(
          transactions,
          'today',
          now,
        )

      expect(result).toHaveLength(1)
    })

    it('returns transactions from the last 7 days', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            16,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            10,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            9,
          ),
        }),
      ]

      const result =
        getTransactionsByPeriod(
          transactions,
          '7days',
          now,
        )

      expect(result).toHaveLength(2)
    })

    it('returns transactions from the current month', () => {
      const transactions = [
        createTransaction({
          transactionDate: new Date(
            2026,
            7,
            1,
          ),
        }),
        createTransaction({
          transactionDate: new Date(
            2026,
            6,
            31,
          ),
        }),
      ]

      const result =
        getTransactionsByPeriod(
          transactions,
          'month',
          now,
        )

      expect(result).toHaveLength(1)
    })
  })

  describe('calculateCategoryCounts', () => {
    it('counts sales and purchases', () => {
      const transactions = [
        createTransaction({
          type: 'income',
          category: 'sale',
        }),
        createTransaction({
          type: 'income',
          category: 'sale',
        }),
        createTransaction({
          type: 'expense',
          category: 'purchase',
        }),
        createTransaction({
          type: 'expense',
          category: 'purchase',
        }),
        createTransaction({
          type: 'income',
          category: 'other',
        }),
      ]

      expect(
        calculateCategoryCounts(
          transactions,
        ),
      ).toEqual({
        sales: 2,
        purchases: 2,
      })
    })

    it('returns zero counts for an empty array', () => {
      expect(
        calculateCategoryCounts([]),
      ).toEqual({
        sales: 0,
        purchases: 0,
      })
    })

    it('does not count transactions with the wrong type', () => {
      const transactions = [
        createTransaction({
          type: 'expense',
          category: 'sale',
        }),
        createTransaction({
          type: 'income',
          category: 'purchase',
        }),
      ]

      expect(
        calculateCategoryCounts(
          transactions,
        ),
      ).toEqual({
        sales: 0,
        purchases: 0,
      })
    })
  })


  describe('isDuplicateTransaction', () => {
    it('returns false when transaction has no referenceId', () => {
      const transactions = [
        createTransaction({
          referenceId: undefined,
        }),
      ]

      const transaction = createTransaction({
        referenceId: undefined,
      })

      expect(
        isDuplicateTransaction(
          transactions,
          transaction,
        ),
      ).toBe(false)
    })

    it('returns true for the same category and referenceId', () => {
      const transactions = [
        createTransaction({
          category: 'sale',
          referenceId: 'sale-001',
        }),
      ]

      const transaction = createTransaction({
        category: 'sale',
        referenceId: 'sale-001',
      })

      expect(
        isDuplicateTransaction(
          transactions,
          transaction,
        ),
      ).toBe(true)
    })

    it('returns false for a different category or referenceId', () => {
      const transactions = [
        createTransaction({
          category: 'sale',
          referenceId: 'sale-001',
        }),
      ]

      expect(
        isDuplicateTransaction(
          transactions,
          createTransaction({
            category: 'purchase',
            referenceId: 'sale-001',
          }),
        ),
      ).toBe(false)

      expect(
        isDuplicateTransaction(
          transactions,
          createTransaction({
            category: 'sale',
            referenceId: 'sale-002',
          }),
        ),
      ).toBe(false)
    })
  })
})