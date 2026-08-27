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
import test from 'node:test'
import {
  hashSessionSecret,
  type User,
} from '@madina/auth'
import type {
  ImportCommerceSnapshotRequest,
} from '@madina/api'
import type {
  Product,
  Purchase,
  Sale,
} from '@madina/core'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteCommerceRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

const now = new Date('2026-08-27T00:00:00.000Z')

function createProduct(quantity = 10): Product {
  return {
    id: 'product-1',
    createdAt: now,
    updatedAt: now,
    name: 'Финики',
    category: 'dates',
    quantity,
    unit: 'kg',
    costPrice: 10,
    salePrice: 15,
    status: 'active',
  }
}

function createPurchase(): Purchase {
  return {
    id: 'purchase-1',
    createdAt: now,
    updatedAt: now,
    purchaseNumber: 'PUR-0001',
    purchaseDate: now,
    supplierName: 'Поставщик',
    totalAmount: 50,
    paymentMethod: 'cash',
    status: 'draft',
    items: [{
      productId: 'product-1',
      quantity: 5,
      unit: 'kg',
      unitCost: 10,
      totalCost: 50,
    }],
  }
}

function createSale(quantity = 3): Sale {
  return {
    id: 'sale-1',
    createdAt: now,
    updatedAt: now,
    saleNumber: 'SAL-0001',
    saleDate: now,
    clientName: 'Клиент',
    totalAmount: quantity * 15,
    paymentMethod: 'cash',
    status: 'draft',
    items: [{
      productId: 'product-1',
      quantity,
      unit: 'kg',
      unitPrice: 15,
      totalAmount: quantity * 15,
    }],
  }
}

async function seedAdminSession(databaseFile: string): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const sessionSecret = 'commerce-routes-test-session'
  const timestamp = new Date()
  const user: User = {
    id: 'commerce-routes-admin',
    username: 'commerce.routes.admin',
    normalizedUsername: 'commerce.routes.admin',
    role: 'admin',
    status: 'active',
    sessionVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  try {
    await repository.createUser(user)
    await repository.createSession({
      id: 'commerce-routes-session',
      userId: user.id,
      tokenHash: hashSessionSecret(sessionSecret),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000),
      sessionVersion: user.sessionVersion,
    })
  } finally {
    repository.close()
  }

  return sessionSecret
}

async function withApp(
  seed: (repository: SqliteCommerceRepository) => Promise<void>,
  run: (app: FastifyInstance) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-commerce-routes-'))
  const databaseFile = join(directory, 'commerce.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const repository = new SqliteCommerceRepository(databaseFile)

  try {
    await seed(repository)
  } finally {
    repository.close()
  }

  const sessionSecret = await seedAdminSession(databaseFile)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const inject = app.inject.bind(app)
  app.inject = ((options: {
    headers?: Record<string, string>
  }) => inject({
    ...options,
    headers: {
      cookie: `madina-session=${sessionSecret}`,
      origin: 'http://localhost:3000',
      ...options.headers,
    },
  })) as typeof app.inject

  try {
    await app.ready()
    await run(app)
  } finally {
    await app.close()

    if (previousDatabaseFile === undefined) {
      delete process.env.DATABASE_FILE
    } else {
      process.env.DATABASE_FILE = previousDatabaseFile
    }

    rmSync(directory, { recursive: true, force: true })
  }
}

async function getJson(
  app: FastifyInstance,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await app.inject({ method: 'GET', url })
  equal(response.statusCode, 200)
  return response.json() as Record<string, unknown>
}

function createSnapshot(): ImportCommerceSnapshotRequest {
  const timestamp = now.toISOString()

  return {
    products: [{
      id: 'product-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      name: 'Финики',
      category: 'dates',
      quantity: 5,
      unit: 'kg',
      costPrice: 10,
      salePrice: 15,
      status: 'active',
    }],
    stockMovements: [{
      id: 'movement-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      productId: 'product-1',
      type: 'purchase',
      quantity: 5,
      unit: 'kg',
      referenceId: 'purchase-1',
    }],
    purchases: [{
      id: 'purchase-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      purchaseNumber: 'PUR-0001',
      purchaseDate: timestamp,
      supplierName: 'Поставщик',
      items: [{
        productId: 'product-1',
        quantity: 5,
        unit: 'kg',
        unitCost: 10,
        totalCost: 50,
      }],
      totalAmount: 50,
      paymentMethod: 'cash',
      status: 'completed',
    }],
    sales: [],
    transactions: [{
      id: 'transaction-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      type: 'expense',
      category: 'purchase',
      amount: 50,
      paymentMethod: 'cash',
      transactionDate: timestamp,
      referenceId: 'purchase-1',
      description: 'Поступление PUR-0001',
      status: 'completed',
    }],
  }
}

async function importSnapshot(
  app: FastifyInstance,
  snapshot: ImportCommerceSnapshotRequest,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/commerce/import',
    payload: snapshot,
  })
}

