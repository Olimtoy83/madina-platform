import {
  equal,
  match,
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
  type AuthSession,
  type User,
} from '@madina/auth'
import type { Product } from '@madina/core'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteCommerceRepository,
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

function createProduct(overrides: Partial<Product> = {}): Product {
  const now = new Date('2026-08-28T12:00:00.000Z')

  return {
    id: 'product-1',
    name: 'Dates',
    category: 'dates',
    quantity: 4,
    unit: 'kg',
    costPrice: 10,
    salePrice: 15,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seedSession(
  databaseFile: string,
  id: string,
  role: TestRole,
): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const now = new Date('2026-08-28T12:00:00.000Z')
  const secret = `product-workbook-session-${id}`

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
  seed: (repository: SqliteCommerceRepository) => Promise<void>,
  run: (
    app: FastifyInstance,
    cookies: Record<TestRole, string>,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-product-workbook-'))
  const databaseFile = join(directory, 'commerce.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const commerceRepository = new SqliteCommerceRepository(databaseFile)

  try {
    await seed(commerceRepository)
  } finally {
    commerceRepository.close()
  }

  const cookies = {
    admin: await seedSession(databaseFile, 'workbook-admin', 'admin'),
    manager: await seedSession(databaseFile, 'workbook-manager', 'manager'),
    operator: await seedSession(databaseFile, 'workbook-operator', 'operator'),
    viewer: await seedSession(databaseFile, 'workbook-viewer', 'viewer'),
  }
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

test('product workbook downloads require a session and allow every commerce:read role', async () => {
  await withApp(async () => {}, async (app, cookies) => {
    for (const url of [
      '/api/v1/commerce/products/import-template',
      '/api/v1/commerce/products/export',
    ]) {
      equal((await app.inject({ method: 'GET', url })).statusCode, 401)

      for (const role of ['viewer', 'operator', 'manager', 'admin'] as const) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: cookies[role] },
        })

        equal(response.statusCode, 200)
        match(
          String(response.headers['content-type']),
          /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
        )
      }
    }
  })
})

test('product template and export use stable attachment filenames and export authoritative products', async () => {
  await withApp(async (repository) => {
    await repository.saveProduct(createProduct())
    await repository.saveProduct(createProduct({
      id: 'product-2',
      name: 'Inactive Dates',
      quantity: 0,
      status: 'inactive',
    }))
  }, async (app, cookies) => {
    const template = await app.inject({
      method: 'GET',
      url: '/api/v1/commerce/products/import-template',
      headers: { cookie: cookies.viewer },
    })
    match(
      String(template.headers['content-disposition']),
      /madina-products-import-template-v1\.xlsx/,
    )

    const exported = await app.inject({
      method: 'GET',
      url: '/api/v1/commerce/products/export',
      headers: { cookie: cookies.viewer },
    })
    match(
      String(exported.headers['content-disposition']),
      /^attachment; filename="madina-products-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    )
    equal(exported.body.length > 0, true)
  })
})
