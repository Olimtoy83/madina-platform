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
  hashSessionSecret,
  type AuthSession,
  type User,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuthRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

type TestRole = 'admin' | 'manager' | 'operator' | 'viewer'

function createUser(id: string, role: TestRole): User {
  const now = new Date('2026-08-28T12:00:00.000Z')

  return {
    id,
    username: id,
    normalizedUsername: id,
    role,
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

async function seedSession(
  databaseFile: string,
  id: string,
  role: TestRole,
): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const now = new Date('2026-08-28T12:00:00.000Z')
  const secret = `reporting-session-secret-${id}`

  try {
    const user = createUser(id, role)
    await repository.createUser(user)

    const session: AuthSession = {
      id: `session-${id}`,
      userId: id,
      tokenHash: hashSessionSecret(secret),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date('2026-09-04T12:00:00.000Z'),
      sessionVersion: 1,
    }
    await repository.createSession(session)
  } finally {
    repository.close()
  }

  return `madina-session=${secret}`
}

function insertTransaction(
  database: DatabaseSync,
  input: {
    id: string
    type: 'income' | 'expense'
    amount: number
    transactionDate: string
    category?: 'sale' | 'purchase' | 'other'
    status?: 'pending' | 'completed' | 'cancelled'
  },
): void {
  database.prepare(`
    INSERT INTO transactions (
      id, created_at, updated_at, type, category, amount, payment_method,
      transaction_date, reference_id, description, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    '2020-01-01T00:00:00.000Z',
    '2020-01-01T00:00:00.000Z',
    input.type,
    input.category ?? (input.type === 'income' ? 'sale' : 'purchase'),
    input.amount,
    'cash',
    input.transactionDate,
    null,
    'Reporting test transaction',
    input.status ?? 'completed',
  )
}

async function withApp(
  seed: (databaseFile: string) => void,
  run: (
    app: FastifyInstance,
    cookies: Record<TestRole, string>,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-reporting-routes-'))
  const databaseFile = join(directory, 'reporting.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)

  const cookies = {
    admin: await seedSession(databaseFile, 'reporting-admin', 'admin'),
    manager: await seedSession(databaseFile, 'reporting-manager', 'manager'),
    operator: await seedSession(databaseFile, 'reporting-operator', 'operator'),
    viewer: await seedSession(databaseFile, 'reporting-viewer', 'viewer'),
  }

  seed(databaseFile)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await app.ready()
    await run(app, cookies)
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

test('reporting summary requires a session and is readable by every reports:read role', async () => {
  await withApp(() => {}, async (app, cookies) => {
    equal((await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary',
    })).statusCode, 401)

    for (const role of ['viewer', 'operator', 'manager', 'admin'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reports/summary',
        headers: { cookie: cookies[role] },
      })

      equal(response.statusCode, 200)
      deepEqual(response.json(), {
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
    }
  })
})

test('reporting summary returns only the aggregate response DTO', async () => {
  await withApp((databaseFile) => {
    const database = new DatabaseSync(databaseFile)

    try {
      database.exec(`
        INSERT INTO products VALUES
          ('product-kg-active', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'Финики', 'dates', 10, 'kg', 10, 15, 'active'),
          ('product-box-inactive', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'Коробка', 'dates', 2, 'box', 10, 15, 'inactive');
        INSERT INTO sales VALUES
          ('sale-completed', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'SAL-0001', '2026-08-01T00:00:00.000Z', NULL, 'Клиент', 100, 'cash', 'completed', NULL),
          ('sale-draft', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'SAL-0002', '2026-08-01T00:00:00.000Z', NULL, 'Клиент', 100, 'cash', 'draft', NULL);
        INSERT INTO transactions VALUES
          ('income-sale', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'income', 'sale', 100, 'cash', '2026-08-01T00:00:00.000Z', NULL, NULL, 'completed'),
          ('income-other', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'income', 'other', 20, 'cash', '2026-08-01T00:00:00.000Z', NULL, NULL, 'completed'),
          ('expense-purchase', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'expense', 'purchase', 40, 'cash', '2026-08-01T00:00:00.000Z', NULL, NULL, 'completed'),
          ('income-pending', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'income', 'sale', 999, 'cash', '2026-08-01T00:00:00.000Z', NULL, NULL, 'pending');
      `)
    } finally {
      database.close()
    }
  }, async (app, cookies) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/summary',
      headers: { cookie: cookies.viewer },
    })

    equal(response.statusCode, 200)
    const payload = response.json() as Record<string, unknown>

    deepEqual(payload, {
      sales: { completedCount: 1 },
      financial: {
        totalIncome: 120,
        totalExpense: 40,
        financialBalance: 80,
        revenue: 100,
        purchaseExpense: 40,
      },
      inventory: {
        productCount: 2,
        activeProductCount: 1,
        stockByUnit: [
          { unit: 'box', quantity: 2 },
          { unit: 'kg', quantity: 10 },
        ],
      },
    })
    deepEqual(Object.keys(payload).sort(), [
      'financial',
      'inventory',
      'sales',
    ])
    equal(JSON.stringify(payload).includes('password'), false)
    equal(JSON.stringify(payload).includes('session'), false)
    equal(JSON.stringify(payload).includes('metadata'), false)
    equal(JSON.stringify(payload).includes('transactions'), false)
    equal(JSON.stringify(payload).includes('products'), false)
  })
})

test('income report returns an all-time summary and a keyset-paginated effective list', async () => {
  await withApp((databaseFile) => {
    const database = new DatabaseSync(databaseFile)

    try {
      for (let index = 0; index < 52; index += 1) {
        insertTransaction(database, {
          id: `income-${String(index).padStart(3, '0')}`,
          type: 'income',
          amount: 1,
          transactionDate: '2020-01-02T00:00:00.000Z',
        })
      }
      insertTransaction(database, {
        id: 'expense-001',
        type: 'expense',
        amount: 10,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
      insertTransaction(database, {
        id: 'pending-income',
        type: 'income',
        amount: 999,
        transactionDate: '2020-01-02T00:00:00.000Z',
        status: 'pending',
      })
      insertTransaction(database, {
        id: 'cancelled-expense',
        type: 'expense',
        amount: 999,
        transactionDate: '2020-01-02T00:00:00.000Z',
        status: 'cancelled',
      })
      insertTransaction(database, {
        id: 'future-income',
        type: 'income',
        amount: 999,
        transactionDate: '2099-01-01T00:00:00.000Z',
      })
    } finally {
      database.close()
    }
  }, async (app, cookies) => {
    equal((await app.inject({
      method: 'GET',
      url: '/api/v1/reports/income',
    })).statusCode, 401)

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/income',
      headers: { cookie: cookies.viewer },
    })
    equal(first.statusCode, 200)
    const firstPayload = first.json() as {
      summary: Record<string, number>
      transactions: {
        items: Array<Record<string, unknown>>
        nextCursor?: string
      }
    }
    deepEqual(firstPayload.summary, {
      totalIncome: 52,
      totalExpense: 10,
      financialBalance: 42,
    })
    equal(firstPayload.transactions.items.length, 50)
    equal(firstPayload.transactions.items[0]?.id, 'income-051')
    equal(firstPayload.transactions.items.at(-1)?.id, 'income-002')
    equal(typeof firstPayload.transactions.nextCursor, 'string')
    deepEqual(Object.keys(firstPayload.transactions.items[0] ?? {}).sort(), [
      'amount', 'category', 'description', 'id', 'paymentMethod',
      'status', 'transactionDate', 'type',
    ])

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/income?cursor=${encodeURIComponent(firstPayload.transactions.nextCursor!)}`,
      headers: { cookie: cookies.viewer },
    })
    equal(second.statusCode, 200)
    const secondPayload = second.json() as {
      transactions: { items: Array<{ id: string }>; nextCursor?: string }
    }
    deepEqual(secondPayload.transactions.items.map((item) => item.id), [
      'income-001',
      'income-000',
      'expense-001',
    ])
    equal(secondPayload.transactions.nextCursor, undefined)

    const incomeOnly = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/income?type=income&limit=2',
      headers: { cookie: cookies.viewer },
    })
    equal(incomeOnly.statusCode, 200)
    const incomePayload = incomeOnly.json() as {
      summary: Record<string, number>
      transactions: { items: Array<{ type: string }> }
    }
    deepEqual(incomePayload.summary, firstPayload.summary)
    equal(incomePayload.transactions.items.every((item) => item.type === 'income'), true)

    const expenseOnly = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/income?type=expense',
      headers: { cookie: cookies.viewer },
    })
    equal(expenseOnly.statusCode, 200)
    const expensePayload = expenseOnly.json() as {
      summary: Record<string, number>
      transactions: { items: Array<{ id: string; type: string }> }
    }
    deepEqual(expensePayload.summary, firstPayload.summary)
    deepEqual(expensePayload.transactions.items.map((item) => ({
      id: item.id,
      type: item.type,
    })), [{ id: 'expense-001', type: 'expense' }])
  })
})

