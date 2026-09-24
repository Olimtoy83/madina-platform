import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hashSessionSecret } from '../packages/auth/dist/index.js'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteRetailAccessRepository,
  SqliteRetailCatalogRepository,
  SqliteRetailInventoryRepository,
  SqliteRetailOfflineAuthorityRepository,
} from '../packages/database/dist/index.js'
import { buildApp } from '../apps/server/dist/app.js'
import { createServer } from '../apps/crm/node_modules/vite/dist/node/index.js'

const crmRoot = resolve(process.cwd(), 'apps/crm')
const userId = 'offline-e2e-manager'
const sessionSecret = 'offline-e2e-manager-session'

export interface OfflineAcceptanceHarness {
  readonly url: string
  readonly database: DatabaseSync
  readonly sessionSecret: string
  readonly userId: string
  readonly locationId: string
  readonly productId: string
  readonly inventory: SqliteRetailInventoryRepository
  readonly offline: SqliteRetailOfflineAuthorityRepository
  readonly context: { actorType: 'user'; actorUserId: string; requestId: string }
}

export async function withOfflineAcceptanceHarness<T>(run: (harness: OfflineAcceptanceHarness) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-offline-e2e-'))
  const file = join(directory, 'acceptance.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  const previousNodeEnv = process.env.NODE_ENV
  process.env.DATABASE_FILE = file
  process.env.NODE_ENV = 'test'
  let database: DatabaseSync | undefined
  let access: SqliteRetailAccessRepository | undefined
  let catalog: SqliteRetailCatalogRepository | undefined
  let inventory: SqliteRetailInventoryRepository | undefined
  let offline: SqliteRetailOfflineAuthorityRepository | undefined
  let app: ReturnType<typeof buildApp> | undefined
  let vite: Awaited<ReturnType<typeof createServer>> | undefined

  try {
    initializeDatabase(file)
    const auth = new SqliteAuthRepository(file)
    try {
      const now = new Date()
      await auth.createUser({ id: userId, username: userId, normalizedUsername: userId, role: 'manager', status: 'active', sessionVersion: 1, createdAt: now, updatedAt: now })
      await auth.createSession({ id: 'offline-e2e-session', userId, tokenHash: hashSessionSecret(sessionSecret), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000), sessionVersion: 1 })
    } finally {
      auth.close()
    }

    access = new SqliteRetailAccessRepository(file)
    catalog = new SqliteRetailCatalogRepository(file)
    inventory = new SqliteRetailInventoryRepository(file)
    offline = new SqliteRetailOfflineAuthorityRepository(file)
    database = new DatabaseSync(file)
    const context = { actorType: 'user' as const, actorUserId: userId, requestId: 'offline-e2e-fixture' }
    const location = await access.createLocation({ code: 'OFFLINE-E2E', name: 'Offline acceptance', type: 'store', status: 'active' }, context)
    await access.configureCurrency(location.id, 'USD', 2, context)
    await access.grant(userId, location.id, context)
    const product = await catalog.createProduct({ sourceId: 'OFFLINE-E2E-PRODUCT', name: 'Offline acceptance product' }, context)
    await catalog.setPrice(product.id, location.id, 100, context)
    await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 10, type: 'opening', sourceType: 'test', sourceId: 'offline-e2e-seed', sourceLineId: 'seed' }, context)

    app = buildApp()
    const apiUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    vite = await createServer({
      root: crmRoot,
      configFile: join(crmRoot, 'vite.config.ts'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: apiUrl, changeOrigin: true } } },
    })
    await vite.listen()
    const address = vite.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Offline acceptance Vite server has no TCP address.')

    return await run({ url: `http://127.0.0.1:${address.port}`, database, sessionSecret, userId, locationId: location.id, productId: product.id, inventory, offline, context })
  } finally {
    await vite?.close()
    await app?.close()
    database?.close()
    offline?.close()
    inventory?.close()
    catalog?.close()
    access?.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('madina-offline-e2e-')) throw new Error('Unsafe offline acceptance cleanup target.')
    rmSync(target, { recursive: true, force: true })
  }
}

function count(database: DatabaseSync, statement: string, value: string): number {
  return (database.prepare(statement).get(value) as { count: number }).count
}

function total(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

export function databaseWideEffects(harness: OfflineAcceptanceHarness) {
  const db = harness.database
  return {
    sales: total(db, 'retail_sales'),
    lines: total(db, 'retail_sale_items'),
    allocations: total(db, 'retail_payment_allocations'),
    movements: total(db, 'retail_inventory_movements'),
    evidence: total(db, 'retail_offline_sale_evidence'),
    receipts: total(db, 'retail_offline_sale_sync_receipts'),
    audits: count(db, 'SELECT COUNT(*) AS count FROM audit_events WHERE action=?', 'retail.offline_sale_synced'),
  }
}

export function databaseWideConflictEffects(harness: OfflineAcceptanceHarness) {
  const db = harness.database
  return {
    verifications: total(db, 'retail_offline_stock_conflict_verifications'),
    verificationLines: total(db, 'retail_offline_stock_conflict_verification_lines'),
    incidents: total(db, 'retail_offline_stock_conflict_incidents'),
  }
}

export function acceptedEffects(harness: OfflineAcceptanceHarness, operationId: string, saleId: string) {
  const db = harness.database
  return {
    sales: count(db, 'SELECT COUNT(*) AS count FROM retail_sales WHERE id=?', saleId),
    lines: count(db, 'SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id=?', saleId),
    allocations: count(db, 'SELECT COUNT(*) AS count FROM retail_payment_allocations WHERE sale_id=?', saleId),
    movements: count(db, "SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_offline_sale_sync' AND source_id=?", operationId),
    evidence: count(db, 'SELECT COUNT(*) AS count FROM retail_offline_sale_evidence WHERE offline_operation_id=?', operationId),
    receipts: count(db, 'SELECT COUNT(*) AS count FROM retail_offline_sale_sync_receipts WHERE offline_operation_id=?', operationId),
    audits: count(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action='retail.offline_sale_synced' AND entity_id=?", saleId),
  }
}

export function conflictEffects(harness: OfflineAcceptanceHarness, operationId: string, saleId: string) {
  return {
    accepted: acceptedEffects(harness, operationId, saleId),
    verifications: count(harness.database, 'SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE offline_operation_id=?', operationId),
  }
}
