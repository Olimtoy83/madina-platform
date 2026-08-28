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

function createProduct(quantity = 0): Product {
  return {
    id: 'product-1', createdAt: now, updatedAt: now,
    name: 'Финики', category: 'dates', quantity, unit: 'kg',
    costPrice: 10, salePrice: 15, status: 'active',
  }
}

function createPurchase(status: Purchase['status'] = 'draft'): Purchase {
  return {
    id: 'purchase-1', createdAt: now, updatedAt: now,
    purchaseNumber: 'PUR-0001', purchaseDate: now,
    supplierName: 'Поставщик', totalAmount: 50,
    paymentMethod: 'cash', status,
    items: [{ productId: 'product-1', quantity: 5, unit: 'kg', unitCost: 10, totalCost: 50 }],
  }
}

function createSale(status: Sale['status'] = 'draft'): Sale {
  return {
    id: 'sale-1', createdAt: now, updatedAt: now,
    saleNumber: 'SAL-0001', saleDate: now, clientName: 'Клиент',
    totalAmount: 45, paymentMethod: 'cash', status,
    items: [{ productId: 'product-1', quantity: 3, unit: 'kg', unitPrice: 15, totalAmount: 45 }],
  }
}

async function seedAdminSession(databaseFile: string): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const sessionSecret = 'commerce-mutations-test-session'
  const timestamp = new Date()
  const user: User = {
    id: 'commerce-mutations-admin',
    username: 'commerce.mutations.admin',
    normalizedUsername: 'commerce.mutations.admin',
    role: 'admin',
    status: 'active',
    sessionVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  try {
    await repository.createUser(user)
    await repository.createSession({
      id: 'commerce-mutations-session',
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
) {
  const directory = mkdtempSync(join(tmpdir(), 'madina-commerce-mutations-'))
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
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
}

async function read(app: FastifyInstance, url: string) {
  const response = await app.inject({ method: 'GET', url })
  equal(response.statusCode, 200)
  return response.json() as Record<string, unknown>
}

const purchaseInput = {
  purchaseNumber: 'PUR-0002',
  purchaseDate: now.toISOString(),
  supplierName: 'Новый поставщик',
  items: [{ productId: 'product-1', quantity: 2, unit: 'kg', unitCost: 11, totalCost: 22 }],
  paymentMethod: 'cash',
}

const saleInput = {
  saleNumber: 'SAL-0002',
  saleDate: now.toISOString(),
  clientName: 'Новый клиент',
  items: [{ productId: 'product-1', quantity: 2, unit: 'kg', unitPrice: 15, totalAmount: 30 }],
  paymentMethod: 'cash',
}

test('commerce mutation routes create, update, and deactivate products', async () => {
  await withApp(async () => {}, async (app) => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products',
      payload: {
        name: 'Ковер', category: 'carpets', unit: 'piece',
        costPrice: 100, salePrice: 150, status: 'active', initialQuantity: 2,
      },
    })
    equal(created.statusCode, 201)
    const product = created.json() as { id: string; quantity: number }
    equal(product.quantity, 2)

    const updated = await app.inject({
      method: 'PATCH', url: `/api/v1/commerce/products/${product.id}`,
      payload: { name: 'Ковер премиум', salePrice: 175, quantity: 99 },
    })
    equal(updated.statusCode, 200)
    const updatedProduct = updated.json() as { name: string; quantity: number }
    equal(updatedProduct.name, 'Ковер премиум')
    equal(updatedProduct.quantity, 2)

    const deactivated = await app.inject({
      method: 'POST', url: `/api/v1/commerce/products/${product.id}/deactivate`,
    })
    equal(deactivated.statusCode, 200)
    equal((deactivated.json() as { status: string }).status, 'inactive')

    const movements = await read(app, '/api/v1/commerce/stock-movements')
    equal((movements.stockMovements as unknown[]).length, 1)
  })
})

