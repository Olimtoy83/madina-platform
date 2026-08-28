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
