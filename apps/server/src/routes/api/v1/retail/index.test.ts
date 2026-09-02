import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'
import test from 'node:test'
import {
  hashSessionSecret,
  type User,
  type UserRole,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuditRepository,
  SqliteAuthRepository,
  SqliteRetailAccessRepository,
  SqliteRetailCatalogRepository,
  SqliteRetailInventoryRepository,
  SqliteRetailReconciliationRepository,
} from '@madina/database'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'
import { retailRoutes } from './index.js'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

test('retail boundary composes without routes or CRM dependencies', async () => {
  const repositoryRoot = resolve(process.cwd(), '..', '..')
  const retail = readManifest(resolve(repositoryRoot, 'packages/retail/package.json'))
  const crm = readManifest(resolve(repositoryRoot, 'apps/crm/package.json'))

  deepEqual(retail.dependencies ?? {}, {})
  equal(retail.devDependencies?.['@madina/core'], undefined)
  equal(crm.dependencies?.['@madina/retail'], undefined)

  const app = Fastify()
  app.register(retailRoutes, { prefix: '/retail' })
  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: '/retail' })).statusCode, 404)
  } finally {
    await app.close()
  }
})

interface UserFixture {
  id: string
  role: UserRole
}

async function seedSessions(
  filename: string,
  fixtures: readonly UserFixture[],
): Promise<Record<string, string>> {
  const repository = new SqliteAuthRepository(filename)
  const now = new Date()
  const sessions: Record<string, string> = {}

  try {
    for (const fixture of fixtures) {
      const user: User = {
        id: fixture.id,
        username: fixture.id,
        normalizedUsername: fixture.id,
        role: fixture.role,
        status: 'active',
        sessionVersion: 1,
        createdAt: now,
        updatedAt: now,
      }
      const secret = `retail-${fixture.id}-session`
      await repository.createUser(user)
      await repository.createSession({
        id: `session-${fixture.id}`,
        userId: user.id,
        tokenHash: hashSessionSecret(secret),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        sessionVersion: 1,
      })
      sessions[fixture.id] = secret
    }
  } finally {
    repository.close()
  }

  return sessions
}

function request(
  app: FastifyInstance,
  session: string,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    url: string
    payload?: unknown
  },
) {
  return app.inject({
    ...options,
    payload: options.payload as never,
    headers: {
      cookie: `madina-session=${session}`,
      origin: 'http://localhost:80',
    },
  })
}