test('commerce routes return the persisted read model', async () => {
  await withApp(
    async (repository) => {
      await repository.saveProduct(createProduct())
      await repository.savePurchase(createPurchase())
      await repository.saveSale(createSale())
    },
    async (app) => {
      const products = await getJson(app, '/api/v1/commerce/products')
      const stockMovements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const purchases = await getJson(app, '/api/v1/commerce/purchases')
      const sales = await getJson(app, '/api/v1/commerce/sales')
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      equal((products.products as unknown[]).length, 1)
      equal((purchases.purchases as unknown[]).length, 1)
      equal((sales.sales as unknown[]).length, 1)
      deepEqual(stockMovements.stockMovements, [])
      deepEqual(transactions.transactions, [])
    },
  )
})

test('commerce routes complete a purchase once', async () => {
  await withApp(
    async (repository) => {
      await repository.saveProduct(createProduct())
      await repository.savePurchase(createPurchase())
    },
    async (app) => {
      const completion = await app.inject({
        method: 'POST',
        url: '/api/v1/commerce/purchases/purchase-1/complete',
      })

      equal(completion.statusCode, 200)
      deepEqual(completion.json(), {
        success: true,
        idempotent: false,
      })

      const products = await getJson(app, '/api/v1/commerce/products')
      const movements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      equal((products.products as Array<{ quantity: number }>)[0]?.quantity, 15)
      equal((movements.stockMovements as unknown[]).length, 1)
      equal((transactions.transactions as unknown[]).length, 1)
    },
  )
})

test('commerce routes complete a sale once', async () => {
  await withApp(
    async (repository) => {
      await repository.saveProduct(createProduct())
      await repository.saveSale(createSale())
    },
    async (app) => {
      const completion = await app.inject({
        method: 'POST',
        url: '/api/v1/commerce/sales/sale-1/complete',
      })

      equal(completion.statusCode, 200)
      deepEqual(completion.json(), {
        success: true,
        idempotent: false,
      })

      const products = await getJson(app, '/api/v1/commerce/products')
      equal((products.products as Array<{ quantity: number }>)[0]?.quantity, 7)
    },
  )
})

test('commerce routes make repeated completion idempotent', async () => {
  await withApp(
    async (repository) => {
      await repository.saveProduct(createProduct())
      await repository.savePurchase(createPurchase())
    },
    async (app) => {
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/commerce/purchases/purchase-1/complete',
      })
      const repeated = await app.inject({
        method: 'POST',
        url: '/api/v1/commerce/purchases/purchase-1/complete',
      })

      equal(first.statusCode, 200)
      equal(repeated.statusCode, 200)
      deepEqual(repeated.json(), {
        success: true,
        idempotent: true,
      })

      const products = await getJson(app, '/api/v1/commerce/products')
      const movements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      equal((products.products as Array<{ quantity: number }>)[0]?.quantity, 15)
      equal((movements.stockMovements as unknown[]).length, 1)
      equal((transactions.transactions as unknown[]).length, 1)
    },
  )
})

