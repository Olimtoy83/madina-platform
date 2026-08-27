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
  type UserRole,
} from '@madina/auth'
import type { Product } from '@madina/core'
import {
  SqliteAuthRepository,
  SqliteCommerceRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../app.js'

const now = new Date('2026-08-27T00:00:00.000Z')

interface SessionFixture {
  name: string
  role: UserRole
  status?: User['status']
  expired?: boolean
  revoked?: boolean
}

interface InjectResponse {
  statusCode: number
  json(): unknown
}

function createProduct(): Product {
  return {
    id: 'product-1',
    createdAt: now,
    updatedAt: now,
    name: 'Финики',
    category: 'dates',
    quantity: 10,
    unit: 'kg',
    costPrice: 10,
    salePrice: 15,
    status: 'active',
  }
}

async function seedSessions(
  databaseFile: string,
  fixtures: readonly SessionFixture[],
): Promise<Record<string, string>> {
  const repository = new SqliteAuthRepository(databaseFile)
  const timestamp = new Date()
  const sessionSecrets: Record<string, string> = {}

  try {
    for (const fixture of fixtures) {
      const user: User = {
        id: `user-${fixture.name}`,
        username: `user.${fixture.name}`,
        normalizedUsername: `user.${fixture.name}`,
        role: fixture.role,
        status: fixture.status ?? 'active',
        sessionVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const sessionSecret = `test-session-${fixture.name}`

      await repository.createUser(user)
      await repository.createSession({
        id: `session-${fixture.name}`,
        userId: user.id,
        tokenHash: hashSessionSecret(sessionSecret),
        createdAt: timestamp,
        lastSeenAt: timestamp,
        expiresAt: fixture.expired
          ? timestamp
          : new Date(timestamp.getTime() + 24 * 60 * 60 * 1000),
        revokedAt: fixture.revoked ? timestamp : undefined,
        sessionVersion: user.sessionVersion,
      })
      sessionSecrets[fixture.name] = sessionSecret
    }
  } finally {
    repository.close()
  }

  return sessionSecrets
}

async function withApp(
  fixtures: readonly SessionFixture[],
  run: (
    app: FastifyInstance,
    sessions: Record<string, string>,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-route-protection-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  const commerceRepository = new SqliteCommerceRepository(databaseFile)

  try {
    await commerceRepository.saveProduct(createProduct())
  } finally {
    commerceRepository.close()
  }

  const sessions = await seedSessions(databaseFile, fixtures)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await app.ready()
    await run(app, sessions)
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

function request(
  app: FastifyInstance,
  sessionSecret: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    url: string
    payload?: unknown
    headers?: Record<string, string>
  },
): Promise<InjectResponse> {
  return app.inject({
    ...options,
    payload: options.payload as never,
    headers: {
      cookie: `madina-session=${sessionSecret}`,
      origin: 'http://localhost:80',
      ...options.headers,
    },
  }) as Promise<InjectResponse>
}

const standardRoles: readonly SessionFixture[] = [
  { name: 'viewer', role: 'viewer' },
  { name: 'operator', role: 'operator' },
  { name: 'manager', role: 'manager' },
  { name: 'admin', role: 'admin' },
]

test('protected reads require a session and allow viewer access', async () => {
  await withApp(standardRoles, async (app, sessions) => {
    const noSession = await app.inject({
      method: 'GET',
      url: '/api/v1/clients',
    })
    const clients = await request(app, sessions.viewer!, {
      method: 'GET',
      url: '/api/v1/clients',
    })
    const tasks = await request(app, sessions.viewer!, {
      method: 'GET',
      url: '/api/v1/tasks',
    })
    const products = await request(app, sessions.viewer!, {
      method: 'GET',
      url: '/api/v1/commerce/products',
    })
    const write = await request(app, sessions.viewer!, {
      method: 'POST',
      url: '/api/v1/clients',
      payload: { name: 'Недоступный клиент', status: 'active' },
    })

    equal(noSession.statusCode, 401)
    equal(clients.statusCode, 200)
    equal(tasks.statusCode, 200)
    equal(products.statusCode, 200)
    equal(write.statusCode, 403)
  })
})

test('operator can write clients, tasks, and sales but not purchases or products', async () => {
  await withApp(standardRoles, async (app, sessions) => {
    const client = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/clients',
      payload: { name: 'Клиент оператора', status: 'active' },
    })
    const task = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Задача оператора',
        status: 'todo',
        priority: 'medium',
      },
    })
    const sale = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/commerce/sales',
      payload: {
        saleNumber: 'SAL-RBAC-1',
        saleDate: now.toISOString(),
        clientName: 'Клиент оператора',
        paymentMethod: 'cash',
        items: [{
          productId: 'product-1',
          quantity: 2,
          unit: 'kg',
          unitPrice: 15,
          totalAmount: 30,
        }],
      },
    })
    const saleId = (sale.json() as { id: string }).id
    const completion = await request(app, sessions.operator!, {
      method: 'POST',
      url: `/api/v1/commerce/sales/${saleId}/complete`,
    })
    const product = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/commerce/products',
      payload: {
        name: 'Недоступный товар',
        category: 'dates',
        unit: 'kg',
        costPrice: 1,
        salePrice: 2,
        initialQuantity: 0,
        status: 'active',
      },
    })
    const purchase = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/commerce/purchases',
      payload: {
        purchaseNumber: 'PUR-RBAC-1',
        purchaseDate: now.toISOString(),
        supplierName: 'Поставщик',
        paymentMethod: 'cash',
        items: [],
      },
    })

    equal(client.statusCode, 201)
    equal(task.statusCode, 201)
    equal(sale.statusCode, 201)
    equal(completion.statusCode, 200)
    equal(product.statusCode, 403)
    equal(purchase.statusCode, 403)
  })
})