test('Retail Location routes enforce capability and scoped active grants with accurate audit evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'admin-1', role: 'admin' },
    { id: 'manager-1', role: 'manager' },
    { id: 'operator-1', role: 'operator' },
  ])
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const audit = new SqliteAuditRepository(databaseFile)

  try {
    await app.ready()
    const noSession = await app.inject({
      method: 'GET', url: '/api/v1/retail/locations/missing',
    })
    equal(noSession.statusCode, 401)

    const locationAResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'STORE-A', name: 'Store A', type: 'store',
        status: 'active', role: 'admin', capability: 'retail:access:manage',
      },
    })
    equal(locationAResponse.statusCode, 201)
    const locationA = (locationAResponse.json() as { location: { id: string } }).location
    const locationBResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: { code: 'STORE-B', name: 'Store B', type: 'store' },
    })
    equal(locationBResponse.statusCode, 201)
    const locationB = (locationBResponse.json() as { location: { id: string } }).location

    const noCapability = await request(app, sessions['operator-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(noCapability.statusCode, 403)
    const noGrant = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(noGrant.statusCode, 403)

    const grant = await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationA.id}/grants`,
      payload: { userId: 'manager-1' },
    })
    equal(grant.statusCode, 200)
    const allowed = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(allowed.statusCode, 200)
    const crossLocation = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationB.id}`,
    })
    equal(crossLocation.statusCode, 403)

    const revoke = await request(app, sessions['admin-1']!, {
      method: 'DELETE',
      url: `/api/v1/retail/locations/${locationA.id}/grants/manager-1`,
    })
    equal(revoke.statusCode, 200)
    const revoked = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(revoked.statusCode, 403)

    const inactiveResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'STORE-INACTIVE', name: 'Inactive store', type: 'store', status: 'inactive',
      },
    })
    equal(inactiveResponse.statusCode, 201)
    const inactive = (inactiveResponse.json() as { location: { id: string } }).location
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${inactive.id}/grants`,
      payload: { userId: 'manager-1' },
    })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${inactive.id}`,
    })).statusCode, 403)

    const auditBeforeDeniedOrFailed = (await audit.findAll()).length
    const selfGrant = await request(app, sessions['manager-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationB.id}/grants`,
      payload: { userId: 'manager-1', role: 'admin', capability: 'retail:access:manage' },
    })
    equal(selfGrant.statusCode, 403)
    const privilegePayload = await request(app, sessions['operator-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'ATTACK', name: 'Attack', type: 'store', role: 'admin',
        capability: 'retail:locations:manage',
      },
    })
    equal(privilegePayload.statusCode, 403)
    const failedGrant = await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationB.id}/grants`,
      payload: { userId: 'missing-user' },
    })
    equal(failedGrant.statusCode, 500)
    equal((await audit.findAll()).length, auditBeforeDeniedOrFailed)

    const events = await audit.findAll()
    equal(events.filter((event) => event.action === 'retail.location_created').length, 3)
    equal(events.filter((event) => event.action === 'retail.location_granted').length, 2)
    equal(events.filter((event) => event.action === 'retail.location_revoked').length, 1)
    equal(events.every((event) => event.actorUserId === 'admin-1'), true)
  } finally {
    audit.close()
    await app.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Retail Product routes enforce catalog capabilities and preserve deterministic barcode/import behavior', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-product-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'admin-1', role: 'admin' },
    { id: 'manager-1', role: 'manager' },
    { id: 'operator-1', role: 'operator' },
  ])
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const audit = new SqliteAuditRepository(databaseFile)
  try {
    await app.ready()
    equal((await app.inject({ method: 'POST', url: '/api/v1/retail/products' })).statusCode, 401)
    equal((await request(app, sessions['operator-1']!, { method: 'GET', url: '/api/v1/retail/products' })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: '/api/v1/retail/products' })).statusCode, 200)
    const created = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/products',
      payload: { sourceId: 'WL-992025 / A', name: 'Wilmax plate', role: 'admin' },
    })
    equal(created.statusCode, 201)
    const product = (created.json() as { product: { id: string; baseUnit: string } }).product
    equal(product.baseUnit, 'piece')
    equal((await request(app, sessions['operator-1']!, {
      method: 'POST', url: '/api/v1/retail/products', payload: { sourceId: 'ATTACK', name: 'Attack', role: 'admin' },
    })).statusCode, 403)
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/products/${product.id}/barcodes`, payload: { value: '005052609920253' },
    })).statusCode, 201)
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/products/${product.id}/barcodes`, payload: { value: '5052609920253' },
    })).statusCode, 201)
    const lookup = await request(app, sessions['manager-1']!, { method: 'GET', url: '/api/v1/retail/products/by-barcode/005052609920253' })
    equal(lookup.statusCode, 200)
    equal((lookup.json() as { product: { id: string } }).product.id, product.id)
    const other = await request(app, sessions['admin-1']!, { method: 'POST', url: '/api/v1/retail/products', payload: { sourceId: 'OTHER', name: 'Other' } })
    const otherProduct = (other.json() as { product: { id: string } }).product
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/products/${otherProduct.id}/barcodes`, payload: { value: '5052609920253' },
    })).statusCode, 409)
    const dryRun = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/products/imports',
      payload: { dryRun: true, rows: [{ sourceRef: 'r-1', sourceId: 'IMP-1', name: 'Imported', barcode: '000123' }] },
    })
    equal(dryRun.statusCode, 200)
    equal((dryRun.json() as { result: { summary: { created: number } } }).result.summary.created, 1)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: '/api/v1/retail/products/by-barcode/000123' })).statusCode, 404)
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/products/imports',
      payload: { dryRun: false, rows: [{ sourceRef: 'r-1', sourceId: 'IMP-1', name: 'Imported', barcode: '000123' }] },
    })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: '/api/v1/retail/products/by-barcode/000123' })).statusCode, 200)
    const actions = (await audit.findAll()).map((event) => event.action)
    equal(actions.includes('retail.product_created'), true)
    equal(actions.includes('retail.product_barcode_added'), true)
    equal(actions.includes('retail.products_imported'), true)
  } finally {
    audit.close()
    await app.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Retail inventory reads require an active location grant and inventory capability', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-inventory-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'admin-1', role: 'admin' },
    { id: 'manager-1', role: 'manager' },
    { id: 'operator-1', role: 'operator' },
  ])
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)
  const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'inventory-route-test' }
  const location = await access.createLocation({ code: 'STORE-A', name: 'Store A', type: 'store', status: 'active' }, context)
  const otherLocation = await access.createLocation({ code: 'STORE-B', name: 'Store B', type: 'store', status: 'active' }, context)
  const product = await catalog.createProduct({ sourceId: 'P-1', name: 'Product' }, context)
  await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 6, type: 'opening', sourceType: 'test', sourceId: 'opening-1', sourceLineId: 'line-1' }, context)
  await access.grant('manager-1', location.id, context)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: `/api/v1/retail/locations/${location.id}/inventory/balances` })).statusCode, 401)
    equal((await request(app, sessions['operator-1']!, { method: 'GET', url: `/api/v1/retail/locations/${location.id}/inventory/balances` })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: `/api/v1/retail/locations/${otherLocation.id}/inventory/balances` })).statusCode, 403)
    const balances = await request(app, sessions['manager-1']!, { method: 'GET', url: `/api/v1/retail/locations/${location.id}/inventory/balances` })
    equal(balances.statusCode, 200)
    equal((balances.json() as { balances: Array<{ productId: string; onHandQuantity: number }> }).balances[0]?.productId, product.id)
    equal((balances.json() as { balances: Array<{ onHandQuantity: number }> }).balances[0]?.onHandQuantity, 6)
    const history = await request(app, sessions['manager-1']!, { method: 'GET', url: `/api/v1/retail/locations/${location.id}/inventory/products/${product.id}/movements` })
    equal(history.statusCode, 200)
    equal((history.json() as { movements: unknown[] }).movements.length, 1)
  } finally {
    await app.close()
    inventory.close()
    catalog.close()
    access.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Retail reconciliation routes enforce capabilities, active grants, location scope, and completed-history reads', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-reconciliation-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'admin-1', role: 'admin' }, { id: 'manager-1', role: 'manager' }, { id: 'operator-1', role: 'operator' },
  ])
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)
  const reconciliation = new SqliteRetailReconciliationRepository(databaseFile)
  const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'reconciliation-route-test' }
  const locationA = await access.createLocation({ code: 'STORE-A', name: 'Store A', type: 'store', status: 'active' }, context)
  const locationB = await access.createLocation({ code: 'STORE-B', name: 'Store B', type: 'store', status: 'active' }, context)
  const inactive = await access.createLocation({ code: 'STORE-I', name: 'Store I', type: 'store', status: 'inactive' }, context)
  const product = await catalog.createProduct({ sourceId: 'P-1', name: 'Product' }, context)
  await inventory.recordMovement({ productId: product.id, locationId: locationA.id, quantityDelta: 4, type: 'opening', sourceType: 'test', sourceId: 'seed', sourceLineId: '1' }, context)
  await access.grant('manager-1', locationA.id, context)
  await access.grant('manager-1', inactive.id, context)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  try {
    await app.ready()
    const createA = `/api/v1/retail/locations/${locationA.id}/reconciliations`
    equal((await app.inject({ method: 'POST', url: createA })).statusCode, 401)
    equal((await request(app, sessions['operator-1']!, { method: 'GET', url: createA })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: `/api/v1/retail/locations/${locationB.id}/reconciliations` })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `/api/v1/retail/locations/${inactive.id}/reconciliations`, payload: { purpose: 'daily', role: 'admin' } })).statusCode, 403)
    const created = await request(app, sessions['manager-1']!, { method: 'POST', url: createA, payload: { purpose: 'daily', locationId: locationB.id, role: 'admin' } })
    equal(created.statusCode, 201)
    const sessionId = (created.json() as { reconciliation: { id: string; locationId: string } }).reconciliation.id
    equal((created.json() as { reconciliation: { locationId: string } }).reconciliation.locationId, locationA.id)
    const base = `/api/v1/retail/locations/${locationA.id}/reconciliations/${sessionId}`
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/counts`, payload: { productId: product.id, actualQuantity: 3, locationId: locationB.id, capability: 'retail:reconciliation:manage' } })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `/api/v1/retail/locations/${locationB.id}/reconciliations/${sessionId}/complete`, payload: {} })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/complete`, payload: {} })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: base })).statusCode, 200)
    await access.revoke('manager-1', locationA.id, context)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: base })).statusCode, 403)
  } finally {
    await app.close(); reconciliation.close(); inventory.close(); catalog.close(); access.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})
