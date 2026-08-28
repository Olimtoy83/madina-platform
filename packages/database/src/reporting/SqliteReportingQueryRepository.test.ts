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