test('manager can mutate products and purchases', async () => {
  await withApp(standardRoles, async (app, sessions) => {
    const product = await request(app, sessions.manager!, {
      method: 'PATCH',
      url: '/api/v1/commerce/products/product-1',
      payload: { salePrice: 20 },
    })
    const purchase = await request(app, sessions.manager!, {
      method: 'POST',
      url: '/api/v1/commerce/purchases',
      payload: {
        purchaseNumber: 'PUR-RBAC-2',
        purchaseDate: now.toISOString(),
        supplierName: 'Поставщик менеджера',
        paymentMethod: 'cash',
        items: [{
          productId: 'product-1',
          quantity: 2,
          unit: 'kg',
          unitCost: 10,
          totalCost: 20,
        }],
      },
    })

    equal(product.statusCode, 200)
    equal(purchase.statusCode, 201)
  })
})

test('only admin can import data', async () => {
  await withApp(standardRoles, async (app, sessions) => {
    const payload = {
      clients: [{
        id: 'imported-client',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        name: 'Импортированный клиент',
        status: 'active',
      }],
    }
    const denied = await request(app, sessions.manager!, {
      method: 'POST',
      url: '/api/v1/clients/import',
      payload,
    })
    const accepted = await request(app, sessions.admin!, {
      method: 'POST',
      url: '/api/v1/clients/import',
      payload,
    })

    equal(denied.statusCode, 403)
    equal(accepted.statusCode, 200)
    deepEqual(accepted.json(), { created: 1, updated: 0 })
  })
})

test('unsafe authenticated requests reject invalid Origin and allow same origin', async () => {
  await withApp(standardRoles, async (app, sessions) => {
    const rejected = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/clients',
      headers: { origin: 'https://attacker.example' },
      payload: { name: 'Не должен создаться', status: 'active' },
    })
    const accepted = await request(app, sessions.operator!, {
      method: 'POST',
      url: '/api/v1/clients',
      payload: { name: 'Разрешённый origin', status: 'active' },
    })

    equal(rejected.statusCode, 403)
    equal(accepted.statusCode, 201)
  })
})

test('protected routes reject expired, revoked, and inactive sessions', async () => {
  await withApp([
    {
      name: 'expired',
      role: 'viewer',
      expired: true,
    },
    {
      name: 'revoked',
      role: 'viewer',
      revoked: true,
    },
    {
      name: 'inactive',
      role: 'viewer',
      status: 'inactive',
    },
  ], async (app, sessions) => {
    const expired = await request(app, sessions.expired!, {
      method: 'GET',
      url: '/api/v1/clients',
    })
    const revoked = await request(app, sessions.revoked!, {
      method: 'GET',
      url: '/api/v1/clients',
    })
    const inactive = await request(app, sessions.inactive!, {
      method: 'GET',
      url: '/api/v1/clients',
    })

    equal(expired.statusCode, 401)
    equal(revoked.statusCode, 401)
    equal(inactive.statusCode, 401)
  })
})
