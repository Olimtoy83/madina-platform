import {
  describe,
  expect,
  it,
} from 'vitest'
import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Transaction } from '../../transactions/types/transaction'
import {
  getReportingEligiblePurchases,
  getReportingEligibleSales,
  getReportingEligibleTransactions,
  ReportingValidationError,
  resolveReportingPeriod,
} from './ReportingService'

const now = new Date(2026, 7, 16, 12, 0, 0)

function createTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    type: 'income',
    category: 'sale',
    amount: 100,
    paymentMethod: 'cash',
    transactionDate: now,
    status: 'completed',
    ...overrides,
  }
}

function createSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    saleNumber: 'S-001',
    saleDate: now,
    clientName: 'Client',
    items: [],
    totalAmount: 100,
    paymentMethod: 'cash',
    status: 'completed',
    ...overrides,
  }
}

function createPurchase(
  overrides: Partial<Purchase> = {},
): Purchase {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    purchaseNumber: 'P-001',
    purchaseDate: now,
    supplierName: 'Supplier',
    items: [],
    totalAmount: 100,
    paymentMethod: 'cash',
    status: 'completed',
    ...overrides,
  }
}

describe('ReportingService', () => {
  describe('resolveReportingPeriod', () => {
    it('resolves today through now with inclusive boundaries', () => {
      const range = resolveReportingPeriod('today', now)

      expect(range.from).toEqual(
        new Date(2026, 7, 16, 0, 0, 0),
      )
      expect(range.to).toEqual(now)
    })

    it('resolves the inclusive lower boundary for last 7 days', () => {
      const range = resolveReportingPeriod('7days', now)

      expect(range.from).toEqual(
        new Date(2026, 7, 10, 0, 0, 0),
      )
      expect(range.to).toEqual(now)
    })

    it('resolves the current month from its local start', () => {
      const range = resolveReportingPeriod('month', now)

      expect(range.from).toEqual(
        new Date(2026, 7, 1, 0, 0, 0),
      )
      expect(range.to).toEqual(now)
    })

    it('resolves all through now', () => {
      expect(resolveReportingPeriod('all', now)).toEqual({
        to: now,
      })
    })

    it('includes the custom end calendar date and caps it at now', () => {
      expect(
        resolveReportingPeriod(
          {
            kind: 'custom',
            start: new Date(2026, 7, 10),
            end: new Date(2026, 7, 17),
          },
          now,
        ),
      ).toEqual({
        from: new Date(2026, 7, 10, 0, 0, 0),
        to: now,
      })
    })

    it('rejects a custom start date later than its end date', () => {
      expect(() =>
        resolveReportingPeriod(
          {
            kind: 'custom',
            start: new Date(2026, 7, 17),
            end: new Date(2026, 7, 16),
          },
          now,
        ),
      ).toThrow(ReportingValidationError)
    })
  })

  describe('getReportingEligibleTransactions', () => {
    it('applies today boundaries and excludes future, previous, draft and cancelled records', () => {
      const atStart = createTransaction({
        transactionDate: new Date(2026, 7, 16, 0, 0, 0),
      })
      const atNow = createTransaction()
      const transactions = [
        atStart,
        atNow,
        createTransaction({
          transactionDate: new Date(2026, 7, 16, 12, 0, 1),
        }),
        createTransaction({
          transactionDate: new Date(2026, 7, 15, 23, 59, 59),
        }),
        createTransaction({ status: 'pending' }),
        createTransaction({ status: 'cancelled' }),
      ]

      expect(
        getReportingEligibleTransactions(
          transactions,
          'today',
          now,
        ),
      ).toEqual([atStart, atNow])
    })

    it('applies inclusive last 7 day boundaries and excludes older and future records', () => {
      const lowerBoundary = createTransaction({
        transactionDate: new Date(2026, 7, 10, 0, 0, 0),
      })
      const atNow = createTransaction()

      expect(
        getReportingEligibleTransactions(
          [
            lowerBoundary,
            atNow,
            createTransaction({
              transactionDate: new Date(2026, 7, 9, 23, 59, 59),
            }),
            createTransaction({
              transactionDate: new Date(2026, 7, 16, 12, 0, 1),
            }),
          ],
          '7days',
          now,
        ),
      ).toEqual([lowerBoundary, atNow])
    })

    it('applies current month boundaries and excludes future records', () => {
      const monthStart = createTransaction({
        transactionDate: new Date(2026, 7, 1, 0, 0, 0),
      })
      const atNow = createTransaction()

      expect(
        getReportingEligibleTransactions(
          [
            monthStart,
            atNow,
            createTransaction({
              transactionDate: new Date(2026, 6, 31, 23, 59, 59),
            }),
            createTransaction({
              transactionDate: new Date(2026, 7, 16, 12, 0, 1),
            }),
          ],
          'month',
          now,
        ),
      ).toEqual([monthStart, atNow])
    })

    it('includes historical records in all and excludes future records without mutating source data', () => {
      const historical = createTransaction({
        transactionDate: new Date(2026, 0, 1),
      })
      const future = createTransaction({
        transactionDate: new Date(2026, 7, 17),
      })
      const transactions = [historical, future]

      expect(
        getReportingEligibleTransactions(
          transactions,
          'all',
          now,
        ),
      ).toEqual([historical])
      expect(transactions).toEqual([historical, future])
    })

    it('includes both boundaries of a historical custom range', () => {
      const atStart = createTransaction({
        transactionDate: new Date(2026, 7, 10, 0, 0, 0),
      })
      const atEnd = createTransaction({
        transactionDate: new Date(2026, 7, 12, 23, 59, 59, 999),
      })

      expect(
        getReportingEligibleTransactions(
          [
            atStart,
            atEnd,
            createTransaction({
              transactionDate: new Date(2026, 7, 13),
            }),
          ],
          {
            kind: 'custom',
            start: new Date(2026, 7, 10),
            end: new Date(2026, 7, 12),
          },
          now,
        ),
      ).toEqual([atStart, atEnd])
    })
  })

  it('returns only completed Sales and Purchases whose source dates are eligible', () => {
    const eligibleSale = createSale()
    const eligiblePurchase = createPurchase()

    expect(
      getReportingEligibleSales(
        [
          eligibleSale,
          createSale({ status: 'draft' }),
          createSale({
            saleDate: new Date(2026, 7, 17),
          }),
        ],
        'all',
        now,
      ),
    ).toEqual([eligibleSale])
    expect(
      getReportingEligiblePurchases(
        [
          eligiblePurchase,
          createPurchase({ status: 'cancelled' }),
          createPurchase({
            purchaseDate: new Date(2026, 7, 17),
          }),
        ],
        'all',
        now,
      ),
    ).toEqual([eligiblePurchase])
  })
})