test('product mutation routes enforce shared name and numeric validation', async () => {
  await withApp(async () => {}, async (app) => {
    const invalid = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products',
      payload: {
        name: '   ', category: 'dates', unit: 'kg',
        costPrice: -1, salePrice: Number.POSITIVE_INFINITY,
        status: 'active', initialQuantity: -1,
      },
    })
    equal(invalid.statusCode, 400)

    const created = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products',
      payload: {
        name: '  Zero price dates  ', category: 'dates', unit: 'kg',
        costPrice: 0, salePrice: 0, status: 'active', initialQuantity: 0,
      },
    })
    equal(created.statusCode, 201)
    const product = created.json() as { id: string; name: string }
    equal(product.name, 'Zero price dates')

    const invalidUpdate = await app.inject({
      method: 'PATCH', url: `/api/v1/commerce/products/${product.id}`,
      payload: { salePrice: -1 },
    })
    equal(invalidUpdate.statusCode, 400)

    const update = await app.inject({
      method: 'PATCH', url: `/api/v1/commerce/products/${product.id}`,
      payload: { name: '  Updated dates  ', salePrice: 0 },
    })
    equal(update.statusCode, 200)
    equal((update.json() as { name: string; salePrice: number }).name, 'Updated dates')
    equal((update.json() as { name: string; salePrice: number }).salePrice, 0)
  })
})

test('stock adjustment persists product and movement atomically', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct(2))
  }, async (app) => {
    const adjusted = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/product-1/stock-adjustments',
      payload: { quantity: -1, note: 'Пересчёт' },
    })
    equal(adjusted.statusCode, 200)
    equal((adjusted.json() as { product: { quantity: number } }).product.quantity, 1)

    const rejected = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/product-1/stock-adjustments',
      payload: { quantity: -2 },
    })
    equal(rejected.statusCode, 400)

    const products = await read(app, '/api/v1/commerce/products')
    const movements = await read(app, '/api/v1/commerce/stock-movements')
    equal((products.products as Array<{ quantity: number }>)[0]?.quantity, 1)
    equal((movements.stockMovements as unknown[]).length, 1)
  })
})

test('product unit update preserves existing core validation', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct(1))
  }, async (app) => {
    const response = await app.inject({
      method: 'PATCH', url: '/api/v1/commerce/products/product-1',
      payload: { unit: 'piece' },
    })
    equal(response.statusCode, 400)
    const products = await read(app, '/api/v1/commerce/products')
    equal((products.products as Array<{ unit: string }>)[0]?.unit, 'kg')
  })
})

test('commerce mutation routes create, update, and cancel draft purchases', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct())
  }, async (app) => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/commerce/purchases', payload: purchaseInput })
    equal(created.statusCode, 201)
    const purchaseId = (created.json() as { id: string }).id
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/commerce/purchases/${purchaseId}`, payload: { supplierName: 'Другой поставщик' } })
    equal(updated.statusCode, 200)
    equal((updated.json() as { supplierName: string }).supplierName, 'Другой поставщик')
    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/commerce/purchases/${purchaseId}/cancel` })
    equal(cancelled.statusCode, 200)
    equal((cancelled.json() as { status: string }).status, 'cancelled')
  })
})

test('commerce mutation routes reject terminal purchase changes', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct())
    await repository.savePurchase(createPurchase('completed'))
  }, async (app) => {
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/commerce/purchases/purchase-1', payload: { supplierName: 'Другой' } })
    equal(response.statusCode, 400)
    const purchases = await read(app, '/api/v1/commerce/purchases')
    equal((purchases.purchases as Array<{ supplierName: string }>)[0]?.supplierName, 'Поставщик')
  })
})

test('commerce mutation routes create, update, and cancel draft sales', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct())
  }, async (app) => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/commerce/sales', payload: saleInput })
    equal(created.statusCode, 201)
    const saleId = (created.json() as { id: string }).id
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/commerce/sales/${saleId}`, payload: { clientName: 'Другой клиент' } })
    equal(updated.statusCode, 200)
    equal((updated.json() as { clientName: string }).clientName, 'Другой клиент')
    const cancelled = await app.inject({ method: 'POST', url: `/api/v1/commerce/sales/${saleId}/cancel` })
    equal(cancelled.statusCode, 200)
    equal((cancelled.json() as { status: string }).status, 'cancelled')
  })
})

test('commerce mutation routes reject terminal sale changes', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct())
    await repository.saveSale(createSale('completed'))
  }, async (app) => {
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/commerce/sales/sale-1', payload: { clientName: 'Другой' } })
    equal(response.statusCode, 400)
    const sales = await read(app, '/api/v1/commerce/sales')
    deepEqual((sales.sales as Array<{ clientName: string }>)[0]?.clientName, 'Клиент')
  })
})