test('income report validates query parameters and cursor filters', async () => {
  await withApp((databaseFile) => {
    const database = new DatabaseSync(databaseFile)

    try {
      insertTransaction(database, {
        id: 'income-001',
        type: 'income',
        amount: 1,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
      insertTransaction(database, {
        id: 'income-000',
        type: 'income',
        amount: 1,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
    } finally {
      database.close()
    }
  }, async (app, cookies) => {
    for (const query of [
      '?type=other',
      '?limit=0',
      '?limit=101',
      '?limit=1.5',
      '?cursor=not+a+cursor',
      '?status=completed',
    ]) {
      equal((await app.inject({
        method: 'GET',
        url: `/api/v1/reports/income${query}`,
        headers: { cookie: cookies.viewer },
      })).statusCode, 400)
    }

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/income?type=income&limit=1',
      headers: { cookie: cookies.viewer },
    })
    equal(first.statusCode, 200)
    const cursor = (first.json() as {
      transactions: { nextCursor?: string }
    }).transactions.nextCursor
    equal(typeof cursor, 'string')

    equal((await app.inject({
      method: 'GET',
      url: `/api/v1/reports/income?type=expense&cursor=${encodeURIComponent(cursor!)}`,
      headers: { cookie: cookies.viewer },
    })).statusCode, 400)
  })
})

test('accounting report applies period and type filters to all metrics and returns only its DTO', async () => {
  await withApp((databaseFile) => {
    const database = new DatabaseSync(databaseFile)

    try {
      insertTransaction(database, {
        id: 'accounting-income-sale',
        type: 'income',
        category: 'sale',
        amount: 100,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
      insertTransaction(database, {
        id: 'accounting-income-other',
        type: 'income',
        category: 'other',
        amount: 20,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
      insertTransaction(database, {
        id: 'accounting-expense-sale',
        type: 'expense',
        category: 'sale',
        amount: 40,
        transactionDate: '2020-01-01T00:00:00.000Z',
      })
    } finally {
      database.close()
    }
  }, async (app, cookies) => {
    equal((await app.inject({
      method: 'GET',
      url: '/api/v1/reports/accounting',
    })).statusCode, 401)

    for (const role of ['viewer', 'operator', 'manager', 'admin'] as const) {
      equal((await app.inject({
        method: 'GET',
        url: '/api/v1/reports/accounting?period=all',
        headers: { cookie: cookies[role] },
      })).statusCode, 200)
    }

    for (const query of ['', '?period=today', '?period=7days', '?period=month']) {
      equal((await app.inject({
        method: 'GET',
        url: `/api/v1/reports/accounting${query}`,
        headers: { cookie: cookies.viewer },
      })).statusCode, 200)
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/accounting?period=all&type=income',
      headers: { cookie: cookies.viewer },
    })
    equal(response.statusCode, 200)
    const payload = response.json() as {
      summary: Record<string, number>
      categories: Record<string, number>
      transactions: { items: Array<Record<string, unknown>> }
    }
    deepEqual(payload.summary, {
      totalIncome: 120,
      totalExpense: 0,
      financialBalance: 120,
      transactionCount: 2,
    })
    deepEqual(payload.categories, { sale: 100, purchase: 0, other: 20 })
    equal(payload.transactions.items.every((item) => item.type === 'income'), true)
    deepEqual(Object.keys(payload.transactions.items[0] ?? {}).sort(), [
      'amount', 'category', 'description', 'id', 'paymentMethod',
      'status', 'transactionDate', 'type',
    ])

    const expenseResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/accounting?period=all&type=expense',
      headers: { cookie: cookies.viewer },
    })
    equal(expenseResponse.statusCode, 200)
    deepEqual((expenseResponse.json() as {
      summary: Record<string, number>
      categories: Record<string, number>
    }), {
      summary: {
        totalIncome: 0,
        totalExpense: 40,
        financialBalance: -40,
        transactionCount: 1,
      },
      categories: { sale: 40, purchase: 0, other: 0 },
      transactions: {
        items: [{
          id: 'accounting-expense-sale',
          type: 'expense',
          category: 'sale',
          amount: 40,
          paymentMethod: 'cash',
          transactionDate: '2020-01-01T00:00:00.000Z',
          description: 'Reporting test transaction',
          status: 'completed',
        }],
      },
    })
  })
})

test('accounting report validates queries and freezes its cursor reporting window', async () => {
  await withApp((databaseFile) => {
    const database = new DatabaseSync(databaseFile)

    try {
      insertTransaction(database, {
        id: 'accounting-page-b',
        type: 'income',
        amount: 1,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
      insertTransaction(database, {
        id: 'accounting-page-a',
        type: 'income',
        amount: 1,
        transactionDate: '2020-01-02T00:00:00.000Z',
      })
    } finally {
      database.close()
    }
  }, async (app, cookies) => {
    for (const query of [
      '?period=year',
      '?type=other',
      '?limit=0',
      '?limit=101',
      '?limit=1.5',
      '?cursor=not+a+cursor',
      '?category=sale',
    ]) {
      equal((await app.inject({
        method: 'GET',
        url: `/api/v1/reports/accounting${query}`,
        headers: { cookie: cookies.viewer },
      })).statusCode, 400)
    }

    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/accounting?period=all&type=income&limit=1',
      headers: { cookie: cookies.viewer },
    })
    equal(first.statusCode, 200)
    const cursor = (first.json() as {
      transactions: { nextCursor?: string }
    }).transactions.nextCursor
    equal(typeof cursor, 'string')
    const decoded = JSON.parse(Buffer.from(cursor!, 'base64url').toString('utf8')) as {
      window: { to: string }
    }
    equal(typeof decoded.window.to, 'string')

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/accounting?period=all&type=income&limit=1&cursor=${encodeURIComponent(cursor!)}`,
      headers: { cookie: cookies.viewer },
    })
    equal(second.statusCode, 200)
    deepEqual((second.json() as {
      transactions: { items: Array<{ id: string }> }
    }).transactions.items.map((item) => item.id), ['accounting-page-a'])

    equal((await app.inject({
      method: 'GET',
      url: `/api/v1/reports/accounting?period=month&cursor=${encodeURIComponent(cursor!)}`,
      headers: { cookie: cookies.viewer },
    })).statusCode, 400)
  })
})
