import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  getCurrentStockByUnit,
  getFinancialKpis,
  getInventoryProductSummary,
  getSalesReportingSummary,
  resolveAccountingReportWindow,
  resolveReportingPeriodWindow,
  type Product,
  type Sale,
  type Transaction,
} from '@madina/core'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteReportingQueryRepository } from './SqliteReportingQueryRepository.js'

const timestamp = new Date('2026-08-01T12:00:00.000Z')

function createProduct(
  id: string,
  unit: Product['unit'],
  quantity: number,
  status: Product['status'],
): Product {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    name: id,
    category: 'dates',
    quantity,
    unit,
    costPrice: 10,
    salePrice: 15,
    status,
  }
}

function createSale(
  id: string,
  status: Sale['status'],
): Sale {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    saleNumber: id,
    saleDate: timestamp,
    clientName: 'Client',
    items: [],
    totalAmount: 100,
    paymentMethod: 'cash',
    status,
  }
}

function createTransaction(
  id: string,
  type: Transaction['type'],
  category: Transaction['category'],
  amount: number,
  status: Transaction['status'],
): Transaction {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    type,
    category,
    amount,
    paymentMethod: 'cash',
    transactionDate: timestamp,
    status,
  }
}

function insertProduct(database: DatabaseSync, product: Product): void {
  database.prepare(`
    INSERT INTO products (
      id, created_at, updated_at, name, category, quantity, unit,
      cost_price, sale_price, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id,
    product.createdAt.toISOString(),
    product.updatedAt.toISOString(),
    product.name,
    product.category,
    product.quantity,
    product.unit,
    product.costPrice,
    product.salePrice,
    product.status,
  )
}

function insertSale(database: DatabaseSync, sale: Sale): void {
  database.prepare(`
    INSERT INTO sales (
      id, created_at, updated_at, sale_number, sale_date, client_id,
      client_name, total_amount, payment_method, status, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sale.id,
    sale.createdAt.toISOString(),
    sale.updatedAt.toISOString(),
    sale.saleNumber,
    sale.saleDate.toISOString(),
    null,
    sale.clientName,
    sale.totalAmount,
    sale.paymentMethod,
    sale.status,
    null,
  )
}

function insertTransaction(
  database: DatabaseSync,
  transaction: Transaction,
): void {
  database.prepare(`
    INSERT INTO transactions (
      id, created_at, updated_at, type, category, amount, payment_method,
      transaction_date, reference_id, description, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    transaction.id,
    transaction.createdAt.toISOString(),
    transaction.updatedAt.toISOString(),
    transaction.type,
    transaction.category,
    transaction.amount,
    transaction.paymentMethod,
    transaction.transactionDate.toISOString(),
    null,
    null,
    transaction.status,
  )
}

async function withRepository(
  seed: (database: DatabaseSync) => void,
  run: (repository: SqliteReportingQueryRepository) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-reporting-'))
  const databaseFile = join(directory, 'reporting.sqlite')
  initializeDatabase(databaseFile)
  const database = new DatabaseSync(databaseFile)

  try {
    seed(database)
  } finally {
    database.close()
  }

  const repository = new SqliteReportingQueryRepository(databaseFile)

  try {
    await run(repository)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SqliteReportingQueryRepository returns an all-zero summary for an empty database', async () => {
  await withRepository(() => {}, async (repository) => {
    deepEqual(await repository.getAllTimeSummary(), {
      sales: { completedCount: 0 },
      financial: {
        totalIncome: 0,
        totalExpense: 0,
        financialBalance: 0,
        revenue: 0,
        purchaseExpense: 0,
      },
      inventory: {
        productCount: 0,
        activeProductCount: 0,
        stockByUnit: [],
      },
    })
  })
})

test('SqliteReportingQueryRepository matches Core all-time financial, sales, and inventory semantics', async () => {
  const products = [
    createProduct('product-kg-active', 'kg', 10, 'active'),
    createProduct('product-kg-inactive', 'kg', 0, 'inactive'),
    createProduct('product-box-active', 'box', 2, 'active'),
  ]
  const sales = [
    createSale('sale-completed', 'completed'),
    createSale('sale-draft', 'draft'),
    createSale('sale-cancelled', 'cancelled'),
  ]
  const transactions = [
    createTransaction('income-sale', 'income', 'sale', 100, 'completed'),
    createTransaction('income-other', 'income', 'other', 20, 'completed'),
    createTransaction('expense-purchase', 'expense', 'purchase', 40, 'completed'),
    createTransaction('expense-other', 'expense', 'other', 10, 'completed'),
    createTransaction('income-draft', 'income', 'sale', 999, 'pending'),
    createTransaction('expense-cancelled', 'expense', 'purchase', 999, 'cancelled'),
    {
      ...createTransaction('income-future', 'income', 'sale', 999, 'completed'),
      transactionDate: new Date('2026-10-01T00:00:00.000Z'),
    },
  ]

  sales.push({
    ...createSale('sale-future', 'completed'),
    saleDate: new Date('2026-10-01T00:00:00.000Z'),
  })

  await withRepository((database) => {
    for (const product of products) insertProduct(database, product)
    for (const sale of sales) insertSale(database, sale)
    for (const transaction of transactions) insertTransaction(database, transaction)
  }, async (repository) => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const summary = await repository.getAllTimeSummary(now)
    const expectedStockByUnit = getCurrentStockByUnit(products)
      .sort((left, right) => left.unit.localeCompare(right.unit))

    deepEqual(summary.financial, getFinancialKpis(
      transactions,
      'all',
      now,
    ))
    equal(summary.sales.completedCount, getSalesReportingSummary(
      sales,
      'all',
      now,
    ).completedCount)
    deepEqual(summary.inventory, {
      ...getInventoryProductSummary(products),
      stockByUnit: expectedStockByUnit,
    })
    deepEqual(summary.inventory.stockByUnit, [
      { unit: 'box', quantity: 2 },
      { unit: 'kg', quantity: 10 },
    ])
  })
})

test('SqliteReportingQueryRepository returns an effective, keyset-paginated income report with an independent summary', async () => {
  const transactions = [
    {
      ...createTransaction('transaction-b', 'income', 'sale', 100, 'completed'),
      transactionDate: new Date('2026-08-15T12:00:00.000Z'),
    },
    {
      ...createTransaction('transaction-a', 'expense', 'purchase', 40, 'completed'),
      transactionDate: new Date('2026-08-15T12:00:00.000Z'),
    },
    {
      ...createTransaction('transaction-old', 'income', 'other', 20, 'completed'),
      transactionDate: new Date('2026-08-14T12:00:00.000Z'),
    },
    createTransaction('transaction-pending', 'income', 'sale', 999, 'pending'),
    createTransaction('transaction-cancelled', 'expense', 'purchase', 999, 'cancelled'),
    {
      ...createTransaction('transaction-future', 'income', 'sale', 999, 'completed'),
      transactionDate: new Date('2026-10-01T00:00:00.000Z'),
    },
  ]
  const now = new Date('2026-09-01T00:00:00.000Z')

  await withRepository((database) => {
    for (const transaction of transactions) insertTransaction(database, transaction)
  }, async (repository) => {
    const firstPage = await repository.getIncomeReport({ limit: 3 }, now)

    const expectedFinancial = getFinancialKpis(transactions, 'all', now)
    deepEqual(firstPage.summary, {
      totalIncome: expectedFinancial.totalIncome,
      totalExpense: expectedFinancial.totalExpense,
      financialBalance: expectedFinancial.financialBalance,
    })
    deepEqual(firstPage.transactions.map((transaction) => transaction.id), [
      'transaction-b',
      'transaction-a',
      'transaction-old',
    ])

    const incomeOnly = await repository.getIncomeReport({
      limit: 3,
      type: 'income',
    }, now)
    deepEqual(incomeOnly.summary, firstPage.summary)
    deepEqual(incomeOnly.transactions.map((transaction) => transaction.id), [
      'transaction-b',
      'transaction-old',
    ])

    const secondPage = await repository.getIncomeReport({
      limit: 3,
      cursor: {
        transactionDate: firstPage.transactions.at(-1)!.transactionDate,
        id: firstPage.transactions.at(-1)!.id,
      },
    }, now)
    deepEqual(secondPage.transactions, [])
  })
})

test('SqliteReportingQueryRepository reads a timezone-bounded, filtered, keyset-paginated accounting report', async () => {
  const now = new Date('2026-03-01T01:30:00.000Z')
  const todayWindow = resolveAccountingReportWindow('today', now)
  const sevenDaysWindow = resolveAccountingReportWindow('7days', now)
  const monthWindow = resolveAccountingReportWindow('month', now)
  const transactions = [
    {
      ...createTransaction('before-today', 'income', 'sale', 100, 'completed'),
      transactionDate: new Date('2026-02-28T20:59:59.999Z'),
    },
    {
      ...createTransaction('today-income-b', 'income', 'sale', 30, 'completed'),
      transactionDate: new Date('2026-02-28T21:00:00.000Z'),
    },
    {
      ...createTransaction('today-income-a', 'income', 'other', 20, 'completed'),
      transactionDate: new Date('2026-02-28T21:00:00.000Z'),
    },
    {
      ...createTransaction('today-expense', 'expense', 'purchase', 10, 'completed'),
      transactionDate: new Date('2026-03-01T00:00:00.000Z'),
    },
    {
      ...createTransaction('before-seven-days', 'expense', 'other', 200, 'completed'),
      transactionDate: new Date('2026-02-22T20:59:59.999Z'),
    },
    {
      ...createTransaction('seven-days-start', 'expense', 'other', 5, 'completed'),
      transactionDate: new Date('2026-02-22T21:00:00.000Z'),
    },
    {
      ...createTransaction('future', 'income', 'sale', 999, 'completed'),
      transactionDate: new Date('2026-03-01T01:30:00.001Z'),
    },
    {
      ...createTransaction('pending', 'income', 'sale', 999, 'pending'),
      transactionDate: new Date('2026-03-01T00:30:00.000Z'),
    },
  ]

  await withRepository((database) => {
    for (const transaction of transactions) insertTransaction(database, transaction)
  }, async (repository) => {
    const today = await repository.getAccountingReport({
      period: 'today',
      limit: 2,
      window: todayWindow,
    })

    deepEqual(today.summary, {
      totalIncome: 50,
      totalExpense: 10,
      financialBalance: 40,
      transactionCount: 3,
    })
    deepEqual(today.categories, { sale: 30, purchase: 10, other: 20 })
    deepEqual(today.transactions.map((transaction) => transaction.id), [
      'today-expense',
      'today-income-b',
    ])

    const secondPage = await repository.getAccountingReport({
      period: 'today',
      limit: 2,
      window: todayWindow,
      cursor: {
        transactionDate: today.transactions.at(-1)!.transactionDate,
        id: today.transactions.at(-1)!.id,
      },
    })
    deepEqual(secondPage.transactions.map((transaction) => transaction.id), [
      'today-income-a',
    ])

    const incomeOnly = await repository.getAccountingReport({
      period: 'today',
      type: 'income',
      limit: 50,
      window: todayWindow,
    })
    deepEqual(incomeOnly.summary, {
      totalIncome: 50,
      totalExpense: 0,
      financialBalance: 50,
      transactionCount: 2,
    })
    deepEqual(incomeOnly.categories, { sale: 30, purchase: 0, other: 20 })

    const expenses = await repository.getAccountingReport({
      period: '7days',
      type: 'expense',
      limit: 50,
      window: sevenDaysWindow,
    })
    deepEqual(expenses.summary, {
      totalIncome: 0,
      totalExpense: 15,
      financialBalance: -15,
      transactionCount: 2,
    })
    deepEqual(expenses.categories, { sale: 0, purchase: 10, other: 5 })

    const month = await repository.getAccountingReport({
      period: 'month',
      limit: 50,
      window: monthWindow,
    })
    equal(month.transactions.some((transaction) => transaction.id === 'before-today'), false)
    equal(month.transactions.some((transaction) => transaction.id === 'future'), false)

    const all = await repository.getAccountingReport({
      period: 'all',
      limit: 50,
      window: resolveAccountingReportWindow('all', now),
    })
    equal(all.transactions.some((transaction) => transaction.id === 'future'), false)
    equal(all.transactions.some((transaction) => transaction.id === 'before-today'), true)
  })
})

test('SqliteReportingQueryRepository reads a timezone-bounded operational sales report', async () => {
  const now = new Date('2026-03-01T01:30:00.000Z')
  const sales = [
    {
      ...createSale('historical-completed', 'completed'),
      saleDate: new Date('2026-02-01T12:00:00.000Z'),
      totalAmount: 10,
    },
    {
      ...createSale('before-today', 'completed'),
      saleDate: new Date('2026-02-28T20:59:59.999Z'),
      totalAmount: 999,
    },
    {
      ...createSale('today-completed', 'completed'),
      saleDate: new Date('2026-02-28T21:00:00.000Z'),
      totalAmount: 100,
    },
    {
      ...createSale('today-draft', 'draft'),
      saleDate: new Date('2026-02-28T21:00:00.000Z'),
      totalAmount: 200,
    },
    {
      ...createSale('today-cancelled', 'cancelled'),
      saleDate: new Date('2026-03-01T00:00:00.000Z'),
      totalAmount: 300,
    },
    {
      ...createSale('before-seven-days', 'completed'),
      saleDate: new Date('2026-02-22T20:59:59.999Z'),
      totalAmount: 999,
    },
    {
      ...createSale('seven-days-start', 'draft'),
      saleDate: new Date('2026-02-22T21:00:00.000Z'),
      totalAmount: 400,
    },
    {
      ...createSale('future', 'completed'),
      saleDate: new Date('2026-03-01T01:30:00.001Z'),
      totalAmount: 999,
    },
  ]

  await withRepository((database) => {
    for (const sale of sales) insertSale(database, sale)
  }, async (repository) => {
    deepEqual(await repository.getSalesReport({
      period: 'today',
      window: resolveReportingPeriodWindow('today', now),
    }), {
      period: 'today',
      statusCounts: { draft: 1, completed: 1, cancelled: 1 },
      completedAmount: 100,
    })

    deepEqual(await repository.getSalesReport({
      period: '7days',
      window: resolveReportingPeriodWindow('7days', now),
    }), {
      period: '7days',
      statusCounts: { draft: 2, completed: 2, cancelled: 1 },
      completedAmount: 1099,
    })

    deepEqual(await repository.getSalesReport({
      period: 'month',
      window: resolveReportingPeriodWindow('month', now),
    }), {
      period: 'month',
      statusCounts: { draft: 1, completed: 1, cancelled: 1 },
      completedAmount: 100,
    })

    deepEqual(await repository.getSalesReport({
      period: 'all',
      window: resolveReportingPeriodWindow('all', now),
    }), {
      period: 'all',
      statusCounts: { draft: 2, completed: 4, cancelled: 1 },
      completedAmount: 2108,
    })
  })
})