test('commerce routes roll back an insufficient-stock sale', async () => {
  await withApp(
    async (repository) => {
      await repository.saveProduct(createProduct(2))
      await repository.saveSale(createSale(3))
    },
    async (app) => {
      const completion = await app.inject({
        method: 'POST',
        url: '/api/v1/commerce/sales/sale-1/complete',
      })

      equal(completion.statusCode, 400)
      const completionBody = completion.json() as {
        success: boolean
        idempotent: boolean
        message?: string
      }
      equal(completionBody.success, false)
      equal(completionBody.idempotent, false)
      equal(
        completionBody.message?.startsWith('Недостаточно товара на складе.'),
        true,
      )

      const products = await getJson(app, '/api/v1/commerce/products')
      const sales = await getJson(app, '/api/v1/commerce/sales')
      const movements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      equal((products.products as Array<{ quantity: number }>)[0]?.quantity, 2)
      equal((sales.sales as Array<{ status: string }>)[0]?.status, 'draft')
      deepEqual(movements.stockMovements, [])
      deepEqual(transactions.transactions, [])
    },
  )
})

test('commerce routes import a full transactional snapshot', async () => {
  await withApp(
    async () => {},
    async (app) => {
      const response = await importSnapshot(app, createSnapshot())

      equal(response.statusCode, 200)
      deepEqual(response.json(), {
        imported: true,
        idempotent: false,
      })

      const products = await getJson(app, '/api/v1/commerce/products')
      const movements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const purchases = await getJson(app, '/api/v1/commerce/purchases')
      const sales = await getJson(app, '/api/v1/commerce/sales')
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      equal((products.products as unknown[]).length, 1)
      equal((movements.stockMovements as unknown[]).length, 1)
      equal((purchases.purchases as unknown[]).length, 1)
      deepEqual(sales.sales, [])
      equal((transactions.transactions as unknown[]).length, 1)
      equal(
        (products.products as Array<{ createdAt: string }>)[0]?.createdAt,
        now.toISOString(),
      )
      equal(
        (purchases.purchases as Array<{ status: string }>)[0]?.status,
        'completed',
      )
      equal(
        (movements.stockMovements as Array<{ referenceId: string }>)[0]?.referenceId,
        'purchase-1',
      )
    },
  )
})

test('commerce snapshot import validates product balances and rolls back', async () => {
  await withApp(
    async () => {},
    async (app) => {
      const snapshot = createSnapshot()
      snapshot.products[0]!.quantity = 4

      const response = await importSnapshot(app, snapshot)
      equal(response.statusCode, 400)

      const products = await getJson(app, '/api/v1/commerce/products')
      const purchases = await getJson(app, '/api/v1/commerce/purchases')
      const movements = await getJson(
        app,
        '/api/v1/commerce/stock-movements',
      )
      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )

      deepEqual(products.products, [])
      deepEqual(purchases.purchases, [])
      deepEqual(movements.stockMovements, [])
      deepEqual(transactions.transactions, [])
    },
  )
})

test('commerce snapshot import rejects broken entity references', async () => {
  await withApp(
    async () => {},
    async (app) => {
      const snapshot = createSnapshot()
      snapshot.purchases[0]!.items[0]!.productId = 'missing-product'

      const response = await importSnapshot(app, snapshot)
      equal(response.statusCode, 400)

      const products = await getJson(app, '/api/v1/commerce/products')
      deepEqual(products.products, [])
    },
  )
})

test('commerce snapshot import rejects duplicate transaction references', async () => {
  await withApp(
    async () => {},
    async (app) => {
      const snapshot = createSnapshot()
      snapshot.transactions.push({
        ...snapshot.transactions[0]!,
        id: 'transaction-2',
      })

      const response = await importSnapshot(app, snapshot)
      equal(response.statusCode, 400)

      const transactions = await getJson(
        app,
        '/api/v1/commerce/transactions',
      )
      deepEqual(transactions.transactions, [])
    },
  )
})

test('commerce snapshot import is idempotent and never overwrites state', async () => {
  await withApp(
    async () => {},
    async (app) => {
      const snapshot = createSnapshot()
      const first = await importSnapshot(app, snapshot)
      const repeated = await importSnapshot(app, snapshot)
      const conflictingSnapshot = createSnapshot()
      conflictingSnapshot.products[0]!.name = 'Другие финики'
      const conflicting = await importSnapshot(app, conflictingSnapshot)

      equal(first.statusCode, 200)
      deepEqual(repeated.json(), {
        imported: false,
        idempotent: true,
      })
      equal(conflicting.statusCode, 400)

      const products = await getJson(app, '/api/v1/commerce/products')
      equal(
        (products.products as Array<{ name: string }>)[0]?.name,
        'Финики',
      )
    },
  )
})
