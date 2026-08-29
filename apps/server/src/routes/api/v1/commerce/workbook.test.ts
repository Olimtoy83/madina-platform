import {
  deepEqual,
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
  SqliteAuditRepository,
  SqliteAuthRepository,
  SqliteCommerceRepository,
} from '@madina/database'
import ExcelJS from 'exceljs'
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
  const now = new Date()
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
    databaseFile: string,
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
    await run(app, cookies, databaseFile)
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

async function createImportWorkbook(
  rows: readonly (readonly [
    string,
    string,
    string,
    number,
    number,
    number,
    'active' | 'inactive',
  ])[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Products Import v1')
  worksheet.getCell('A1').value = 'madina-products-import-v1'
  worksheet.getRow(3).values = [
    'name', 'category', 'unit', 'initial_quantity',
    'cost_price', 'sale_price', 'status',
  ]
  for (const row of rows) worksheet.addRow([...row])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function multipartFilePayload(
  bytes: Buffer,
  options: { fieldName?: string; includeSecondFile?: boolean } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----madina-products-import-test'
  const fieldName = options.fieldName ?? 'file'
  const file = (name: string, content: Buffer) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="products.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
    content,
    Buffer.from('\r\n'),
  ])
  const payload = Buffer.concat([
    file(fieldName, bytes),
    ...(options.includeSecondFile ? [file('file', bytes)] : []),
    Buffer.from(`--${boundary}--\r\n`),
  ])
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
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

test('product workbook import is admin-only and validates multipart input', async () => {
  const workbook = await createImportWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
  ])
  const multipart = multipartFilePayload(workbook)

  await withApp(async () => {}, async (app, cookies) => {
    equal((await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/import',
      payload: multipart.payload, headers: { ...multipart.headers, origin: 'http://localhost:3000' },
    })).statusCode, 401)

    for (const role of ['viewer', 'operator', 'manager'] as const) {
      equal((await app.inject({
        method: 'POST', url: '/api/v1/commerce/products/import',
        payload: multipart.payload,
        headers: { ...multipart.headers, cookie: cookies[role], origin: 'http://localhost:3000' },
      })).statusCode, 403)
    }

    const noFile = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/import',
      headers: { cookie: cookies.admin, origin: 'http://localhost:3000' },
    })
    equal(noFile.statusCode, 422)
    equal((noFile.json() as { errors: Array<{ code: string }> }).errors[0]?.code, 'invalid_multipart')

    const multiple = multipartFilePayload(workbook, { includeSecondFile: true })
    const multipleFiles = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/import',
      payload: multiple.payload,
      headers: { ...multiple.headers, cookie: cookies.admin, origin: 'http://localhost:3000' },
    })
    equal(multipleFiles.statusCode, 422)
  })
})

test('product workbook import persists products and initial stock atomically with one aggregate audit event', async () => {
  const workbook = await createImportWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
    ['Carpet', 'carpets', 'piece', 3, 100, 150, 'active'],
  ])
  const multipart = multipartFilePayload(workbook)

  await withApp(async () => {}, async (app, cookies, databaseFile) => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/import', payload: multipart.payload,
      headers: {
        ...multipart.headers, cookie: cookies.admin, origin: 'http://localhost:3000',
        'x-request-id': 'client-controlled-request-id',
      },
    })
    equal(response.statusCode, 201)
    deepEqual(response.json(), { importedCount: 2, initialStockMovementCount: 1 })

    const products = await app.inject({
      method: 'GET', url: '/api/v1/commerce/products', headers: { cookie: cookies.admin },
    })
    equal((products.json() as { products: unknown[] }).products.length, 2)
    const movements = await app.inject({
      method: 'GET', url: '/api/v1/commerce/stock-movements', headers: { cookie: cookies.admin },
    })
    equal((movements.json() as { stockMovements: Array<{ type: string; quantity: number }> }).stockMovements.length, 1)

    const audits = new SqliteAuditRepository(databaseFile)
    try {
      const events = (await audits.findAll()).filter((event) =>
        event.action === 'products.bulk_imported',
      )
      equal(events.length, 1)
      const [event] = events
      equal(event?.domain, 'commerce')
      equal(event?.actorType, 'user')
      equal(event?.actorUserId, 'workbook-admin')
      match(event?.requestId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      equal(event?.requestId === 'client-controlled-request-id', false)
      equal(event?.metadata?.templateVersion, 'v1')
      equal(event?.metadata?.importedCount, 2)
      equal(event?.metadata?.initialStockMovementCount, 1)
      equal(JSON.stringify(event?.metadata).includes('Dates'), false)
      equal((await audits.findAll()).some((entry) => entry.action === 'product.created'), false)
    } finally {
      audits.close()
    }
  })
})

test('product workbook import rejects domain-invalid later rows without partial writes', async () => {
  const workbook = await createImportWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
    ['  ', 'dates', 'kg', -1, -10, -15, 'active'],
  ])
  const multipart = multipartFilePayload(workbook)

  await withApp(async () => {}, async (app, cookies) => {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/commerce/products/import', payload: multipart.payload,
      headers: { ...multipart.headers, cookie: cookies.admin, origin: 'http://localhost:3000' },
    })
    equal(response.statusCode, 422)
    const body = response.json() as { errors: Array<{ row: number; column: string }> }
    equal(body.errors.some((error) => error.row === 5 && error.column === 'name'), true)
    equal(body.errors.some((error) => error.row === 5 && error.column === 'cost_price'), true)
    const products = await app.inject({
      method: 'GET', url: '/api/v1/commerce/products', headers: { cookie: cookies.admin },
    })
    equal((products.json() as { products: unknown[] }).products.length, 0)
  })
})

test('repeated product workbook uploads are independent imports and existing names are allowed', async () => {
  const workbook = await createImportWorkbook([
    ['Dates', 'dates', 'kg', 0, 10, 15, 'active'],
  ])
  const multipart = multipartFilePayload(workbook)

  await withApp(async (repository) => {
    await repository.saveProduct(createProduct({ id: 'existing-dates', quantity: 0 }))
  }, async (app, cookies, databaseFile) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/commerce/products/import', payload: multipart.payload,
        headers: { ...multipart.headers, cookie: cookies.admin, origin: 'http://localhost:3000' },
      })
      equal(response.statusCode, 201)
    }

    const products = await app.inject({
      method: 'GET', url: '/api/v1/commerce/products', headers: { cookie: cookies.admin },
    })
    equal((products.json() as { products: unknown[] }).products.length, 3)
    const audits = new SqliteAuditRepository(databaseFile)
    try {
      equal((await audits.findAll()).filter((event) =>
        event.action === 'products.bulk_imported',
      ).length, 2)
    } finally {
      audits.close()
    }
  })
})
