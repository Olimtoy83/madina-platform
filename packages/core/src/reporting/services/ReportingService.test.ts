import {
  describe,
  expect,
  it,
} from 'vitest'
import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Transaction } from '../../transactions/types/transaction'
import type { Product } from '../../inventory/types/product'
import type { StockMovement } from '../../inventory/types/stockMovement'
import {
  getCurrentStockByUnit,
  getFinancialKpis,
  getClientSalesMetrics,
  getInventoryProductSummary,
  getNetStockMovementByUnit,
  getPurchasesProductMetrics,
  getPurchasesReportingSummary,
  getReportingEligiblePurchases,
  getReportingEligibleSales,
  getReportingEligibleTransactions,
  getSalesProductMetrics,
  getSalesReportingSummary,
  getStockMovementMetrics,
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

function createProduct(
  overrides: Partial<Product> = {},
): Product {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: 'Product',
    category: 'dry-fruits',
    quantity: 0,
    unit: 'kg',
    costPrice: 10,
    salePrice: 20,
    status: 'active',
    ...overrides,
  }
}

function createStockMovement(
  overrides: Partial<StockMovement> = {},
): StockMovement {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    productId: 'product-1',
    type: 'purchase',
    quantity: 1,
    unit: 'kg',
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

  describe('getFinancialKpis', () => {
    it('calculates revenue from eligible completed sale income only', () => {
      const revenue = createTransaction({
        amount: 100,
        type: 'income',
        category: 'sale',
      })

      expect(
        getFinancialKpis(
          [
            revenue,
            createTransaction({
              amount: 200,
              type: 'income',
              category: 'other',
            }),
            createTransaction({
              amount: 300,
              status: 'pending',
            }),
            createTransaction({
              amount: 400,
              status: 'cancelled',
            }),
            createTransaction({
              amount: 500,
              transactionDate: new Date(2026, 7, 17),
            }),
            createTransaction({
              amount: 600,
              transactionDate: new Date(2026, 7, 1),
            }),
          ],
          'today',
          now,
        ).revenue,
      ).toBe(100)
    })

    it('calculates total income across eligible income categories only', () => {
      expect(
        getFinancialKpis(
          [
            createTransaction({
              amount: 100,
              type: 'income',
              category: 'sale',
            }),
            createTransaction({
              amount: 200,
              type: 'income',
              category: 'other',
            }),
            createTransaction({
              amount: 300,
              type: 'expense',
              category: 'purchase',
            }),
          ],
          'today',
          now,
        ).totalIncome,
      ).toBe(300)
    })

    it('calculates purchase expense from eligible completed purchase expense only', () => {
      expect(
        getFinancialKpis(
          [
            createTransaction({
              amount: 100,
              type: 'expense',
              category: 'purchase',
            }),
            createTransaction({
              amount: 200,
              type: 'expense',
              category: 'other',
            }),
            createTransaction({
              amount: 300,
              type: 'expense',
              category: 'purchase',
              status: 'pending',
            }),
            createTransaction({
              amount: 400,
              type: 'expense',
              category: 'purchase',
              transactionDate: new Date(2026, 7, 17),
            }),
            createTransaction({
              amount: 500,
              type: 'expense',
              category: 'purchase',
              transactionDate: new Date(2026, 7, 15),
            }),
          ],
          'today',
          now,
        ).purchaseExpense,
      ).toBe(100)
    })

    it('calculates total expense across eligible expense categories only', () => {
      expect(
        getFinancialKpis(
          [
            createTransaction({
              amount: 100,
              type: 'expense',
              category: 'purchase',
            }),
            createTransaction({
              amount: 200,
              type: 'expense',
              category: 'other',
            }),
            createTransaction({
              amount: 300,
              type: 'income',
              category: 'sale',
            }),
          ],
          'today',
          now,
        ).totalExpense,
      ).toBe(300)
    })

    it('calculates positive, zero and negative financial balance', () => {
      expect(
        getFinancialKpis(
          [
            createTransaction({ amount: 500 }),
            createTransaction({
              amount: 200,
              type: 'expense',
            }),
          ],
          'all',
          now,
        ).financialBalance,
      ).toBe(300)

      expect(
        getFinancialKpis(
          [
            createTransaction({ amount: 200 }),
            createTransaction({
              amount: 200,
              type: 'expense',
            }),
          ],
          'all',
          now,
        ).financialBalance,
      ).toBe(0)

      expect(
        getFinancialKpis(
          [
            createTransaction({ amount: 100 }),
            createTransaction({
              amount: 200,
              type: 'expense',
            }),
          ],
          'all',
          now,
        ).financialBalance,
      ).toBe(-100)
    })

    it('uses every canonical period and returns zero for no eligible transactions', () => {
      const transactions = [
        createTransaction({
          amount: 10,
          transactionDate: new Date(2026, 7, 16, 8),
        }),
        createTransaction({
          amount: 20,
          transactionDate: new Date(2026, 7, 10, 8),
        }),
        createTransaction({
          amount: 30,
          transactionDate: new Date(2026, 7, 1, 8),
        }),
        createTransaction({
          amount: 40,
          transactionDate: new Date(2026, 6, 31, 8),
        }),
      ]

      expect(
        getFinancialKpis(transactions, 'today', now).revenue,
      ).toBe(10)
      expect(
        getFinancialKpis(transactions, '7days', now).revenue,
      ).toBe(30)
      expect(
        getFinancialKpis(transactions, 'month', now).revenue,
      ).toBe(60)
      expect(
        getFinancialKpis(transactions, 'all', now).revenue,
      ).toBe(100)
      expect(
        getFinancialKpis(
          transactions,
          {
            kind: 'custom',
            start: new Date(2026, 6, 31),
            end: new Date(2026, 6, 31),
          },
          now,
        ).revenue,
      ).toBe(40)
      expect(
        getFinancialKpis(
          transactions,
          {
            kind: 'custom',
            start: new Date(2026, 5, 1),
            end: new Date(2026, 5, 1),
          },
          now,
        ),
      ).toEqual({
        revenue: 0,
        totalIncome: 0,
        purchaseExpense: 0,
        totalExpense: 0,
        financialBalance: 0,
      })
    })

    it('does not mutate source arrays or transaction objects', () => {
      const transaction = createTransaction({ amount: 100 })
      const transactions = [transaction]
      const snapshot = structuredClone(transactions)

      getFinancialKpis(transactions, 'all', now)

      expect(transactions).toEqual(snapshot)
      expect(transactions[0]).toBe(transaction)
    })
  })

  describe('Sales and Purchases reporting', () => {
    it('summarizes Sales by period and separates completed metrics from status breakdown', () => {
      expect(
        getSalesReportingSummary(
          [
            createSale({
              status: 'completed',
              totalAmount: 100,
            }),
            createSale({
              status: 'draft',
              totalAmount: 200,
            }),
            createSale({
              status: 'cancelled',
              totalAmount: 300,
            }),
            createSale({
              status: 'completed',
              totalAmount: 400,
              saleDate: new Date(2026, 7, 15),
            }),
            createSale({
              status: 'completed',
              totalAmount: 500,
              saleDate: new Date(2026, 7, 17),
            }),
          ],
          'today',
          now,
        ),
      ).toEqual({
        statusBreakdown: {
          draft: 1,
          completed: 1,
          cancelled: 1,
        },
        completedCount: 1,
        completedAmount: 100,
      })
    })

    it('summarizes Purchases by purchaseDate and excludes future records', () => {
      expect(
        getPurchasesReportingSummary(
          [
            createPurchase({
              status: 'completed',
              totalAmount: 100,
            }),
            createPurchase({
              status: 'draft',
              totalAmount: 200,
            }),
            createPurchase({
              status: 'cancelled',
              totalAmount: 300,
            }),
            createPurchase({
              status: 'completed',
              totalAmount: 400,
              purchaseDate: new Date(2026, 7, 15),
            }),
            createPurchase({
              status: 'completed',
              totalAmount: 500,
              purchaseDate: new Date(2026, 7, 17),
            }),
          ],
          'today',
          now,
        ),
      ).toEqual({
        statusBreakdown: {
          draft: 1,
          completed: 1,
          cancelled: 1,
        },
        completedCount: 1,
        completedAmount: 100,
      })
    })

    it('groups completed Sale item quantities by product and historical unit', () => {
      const sales = [
        createSale({
          items: [
            {
              productId: 'product-1',
              quantity: 2,
              unit: 'kg',
              unitPrice: 10,
              totalAmount: 20,
            },
          ],
        }),
        createSale({
          items: [
            {
              productId: 'product-1',
              quantity: 3,
              unit: 'piece',
              unitPrice: 10,
              totalAmount: 30,
            },
          ],
        }),
        createSale({
          items: [
            {
              productId: 'product-1',
              quantity: 4,
              unit: 'kg',
              unitPrice: 10,
              totalAmount: 40,
            },
          ],
        }),
        createSale({
          status: 'draft',
          items: [
            {
              productId: 'product-1',
              quantity: 5,
              unit: 'kg',
              unitPrice: 10,
              totalAmount: 50,
            },
          ],
        }),
      ]

      expect(
        getSalesProductMetrics(sales, 'today', now),
      ).toEqual([
        {
          productId: 'product-1',
          unit: 'kg',
          quantity: 6,
        },
        {
          productId: 'product-1',
          unit: 'piece',
          quantity: 3,
        },
      ])
    })

    it('groups completed Purchase item quantities by product and historical unit', () => {
      const purchases = [
        createPurchase({
          items: [
            {
              productId: 'product-1',
              quantity: 2,
              unit: 'kg',
              unitCost: 10,
              totalCost: 20,
            },
          ],
        }),
        createPurchase({
          items: [
            {
              productId: 'product-1',
              quantity: 3,
              unit: 'piece',
              unitCost: 10,
              totalCost: 30,
            },
          ],
        }),
        createPurchase({
          items: [
            {
              productId: 'product-1',
              quantity: 4,
              unit: 'kg',
              unitCost: 10,
              totalCost: 40,
            },
          ],
        }),
        createPurchase({
          status: 'cancelled',
          items: [
            {
              productId: 'product-1',
              quantity: 5,
              unit: 'kg',
              unitCost: 10,
              totalCost: 50,
            },
          ],
        }),
      ]

      expect(
        getPurchasesProductMetrics(
          purchases,
          'today',
          now,
        ),
      ).toEqual([
        {
          productId: 'product-1',
          unit: 'kg',
          quantity: 6,
        },
        {
          productId: 'product-1',
          unit: 'piece',
          quantity: 3,
        },
      ])
    })

    it('groups eligible completed Sales by clientId and preserves all historical name snapshots', () => {
      const sales = [
        createSale({
          clientId: 'client-1',
          clientName: 'Original name',
          totalAmount: 100,
        }),
        createSale({
          clientId: 'client-1',
          clientName: 'Renamed client',
          totalAmount: 200,
        }),
        createSale({
          clientId: 'client-2',
          clientName: 'Another client',
          totalAmount: 300,
        }),
        createSale({
          clientId: 'client-1',
          clientName: 'Original name',
          status: 'draft',
          totalAmount: 400,
        }),
        createSale({
          clientId: 'client-1',
          clientName: 'Original name',
          saleDate: new Date(2026, 7, 17),
          totalAmount: 500,
        }),
        createSale({
          clientId: undefined,
          clientName: 'Unlinked sale',
          totalAmount: 600,
        }),
      ]
      const snapshot = structuredClone(sales)

      expect(
        getClientSalesMetrics(sales, 'today', now),
      ).toEqual([
        {
          clientId: 'client-1',
          clientNames: [
            'Original name',
            'Renamed client',
          ],
          completedSaleCount: 2,
          completedSaleAmount: 300,
        },
        {
          clientId: 'client-2',
          clientNames: ['Another client'],
          completedSaleCount: 1,
          completedSaleAmount: 300,
        },
      ])
      expect(sales).toEqual(snapshot)
    })

    it('returns empty summaries and groups for empty eligible sets without mutating source items', () => {
      const sale = createSale({
        saleDate: new Date(2026, 7, 17),
        items: [
          {
            productId: 'product-1',
            quantity: 2,
            unit: 'kg',
            unitPrice: 10,
            totalAmount: 20,
          },
        ],
      })
      const purchase = createPurchase({
        purchaseDate: new Date(2026, 7, 17),
        items: [
          {
            productId: 'product-1',
            quantity: 2,
            unit: 'kg',
            unitCost: 10,
            totalCost: 20,
          },
        ],
      })
      const sales = [sale]
      const purchases = [purchase]
      const salesSnapshot = structuredClone(sales)
      const purchasesSnapshot = structuredClone(purchases)

      expect(
        getSalesReportingSummary(sales, 'today', now),
      ).toEqual({
        statusBreakdown: {
          draft: 0,
          completed: 0,
          cancelled: 0,
        },
        completedCount: 0,
        completedAmount: 0,
      })
      expect(
        getPurchasesReportingSummary(
          purchases,
          'today',
          now,
        ),
      ).toEqual({
        statusBreakdown: {
          draft: 0,
          completed: 0,
          cancelled: 0,
        },
        completedCount: 0,
        completedAmount: 0,
      })
      expect(getSalesProductMetrics(sales, 'today', now)).toEqual(
        [],
      )
      expect(
        getPurchasesProductMetrics(
          purchases,
          'today',
          now,
        ),
      ).toEqual([])
      expect(getClientSalesMetrics(sales, 'today', now)).toEqual(
        [],
      )
      expect(sales).toEqual(salesSnapshot)
      expect(purchases).toEqual(purchasesSnapshot)
    })
  })

  describe('Unit-aware inventory reporting', () => {
    it('counts all Product master records and active Products separately', () => {
      expect(
        getInventoryProductSummary([
          createProduct({ status: 'active' }),
          createProduct({ status: 'inactive' }),
          createProduct({ status: 'active' }),
        ]),
      ).toEqual({
        productCount: 3,
        activeProductCount: 2,
      })
    })

    it('groups current on-hand stock by unit and retains inactive and zero-quantity Products', () => {
      expect(
        getCurrentStockByUnit([
          createProduct({
            quantity: 2,
            unit: 'kg',
          }),
          createProduct({
            quantity: 3,
            unit: 'kg',
            status: 'inactive',
          }),
          createProduct({
            quantity: 4,
            unit: 'piece',
          }),
          createProduct({
            quantity: 0,
            unit: 'liter',
          }),
        ]),
      ).toEqual([
        { unit: 'kg', quantity: 5 },
        { unit: 'piece', quantity: 4 },
        { unit: 'liter', quantity: 0 },
      ])
    })

    it('returns empty unit-aware inventory metrics for empty source data', () => {
      expect(getInventoryProductSummary([])).toEqual({
        productCount: 0,
        activeProductCount: 0,
      })
      expect(getCurrentStockByUnit([])).toEqual([])
      expect(getStockMovementMetrics([], 'all', now)).toEqual([])
      expect(getNetStockMovementByUnit([], 'all', now)).toEqual([])
    })

    it('groups eligible movement quantities by type and unit with signed semantics preserved', () => {
      expect(
        getStockMovementMetrics(
          [
            createStockMovement({
              type: 'purchase',
              unit: 'kg',
              quantity: 5,
            }),
            createStockMovement({
              type: 'purchase',
              unit: 'kg',
              quantity: 2,
            }),
            createStockMovement({
              type: 'sale',
              unit: 'kg',
              quantity: -3,
            }),
            createStockMovement({
              type: 'adjustment',
              unit: 'kg',
              quantity: -1,
            }),
            createStockMovement({
              type: 'purchase',
              unit: 'piece',
              quantity: 4,
            }),
          ],
          'today',
          now,
        ),
      ).toEqual([
        { type: 'purchase', unit: 'kg', quantity: 7 },
        { type: 'purchase', unit: 'piece', quantity: 4 },
        { type: 'sale', unit: 'kg', quantity: -3 },
        { type: 'adjustment', unit: 'kg', quantity: -1 },
      ])
    })

    it('returns signed net movement per unit and applies canonical periods', () => {
      const movements = [
        createStockMovement({
          type: 'purchase',
          unit: 'kg',
          quantity: 5,
        }),
        createStockMovement({
          type: 'sale',
          unit: 'kg',
          quantity: -2,
        }),
        createStockMovement({
          type: 'purchase',
          unit: 'piece',
          quantity: 3,
        }),
        createStockMovement({
          type: 'sale',
          unit: 'kg',
          quantity: -1,
          createdAt: new Date(2026, 7, 15),
        }),
        createStockMovement({
          type: 'purchase',
          unit: 'kg',
          quantity: 10,
          createdAt: new Date(2026, 7, 17),
        }),
      ]

      expect(
        getNetStockMovementByUnit(
          movements,
          'today',
          now,
        ),
      ).toEqual([
        { unit: 'kg', quantity: 3 },
        { unit: 'piece', quantity: 3 },
      ])
      expect(
        getNetStockMovementByUnit(
          movements,
          {
            kind: 'custom',
            start: new Date(2026, 7, 15),
            end: new Date(2026, 7, 15),
          },
          now,
        ),
      ).toEqual([{ unit: 'kg', quantity: -1 }])
    })

    it('does not mutate Product or StockMovement source arrays and objects', () => {
      const products = [
        createProduct({ quantity: 2, unit: 'kg' }),
      ]
      const movements = [
        createStockMovement({ quantity: -1, type: 'sale' }),
      ]
      const productsSnapshot = structuredClone(products)
      const movementsSnapshot = structuredClone(movements)

      getInventoryProductSummary(products)
      getCurrentStockByUnit(products)
      getStockMovementMetrics(movements, 'all', now)
      getNetStockMovementByUnit(movements, 'all', now)

      expect(products).toEqual(productsSnapshot)
      expect(movements).toEqual(movementsSnapshot)
    })
  })
})
