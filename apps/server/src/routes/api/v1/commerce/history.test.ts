import { deepEqual, equal, match } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { hashSessionSecret, type User } from '@madina/auth'
import type { Product, StockMovement } from '@madina/core'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteCommerceRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

const movementTime = (value: string) => new Date(value)

function product(
  id: string,
  name: string,
  quantity: number,
  status: Product['status'] = 'active',
): Product {
  const now = movementTime('2025-08-27T00:00:00.000Z')
  return {
    id, name, quantity, status, createdAt: now, updatedAt: now,
    category: 'dates', unit: 'kg', costPrice: 10, salePrice: 15,
  }
}

function movement(
  id: string,
  productId: string,
  type: StockMovement['type'],
  quantity: number,
  createdAt: string,
): StockMovement {
  const timestamp = movementTime(createdAt)
  return {
    id, productId, type, quantity, unit: 'kg',
    createdAt: timestamp, updatedAt: timestamp,
  }
}

async function seedAdminSession(databaseFile: string): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const sessionSecret = 'stock-movement-history-session'
  const now = new Date()
  const user: User = {
    id: 'stock-history-admin', username: 'stock.history.admin',
    normalizedUsername: 'stock.history.admin', role: 'admin', status: 'active',
    sessionVersion: 1, createdAt: now, updatedAt: now,
  }

  try {
    await repository.createUser(user)
    await repository.createSession({
      id: 'stock-history-session', userId: user.id,
      tokenHash: hashSessionSecret(sessionSecret), createdAt: now,
      lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000),
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
  const directory = mkdtempSync(join(tmpdir(), 'madina-stock-history-'))
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
  app.inject = ((options: { headers?: Record<string, string> }) => inject({
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

async function seedHistory(repository: SqliteCommerceRepository): Promise<void> {
  await repository.saveProduct(product('product-1', 'Финики', 6))
  await repository.saveProduct(product('product-2', 'Курага', 1, 'inactive'))
  await repository.withTransaction(async (unitOfWork) => {
    await unitOfWork.saveStockMovements([
      movement('movement-1', 'product-1', 'purchase', 5, '2025-08-28T20:59:59.000Z'),
      movement('movement-2', 'product-1', 'sale', -2, '2025-08-28T21:00:00.000Z'),
      movement('movement-3', 'product-1', 'adjustment', 3, '2025-08-29T12:00:00.000Z'),
      movement('movement-4', 'product-2', 'purchase', 2, '2025-08-29T13:00:00.000Z'),
    ])
  })
}

test('stock movement history is bounded, filterable, and preserves global summary semantics', async () => {
  await withApp(seedHistory, async (app) => {
    const unauthenticated = await app.inject({
      method: 'GET', url: '/api/v1/commerce/stock-movements/history',
      headers: { cookie: '' },
    })
    equal(unauthenticated.statusCode, 401)

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/commerce/stock-movements/history?limit=2',
    })
    equal(first.statusCode, 200)
    const firstPayload = first.json() as {
      summary: Record<string, number>
      stockMovements: { items: Array<{ id: string }>; nextCursor?: string }
    }
    deepEqual(firstPayload.summary, {
      totalMovements: 4, totalPurchases: 7, totalSales: 2,
    })
    deepEqual(firstPayload.stockMovements.items.map((item) => item.id), [
      'movement-4', 'movement-3',
    ])
    equal(typeof firstPayload.stockMovements.nextCursor, 'string')

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/commerce/stock-movements/history?limit=2&cursor=${encodeURIComponent(firstPayload.stockMovements.nextCursor!)}`,
    })
    equal(second.statusCode, 200)
    const secondPayload = second.json() as {
      stockMovements: { items: Array<{ id: string }> }
    }
    deepEqual(secondPayload.stockMovements.items.map((item) => item.id), [
      'movement-2', 'movement-1',
    ])

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/commerce/stock-movements/history?productId=product-1&type=purchase&dateFrom=2025-08-28&dateTo=2025-08-28',
    })
    equal(filtered.statusCode, 200)
    const filteredPayload = filtered.json() as {
      summary: Record<string, number>
      stockMovements: { items: Array<{ id: string }> }
    }
    deepEqual(filteredPayload.stockMovements.items.map((item) => item.id), ['movement-1'])
    deepEqual(filteredPayload.summary, firstPayload.summary)

    for (const url of [
      '/api/v1/commerce/stock-movements/history?limit=101',
      '/api/v1/commerce/stock-movements/history?type=other',
      '/api/v1/commerce/stock-movements/history?dateFrom=2025-02-30',
      '/api/v1/commerce/stock-movements/history?dateFrom=2025-08-30&dateTo=2025-08-29',
      '/api/v1/commerce/stock-movements/history?cursor=bad+cursor',
      `/api/v1/commerce/stock-movements/history?type=sale&cursor=${encodeURIComponent(firstPayload.stockMovements.nextCursor!)}`,
    ]) {
      equal((await app.inject({ method: 'GET', url })).statusCode, 400)
    }
  })
})

test('stock movement history cursor freezes traversal and integrity is reconciled in SQLite', async () => {
  await withApp(seedHistory, async (app) => {
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/commerce/stock-movements/history?limit=3',
    })
    const firstPayload = first.json() as {
      stockMovements: { nextCursor?: string }
    }
    const decoded = JSON.parse(Buffer.from(
      firstPayload.stockMovements.nextCursor!, 'base64url',
    ).toString('utf8')) as { throughCreatedAt: string }
    match(decoded.throughCreatedAt, /^\d{4}-\d{2}-\d{2}T/)

    // The server-held cursor window excludes this later persisted journal row.
    const later = await app.inject({
      method: 'POST',
      url: '/api/v1/commerce/products/product-1/stock-adjustments',
      payload: { quantity: 1, note: 'Later movement' },
    })
    equal(later.statusCode, 200)

    const continuation = await app.inject({
      method: 'GET',
      url: `/api/v1/commerce/stock-movements/history?limit=3&cursor=${encodeURIComponent(firstPayload.stockMovements.nextCursor!)}`,
    })
    equal(continuation.statusCode, 200)
    const continuationPayload = continuation.json() as {
      stockMovements: { items: Array<{ id: string }> }
    }
    deepEqual(continuationPayload.stockMovements.items.map((item) => item.id), [
      'movement-1',
    ])

    const integrity = await app.inject({
      method: 'GET', url: '/api/v1/commerce/stock-movements/integrity',
    })
    equal(integrity.statusCode, 200)
    const integrityPayload = integrity.json() as {
      discrepancies: Array<Record<string, unknown>>
    }
    deepEqual(integrityPayload.discrepancies, [{
      productId: 'product-2', productName: 'Курага', actualQuantity: 1,
      calculatedQuantity: 2, difference: -1,
    }])
  })
})
