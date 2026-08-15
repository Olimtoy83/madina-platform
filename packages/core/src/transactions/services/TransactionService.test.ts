import {
  describe,
  expect,
  it,
} from 'vitest'
import type { Transaction } from '../types/transaction'
import {
  calculateBalance,
  calculateExpenses,
  calculateIncome,
  getCompletedTransactions,
  getTransactionTotals,
  getTransactionsByPeriod,
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
})