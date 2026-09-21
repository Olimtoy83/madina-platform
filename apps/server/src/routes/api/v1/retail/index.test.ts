import {
  deepEqual,
  equal,
  rejects,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  hashSessionSecret,
  type User,
  type UserRole,
} from '@madina/auth'
import { hasRetailCapability, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, RETAIL_OFFLINE_SIGNATURE_PREFIX, canonicalizeRetailOfflineEnvelope, type RetailOfflineEnvelope } from '@madina/retail'
import {
  initializeDatabase,
  SqliteAuditRepository,
  SqliteAuthRepository,
  SqliteRetailAccessRepository,
  SqliteRetailCatalogRepository,
  SqliteRetailInventoryRepository,
  SqliteRetailReconciliationRepository,
  SqliteRetailSaleRepository,
  SqliteRetailOfflineAuthorityRepository,
  SqliteRetailOfflineStockConflictMaterializationRepository,
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

  deepEqual(retail.dependencies ?? {}, {})
  equal(retail.devDependencies?.['@madina/core'], undefined)

  const app = Fastify()
  app.register(retailRoutes, { prefix: '/retail' })
  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: '/retail' })).statusCode, 404)
  } finally {
    await app.close()
  }
})

interface OfflineSyncFixture {
  readonly file: string
  readonly database: DatabaseSync
  readonly app: FastifyInstance
  readonly session: string
  readonly sessions: Record<string, string>
  readonly access: SqliteRetailAccessRepository
  readonly catalog: SqliteRetailCatalogRepository
  readonly inventory: SqliteRetailInventoryRepository
  readonly offline: SqliteRetailOfflineAuthorityRepository
  readonly context: { actorType: 'user'; actorUserId: string; requestId: string }
  readonly location: { id: string }
  readonly otherLocation: { id: string }
  readonly product: { id: string }
  readonly extraProduct: { id: string }
  readonly terminal: { id: string }
  readonly authority: { id: string }
  readonly permits: readonly { id: string; sequence: number }[]
  readonly pair: { publicKey: KeyObject; privateKey: KeyObject }
  readonly url: string
}

interface OfflineEffects { sales: number; items: number; allocations: number; movements: number; evidence: number; receipts: number; balance: number | undefined }

function offlineEnvelope(fixture: OfflineSyncFixture, permit: { id: string; sequence: number }, overrides: Partial<RetailOfflineEnvelope> = {}): RetailOfflineEnvelope {
  return {
    schemaVersion: 1, offlineOperationId: `http-op-${permit.sequence}`, authorityId: fixture.authority.id, authorityVersion: 1,
    permitId: permit.id, permitSequence: permit.sequence, terminalId: fixture.terminal.id, terminalKeyVersion: 1,
    userId: 'operator-1', locationId: fixture.location.id, proposedSaleId: `http-sale-${permit.sequence}`,
    lines: [{ id: `http-line-${permit.sequence}`, productId: fixture.product.id, quantity: 1, unitPriceMinor: 100 }],
    currencyCode: 'USD', currencyExponent: 2,
    cashAllocation: { id: `http-payment-${permit.sequence}`, method: 'cash', amountMinor: 100, ordinal: 0 },
    subtotalMinor: 100, payableTotalMinor: 100, claimedOfflineCompletedAt: '2026-09-20T00:00:00.000Z', ...overrides,
  }
}

function signedOfflinePayload(envelope: RetailOfflineEnvelope, privateKey: KeyObject): { envelope: RetailOfflineEnvelope; payloadHash: string; signature: string } {
  const canonical = canonicalizeRetailOfflineEnvelope(envelope)
  return { envelope, payloadHash: createHash('sha256').update(canonical).digest('hex'), signature: `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${sign(null, Buffer.from(canonical), privateKey).toString('base64')}` }
}

function offlineEffects(fixture: OfflineSyncFixture): OfflineEffects {
  const count = (table: string, where = ''): number => (fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as { count: number }).count
  return {
    sales: count('retail_sales'), items: count('retail_sale_items'), allocations: count('retail_payment_allocations'),
    movements: count('retail_inventory_movements', " WHERE source_type='retail_offline_sale_sync'"), evidence: count('retail_offline_sale_evidence'), receipts: count('retail_offline_sale_sync_receipts'),
    balance: (fixture.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(fixture.product.id, fixture.location.id) as { on_hand_quantity: number } | undefined)?.on_hand_quantity,
  }
}

function assertNoOfflineEffects(fixture: OfflineSyncFixture, before: OfflineEffects): void { deepEqual(offlineEffects(fixture), before) }
function permitEvidenceCount(fixture: OfflineSyncFixture, permitId: string): number { return (fixture.database.prepare('SELECT COUNT(*) AS count FROM retail_offline_sale_evidence WHERE permit_id=?').get(permitId) as { count: number }).count }
function conflictVerificationCount(fixture: OfflineSyncFixture, permitId: string): number { return (fixture.database.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications WHERE permit_id=?').get(permitId) as { count: number }).count }
function conflictVerificationTotal(fixture: OfflineSyncFixture): number { return (fixture.database.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_verifications').get() as { count: number }).count }
function materializationEffects(fixture: OfflineSyncFixture): { sales: number; items: number; allocations: number; evidence: number; movements: number; incidents: number; receipts: number; balance: number | undefined } {
  const count = (table: string, where = ''): number => (fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as { count: number }).count
  return { sales: count('retail_sales'), items: count('retail_sale_items'), allocations: count('retail_payment_allocations'), evidence: count('retail_offline_sale_evidence'), movements: count('retail_inventory_movements', " WHERE source_type='retail_offline_stock_conflict_materialization'"), incidents: count('retail_offline_stock_conflict_incidents'), receipts: count('retail_offline_stock_conflict_materialization_receipts'), balance: (fixture.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(fixture.product.id, fixture.location.id) as { on_hand_quantity: number } | undefined)?.on_hand_quantity }
}

async function withOfflineSyncFixture(run: (fixture: OfflineSyncFixture) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'retail-offline-sync-api-')), file = join(directory, 'x.sqlite'), previous = process.env.DATABASE_FILE
  initializeDatabase(file)
  const sessions = await seedSessions(file, [{ id: 'admin-1', role: 'admin' }, { id: 'manager-1', role: 'manager' }, { id: 'operator-1', role: 'operator' }])
  const access = new SqliteRetailAccessRepository(file), catalog = new SqliteRetailCatalogRepository(file), inventory = new SqliteRetailInventoryRepository(file), offline = new SqliteRetailOfflineAuthorityRepository(file), database = new DatabaseSync(file)
  const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'offline-api' }
  const location = await access.createLocation({ code: 'OFFLINE', name: 'Offline', type: 'store', status: 'active' }, context)
  const otherLocation = await access.createLocation({ code: 'OFFLINE-OTHER', name: 'Offline other', type: 'store', status: 'active' }, context)
  await access.configureCurrency(location.id, 'USD', 2, context); await access.configureCurrency(otherLocation.id, 'USD', 2, context)
  const product = await catalog.createProduct({ sourceId: 'O', name: 'Offline' }, context), extraProduct = await catalog.createProduct({ sourceId: 'X', name: 'Extra' }, context)
  await catalog.setPrice(product.id, location.id, 100, context); await catalog.setPrice(extraProduct.id, location.id, 200, context)
  await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 5, type: 'opening', sourceType: 'test', sourceId: 'offline', sourceLineId: 'seed' }, context)
  await inventory.recordMovement({ productId: extraProduct.id, locationId: location.id, quantityDelta: 5, type: 'opening', sourceType: 'test', sourceId: 'offline-extra', sourceLineId: 'seed' }, context)
  await access.grant('manager-1', location.id, context); await access.grant('manager-1', otherLocation.id, context)
  const pair = generateKeyPairSync('ed25519'), terminal = await offline.enrollTerminal({ locationId: location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }, context)
  const authority = await offline.issueAuthority({ terminalId: terminal.id, userId: 'operator-1', locationId: location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 20, productIds: [product.id] }, context)
  const permits = await offline.listPermits(authority.id)
  process.env.DATABASE_FILE = file
  const app = buildApp()
  try {
    await app.ready()
    await run({ file, database, app, session: sessions['manager-1']!, sessions, access, catalog, inventory, offline, context, location, otherLocation, product, extraProduct, terminal, authority, permits, pair, url: `/api/v1/retail/locations/${location.id}/offline-sales/sync` })
  } finally {
    await app.close(); database.close(); offline.close(); inventory.close(); catalog.close(); access.close()
    if (previous === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previous
    rmSync(directory, { recursive: true, force: true })
  }
}

function postOffline(fixture: OfflineSyncFixture, payload: unknown, url = fixture.url) { return request(fixture.app, fixture.session, { method: 'POST', url, payload }) }

test('Offline Sync HTTP failure matrix batch 1: Location and crypto failures have zero effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const before = offlineEffects(fixture), valid = offlineEnvelope(fixture, fixture.permits[0]!)
    equal((await fixture.app.inject({ method: 'POST', url: fixture.url, payload: signedOfflinePayload(valid, fixture.pair.privateKey) })).statusCode, 401)
    equal((await postOffline(fixture, signedOfflinePayload(valid, fixture.pair.privateKey), fixture.url.replace(fixture.location.id, fixture.otherLocation.id))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const invalid = signedOfflinePayload(valid, fixture.pair.privateKey); invalid.signature = `${RETAIL_OFFLINE_SIGNATURE_PREFIX}${Buffer.alloc(64).toString('base64')}`
    equal((await postOffline(fixture, invalid)).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const otherPair = generateKeyPairSync('ed25519')
    equal((await postOffline(fixture, signedOfflinePayload(valid, otherPair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const boundTerminal = await fixture.offline.enrollTerminal({ locationId: fixture.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: otherPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }, fixture.context)
    const wrongTerminal = offlineEnvelope(fixture, fixture.permits[1]!, { terminalId: boundTerminal.id })
    equal((await postOffline(fixture, signedOfflinePayload(wrongTerminal, otherPair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const rotatedPair = generateKeyPairSync('ed25519')
    await fixture.offline.rotateTerminalKey(fixture.terminal.id, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, rotatedPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), fixture.context)
    const wrongVersion = offlineEnvelope(fixture, fixture.permits[2]!, { terminalKeyVersion: 2 })
    equal((await postOffline(fixture, signedOfflinePayload(wrongVersion, rotatedPair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
  })
})

test('Offline Sync HTTP failure matrix batch 2: authority and permit failures have zero effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const before = offlineEffects(fixture)
    const expired = await fixture.offline.issueAuthority({ terminalId: fixture.terminal.id, userId: 'operator-1', locationId: fixture.location.id, expiresAt: new Date(Date.now() + 25), permitCount: 1, productIds: [fixture.product.id] }, fixture.context)
    const expiredPermit = (await fixture.offline.listPermits(expired.id))[0]!
    await new Promise(resolve => setTimeout(resolve, 50))
    const expiredEnvelope = offlineEnvelope(fixture, expiredPermit, { authorityId: expired.id })
    equal((await postOffline(fixture, signedOfflinePayload(expiredEnvelope, fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const revokedPair = generateKeyPairSync('ed25519'), revokedTerminal = await fixture.offline.enrollTerminal({ locationId: fixture.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: revokedPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }, fixture.context)
    const revokedTerminalAuthority = await fixture.offline.issueAuthority({ terminalId: revokedTerminal.id, userId: 'operator-1', locationId: fixture.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 1, productIds: [fixture.product.id] }, fixture.context)
    const revokedTerminalPermit = (await fixture.offline.listPermits(revokedTerminalAuthority.id))[0]!; await fixture.offline.revokeTerminal(revokedTerminal.id, 'test', fixture.context)
    const revokedTerminalEnvelope = offlineEnvelope(fixture, revokedTerminalPermit, { authorityId: revokedTerminalAuthority.id, terminalId: revokedTerminal.id })
    equal((await postOffline(fixture, signedOfflinePayload(revokedTerminalEnvelope, revokedPair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const revokedAuthority = await fixture.offline.issueAuthority({ terminalId: fixture.terminal.id, userId: 'operator-1', locationId: fixture.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 1, productIds: [fixture.product.id] }, fixture.context)
    const revokedAuthorityPermit = (await fixture.offline.listPermits(revokedAuthority.id))[0]!; await fixture.offline.revokeAuthority(revokedAuthority.id, 'test', fixture.context)
    equal((await postOffline(fixture, signedOfflinePayload(offlineEnvelope(fixture, revokedAuthorityPermit, { authorityId: revokedAuthority.id }), fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    equal((await postOffline(fixture, signedOfflinePayload(offlineEnvelope(fixture, { id: 'unknown-permit', sequence: 99 }), fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const otherAuthority = await fixture.offline.issueAuthority({ terminalId: fixture.terminal.id, userId: 'operator-1', locationId: fixture.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 1, productIds: [fixture.product.id] }, fixture.context)
    const otherPermit = (await fixture.offline.listPermits(otherAuthority.id))[0]!
    equal((await postOffline(fixture, signedOfflinePayload(offlineEnvelope(fixture, otherPermit), fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    equal(conflictVerificationTotal(fixture), 0)
    const reusableAuthority = await fixture.offline.issueAuthority({ terminalId: fixture.terminal.id, userId: 'operator-1', locationId: fixture.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 1, productIds: [fixture.product.id] }, fixture.context)
    const reusablePermit = (await fixture.offline.listPermits(reusableAuthority.id))[0]!, first = offlineEnvelope(fixture, reusablePermit, { authorityId: reusableAuthority.id })
    equal((await postOffline(fixture, signedOfflinePayload(first, fixture.pair.privateKey))).statusCode, 201)
    const afterFirst = offlineEffects(fixture), changedOperation = offlineEnvelope(fixture, reusablePermit, { authorityId: reusableAuthority.id, offlineOperationId: 'different-operation', proposedSaleId: 'different-sale', lines: [{ id: 'different-line', productId: fixture.product.id, quantity: 1, unitPriceMinor: 100 }], cashAllocation: { id: 'different-payment', method: 'cash', amountMinor: 100, ordinal: 0 } })
    equal((await postOffline(fixture, signedOfflinePayload(changedOperation, fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, afterFirst); equal(permitEvidenceCount(fixture, reusablePermit.id), 1)
  })
})

test('Offline Sync HTTP failure matrix batch 3: product, money, and schema failures have zero effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const before = offlineEffects(fixture)
    const absentProduct = offlineEnvelope(fixture, fixture.permits[0]!, { lines: [{ id: 'extra-line', productId: fixture.extraProduct.id, quantity: 1, unitPriceMinor: 200 }], cashAllocation: { id: 'extra-payment', method: 'cash', amountMinor: 200, ordinal: 0 }, subtotalMinor: 200, payableTotalMinor: 200 })
    equal((await postOffline(fixture, signedOfflinePayload(absentProduct, fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const alteredPrice = offlineEnvelope(fixture, fixture.permits[1]!, { lines: [{ id: 'altered-line', productId: fixture.product.id, quantity: 1, unitPriceMinor: 101 }], cashAllocation: { id: 'altered-payment', method: 'cash', amountMinor: 101, ordinal: 0 }, subtotalMinor: 101, payableTotalMinor: 101 })
    equal((await postOffline(fixture, signedOfflinePayload(alteredPrice, fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const wrongCurrency = offlineEnvelope(fixture, fixture.permits[2]!, { currencyCode: 'EUR' })
    equal((await postOffline(fixture, signedOfflinePayload(wrongCurrency, fixture.pair.privateKey))).statusCode, 409); assertNoOfflineEffects(fixture, before)
    const valid = signedOfflinePayload(offlineEnvelope(fixture, fixture.permits[3]!), fixture.pair.privateKey)
    equal((await postOffline(fixture, { ...valid, envelope: { ...valid.envelope, subtotalMinor: 99 } })).statusCode, 400); assertNoOfflineEffects(fixture, before)
    equal((await postOffline(fixture, { ...valid, envelope: { ...valid.envelope, lines: [{ ...valid.envelope.lines[0]!, quantity: 0 }] } })).statusCode, 400); assertNoOfflineEffects(fixture, before)
    for (const envelope of [
      { ...valid.envelope, cashAllocation: { ...valid.envelope.cashAllocation, method: 'card' } },
      { ...valid.envelope, paymentAllocations: [valid.envelope.cashAllocation, valid.envelope.cashAllocation] },
      { ...valid.envelope, discountAmountMinor: 1 },
    ]) { equal((await postOffline(fixture, { ...valid, envelope })).statusCode, 400); assertNoOfflineEffects(fixture, before) }
    equal(conflictVerificationTotal(fixture), 0)
  })
})

test('Offline Sync HTTP stock conflict persists only immutable verification evidence', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const before = offlineEffects(fixture)
    const insufficient = offlineEnvelope(fixture, fixture.permits[0]!, { lines: [{ id: 'stock-line', productId: fixture.product.id, quantity: 6, unitPriceMinor: 100 }], cashAllocation: { id: 'stock-payment', method: 'cash', amountMinor: 600, ordinal: 0 }, subtotalMinor: 600, payableTotalMinor: 600 })
    const stockResponse = await postOffline(fixture, signedOfflinePayload(insufficient, fixture.pair.privateKey))
    equal(stockResponse.statusCode, 409); equal((stockResponse.json() as { message: string }).message, 'VERIFIED_OFFLINE_STOCK_CONFLICT'); assertNoOfflineEffects(fixture, before); equal(permitEvidenceCount(fixture, fixture.permits[0]!.id), 0); equal(conflictVerificationCount(fixture, fixture.permits[0]!.id), 1)
    equal((await postOffline(fixture, signedOfflinePayload(insufficient, fixture.pair.privateKey))).statusCode, 409); equal(conflictVerificationCount(fixture, fixture.permits[0]!.id), 1)
    const original = offlineEnvelope(fixture, fixture.permits[1]!, { offlineOperationId: 'idempotency-operation', proposedSaleId: 'idempotency-sale' })
    equal((await postOffline(fixture, signedOfflinePayload(original, fixture.pair.privateKey))).statusCode, 201)
    const afterOriginal = offlineEffects(fixture), changed = offlineEnvelope(fixture, fixture.permits[1]!, { offlineOperationId: 'idempotency-operation', proposedSaleId: 'changed-sale', lines: [{ id: 'changed-line', productId: fixture.product.id, quantity: 1, unitPriceMinor: 100 }], cashAllocation: { id: 'changed-payment', method: 'cash', amountMinor: 100, ordinal: 0 } })
    const conflict = await postOffline(fixture, signedOfflinePayload(changed, fixture.pair.privateKey))
    equal(conflict.statusCode, 409); equal((conflict.json() as { message: string }).message, 'IDEMPOTENCY_CONFLICT'); assertNoOfflineEffects(fixture, afterOriginal); equal(permitEvidenceCount(fixture, fixture.permits[1]!.id), 1)
  })
})

test('Offline stock-conflict materialization requires the narrow manager command and preserves a completed Sale', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const conflict = offlineEnvelope(fixture, fixture.permits[10]!, { lines: [{ id: 'materialize-line', productId: fixture.product.id, quantity: 6, unitPriceMinor: 100 }], cashAllocation: { id: 'materialize-payment', method: 'cash', amountMinor: 600, ordinal: 0 }, subtotalMinor: 600, payableTotalMinor: 600 })
    equal((await postOffline(fixture, signedOfflinePayload(conflict, fixture.pair.privateKey))).statusCode, 409)
    const url = `/api/v1/retail/locations/${fixture.location.id}/offline-stock-conflicts/materialize`, payload = { offlineOperationId: conflict.offlineOperationId, commandId: 'materialize-http' }
    equal((await fixture.app.inject({ method: 'POST', url, payload })).statusCode, 401)
    equal((await request(fixture.app, fixture.sessions['operator-1']!, { method: 'POST', url, payload })).statusCode, 403)
    equal((await request(fixture.app, fixture.session, { method: 'POST', url, payload })).statusCode, 201)
    equal((await request(fixture.app, fixture.session, { method: 'POST', url, payload })).statusCode, 200)
    equal((await request(fixture.app, fixture.session, { method: 'GET', url: `/api/v1/retail/locations/${fixture.location.id}/sales/${conflict.proposedSaleId}` })).statusCode, 200)
    equal((fixture.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(fixture.product.id, fixture.location.id) as { on_hand_quantity: number }).on_hand_quantity, -1)
    equal((fixture.database.prepare('SELECT COUNT(*) AS count FROM retail_offline_stock_conflict_incidents WHERE offline_operation_id=?').get(conflict.offlineOperationId) as { count: number }).count, 1)
  })
})

test('Fixture C: first Offline Sync presentation after authority trust loss creates no eligible verification or materialization effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const envelope = offlineEnvelope(fixture, fixture.permits[11]!, { offlineOperationId: 'trust-loss-first-presentation', proposedSaleId: 'trust-loss-sale', lines: [{ id: 'trust-loss-line', productId: fixture.product.id, quantity: 6, unitPriceMinor: 100 }], cashAllocation: { id: 'trust-loss-payment', method: 'cash', amountMinor: 600, ordinal: 0 }, subtotalMinor: 600, payableTotalMinor: 600 })
    await fixture.offline.revokeAuthority(fixture.authority.id, 'trust lost before first presentation', fixture.context)
    const before = materializationEffects(fixture)
    equal((await postOffline(fixture, signedOfflinePayload(envelope, fixture.pair.privateKey))).statusCode, 409)
    equal(conflictVerificationCount(fixture, fixture.permits[11]!.id), 0)
    equal(conflictVerificationTotal(fixture), 0)
    const materializer = new SqliteRetailOfflineStockConflictMaterializationRepository(fixture.file)
    try { await rejects(materializer.materialize(fixture.location.id, { offlineOperationId: envelope.offlineOperationId, commandId: 'trust-loss-materialize' }, fixture.context), /verification is required/) } finally { materializer.close() }
    deepEqual(materializationEffects(fixture), before)
  })
})

test('Fixture D: materialization HTTP endpoint denies a capable manager without an active Location grant and persists no effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const envelope = offlineEnvelope(fixture, fixture.permits[12]!, { offlineOperationId: 'missing-grant-materialization', proposedSaleId: 'missing-grant-sale', lines: [{ id: 'missing-grant-line', productId: fixture.product.id, quantity: 6, unitPriceMinor: 100 }], cashAllocation: { id: 'missing-grant-payment', method: 'cash', amountMinor: 600, ordinal: 0 }, subtotalMinor: 600, payableTotalMinor: 600 })
    equal((await postOffline(fixture, signedOfflinePayload(envelope, fixture.pair.privateKey))).statusCode, 409)
    equal(conflictVerificationCount(fixture, fixture.permits[12]!.id), 1)
    const before = materializationEffects(fixture)
    await fixture.access.revoke('manager-1', fixture.location.id, fixture.context)
    const response = await request(fixture.app, fixture.session, { method: 'POST', url: `/api/v1/retail/locations/${fixture.location.id}/offline-stock-conflicts/materialize`, payload: { offlineOperationId: envelope.offlineOperationId, commandId: 'missing-grant-command' } })
    equal(response.statusCode, 403)
    deepEqual(materializationEffects(fixture), before)
  })
})

test('Fixture E: materialization HTTP endpoint rejects an explicitly untrusted Origin without persisted effects', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const envelope = offlineEnvelope(fixture, fixture.permits[13]!, { offlineOperationId: 'untrusted-origin-materialization', proposedSaleId: 'untrusted-origin-sale', lines: [{ id: 'untrusted-origin-line', productId: fixture.product.id, quantity: 6, unitPriceMinor: 100 }], cashAllocation: { id: 'untrusted-origin-payment', method: 'cash', amountMinor: 600, ordinal: 0 }, subtotalMinor: 600, payableTotalMinor: 600 })
    equal((await postOffline(fixture, signedOfflinePayload(envelope, fixture.pair.privateKey))).statusCode, 409)
    const before = materializationEffects(fixture)
    const response = await fixture.app.inject({ method: 'POST', url: `/api/v1/retail/locations/${fixture.location.id}/offline-stock-conflicts/materialize`, payload: { offlineOperationId: envelope.offlineOperationId, commandId: 'untrusted-origin-command' }, headers: { cookie: `madina-session=${fixture.session}`, origin: 'https://untrusted.example' } })
    equal(response.statusCode, 403)
    deepEqual(materializationEffects(fixture), before)
    equal(conflictVerificationCount(fixture, fixture.permits[13]!.id), 1)
  })
})

interface OnlineSaleEffects { sales: number; items: number; allocations: number; onlineMovements: number; offlineMovements: number; onlineReceipts: number; offlineEvidence: number; offlineReceipts: number; productBalance: number; extraProductBalance: number }

function onlineSaleEffects(fixture: OfflineSyncFixture): OnlineSaleEffects {
  const count = (table: string, where = ''): number => (fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as { count: number }).count
  const balance = (productId: string): number => (fixture.database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id=? AND location_id=?').get(productId, fixture.location.id) as { on_hand_quantity: number }).on_hand_quantity
  return {
    sales: count('retail_sales'), items: count('retail_sale_items'), allocations: count('retail_payment_allocations'),
    onlineMovements: count('retail_inventory_movements', " WHERE source_type='retail_sale'"), offlineMovements: count('retail_inventory_movements', " WHERE source_type='retail_offline_sale_sync'"),
    onlineReceipts: count('retail_operation_receipts', " WHERE operation_kind='retail_sale_complete'"), offlineEvidence: count('retail_offline_sale_evidence'), offlineReceipts: count('retail_offline_sale_sync_receipts'),
    productBalance: balance(fixture.product.id), extraProductBalance: balance(fixture.extraProduct.id),
  }
}

function onlineSalePayload(operationId: string, productId: string, quantity: number, amountMinor: number): { clientOperationId: string; saleId: string; lines: Array<{ id: string; productId: string; quantity: number; unitPriceMinor: number }>; allocations: Array<{ id: string; method: 'cash'; amountMinor: number; ordinal: number }> } {
  return { clientOperationId: operationId, saleId: `online-sale-${operationId}`, lines: [{ id: `online-line-${operationId}`, productId, quantity, unitPriceMinor: 999 }], allocations: [{ id: `online-payment-${operationId}`, method: 'cash', amountMinor, ordinal: 0 }] }
}

function postOnline(fixture: OfflineSyncFixture, payload: unknown) { return request(fixture.app, fixture.session, { method: 'POST', url: `/api/v1/retail/locations/${fixture.location.id}/sales/complete`, payload }) }

test('Online Sale HTTP regression preserves ordinary rules and offline namespace isolation', async () => {
  await withOfflineSyncFixture(async (fixture) => {
    const first = onlineSalePayload('online-authority-price', fixture.product.id, 1, 100)
    const accepted = await postOnline(fixture, { ...first, authorityId: fixture.authority.id, permitId: fixture.permits[0]!.id, terminalId: fixture.terminal.id })
    equal(accepted.statusCode, 201)
    const acceptedBody = accepted.json() as { sale: { id: string; status: string }; items: Array<{ product_id: string; unit_price_minor: number }>; allocations: Array<{ method: string; amount_minor: number; ordinal: number }> }
    equal(acceptedBody.sale.id, first.saleId); equal(acceptedBody.sale.status, 'completed'); equal(acceptedBody.items[0]?.product_id, fixture.product.id); equal(acceptedBody.items[0]?.unit_price_minor, 100)
    deepEqual(acceptedBody.allocations, [{ id: `online-payment-${first.clientOperationId}`, sale_id: first.saleId, method: 'cash', amount_minor: 100, ordinal: 0 }])
    deepEqual(onlineSaleEffects(fixture), { sales: 1, items: 1, allocations: 1, onlineMovements: 1, offlineMovements: 0, onlineReceipts: 1, offlineEvidence: 0, offlineReceipts: 0, productBalance: 4, extraProductBalance: 5 })

    await fixture.catalog.updateProduct(fixture.product.id, { name: 'Offline', status: 'inactive' }, fixture.context)
    const afterInactive = onlineSaleEffects(fixture)
    const inactive = onlineSalePayload('online-inactive', fixture.product.id, 1, 100)
    equal((await postOnline(fixture, { ...inactive, authorityId: fixture.authority.id, permitId: fixture.permits[0]!.id, signature: 'offline-evidence-is-not-online-authority' })).statusCode, 409)
    deepEqual(onlineSaleEffects(fixture), afterInactive)

    const insufficient = onlineSalePayload('online-insufficient', fixture.extraProduct.id, 6, 1200)
    equal((await postOnline(fixture, insufficient)).statusCode, 409)
    deepEqual(onlineSaleEffects(fixture), afterInactive); equal(onlineSaleEffects(fixture).extraProductBalance >= 0, true)

    const offlineShared = offlineEnvelope(fixture, fixture.permits[0]!, { offlineOperationId: 'shared-offline-operation', proposedSaleId: 'offline-shared-sale' })
    equal((await postOffline(fixture, signedOfflinePayload(offlineShared, fixture.pair.privateKey))).statusCode, 201)
    deepEqual(onlineSaleEffects(fixture), { sales: 2, items: 2, allocations: 2, onlineMovements: 1, offlineMovements: 1, onlineReceipts: 1, offlineEvidence: 1, offlineReceipts: 1, productBalance: 3, extraProductBalance: 5 })

    const onlineWithOfflineOperationId = onlineSalePayload('shared-offline-operation', fixture.extraProduct.id, 1, 200)
    equal((await postOnline(fixture, onlineWithOfflineOperationId)).statusCode, 201)
    equal(onlineSaleEffects(fixture).onlineReceipts, 2); equal(onlineSaleEffects(fixture).offlineReceipts, 1); equal(onlineSaleEffects(fixture).extraProductBalance, 4)

    const onlineOnly = onlineSalePayload('online-only-operation', fixture.extraProduct.id, 1, 200)
    equal((await postOnline(fixture, onlineOnly)).statusCode, 201)
    const offlineWithOnlineOperationId = offlineEnvelope(fixture, fixture.permits[1]!, { offlineOperationId: 'online-only-operation', proposedSaleId: 'offline-online-only-sale' })
    equal((await postOffline(fixture, signedOfflinePayload(offlineWithOnlineOperationId, fixture.pair.privateKey))).statusCode, 201)
    deepEqual(onlineSaleEffects(fixture), { sales: 5, items: 5, allocations: 5, onlineMovements: 3, offlineMovements: 2, onlineReceipts: 3, offlineEvidence: 2, offlineReceipts: 2, productBalance: 2, extraProductBalance: 3 })
  })
})

test('Retail Sale, price, and discount capabilities map only to admin and manager', () => {
  for (const capability of [
    'retail:sales:read',
    'retail:sales:manage',
    'retail:sales:discount',
    'retail:prices:read',
    'retail:prices:manage',
  ] as const) {
    equal(hasRetailCapability('admin', capability), true)
    equal(hasRetailCapability('manager', capability), true)
    equal(hasRetailCapability('operator', capability), false)
    equal(hasRetailCapability('viewer', capability), false)
  }
})

test('Retail completed Sale reads and Returns enforce scoped authority and expose only immutable Return evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-return-api-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [{ id: 'admin-1', role: 'admin' }, { id: 'manager-1', role: 'manager' }, { id: 'operator-1', role: 'operator' }, { id: 'viewer-1', role: 'viewer' }])
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)
  const sales = new SqliteRetailSaleRepository(databaseFile)
  const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'return-api' }
  const store = await access.createLocation({ code: 'RETURN-A', name: 'Return A', type: 'store', status: 'active' }, context)
  const other = await access.createLocation({ code: 'RETURN-B', name: 'Return B', type: 'store', status: 'active' }, context)
  await access.configureCurrency(store.id, 'USD', 2, context)
  const product = await catalog.createProduct({ sourceId: 'RETURN-P', name: 'Return Product' }, context)
  await catalog.setPrice(product.id, store.id, 100, context)
  await inventory.recordMovement({ productId: product.id, locationId: store.id, quantityDelta: 30, type: 'opening', sourceType: 'test', sourceId: 'return-api', sourceLineId: 'seed' }, context)
  await access.grant('admin-1', store.id, context); await access.grant('manager-1', store.id, context)
  await sales.complete(store.id, { clientOperationId: 'return-read-sale', saleId: 'return-read-sale', lines: [{ id: 'return-read-item', productId: product.id, quantity: 3, discountAmountMinor: 1 }], allocations: [{ id: 'return-read-payment', method: 'cash', amountMinor: 299, ordinal: 0 }] }, context)
  const mixedProduct = await catalog.createProduct({ sourceId: 'RETURN-MIXED', name: 'Mixed Return Product' }, context)
  await catalog.setPrice(mixedProduct.id, store.id, 500, context)
  await inventory.recordMovement({ productId: mixedProduct.id, locationId: store.id, quantityDelta: 20, type: 'opening', sourceType: 'test', sourceId: 'return-api-mixed', sourceLineId: 'seed' }, context)
  await sales.complete(store.id, { clientOperationId: 'return-mixed-sale', saleId: 'return-mixed-sale', lines: [{ id: 'return-mixed-item', productId: mixedProduct.id, quantity: 20 }], allocations: [{ id: 'card', method: 'card', amountMinor: 4000, ordinal: 1 }, { id: 'cash', method: 'cash', amountMinor: 6000, ordinal: 0 }] }, context)
  await catalog.setPrice(product.id, store.id, 999, context)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const base = `/api/v1/retail/locations/${store.id}/sales/return-read-sale`
  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: base })).statusCode, 401)
    equal((await request(app, sessions['operator-1']!, { method: 'GET', url: base })).statusCode, 403)
    const read = await request(app, sessions['manager-1']!, { method: 'GET', url: base })
    equal(read.statusCode, 200)
    const readBody = read.json() as { sale: { payable_total_minor: number }; items: Array<{ sale_item_id: string; unit_price_minor: number; line_total_minor: number; discount_amount_minor: number; already_returned_quantity: number }>; paymentAllocations: Array<{ amount_minor: number; already_refunded_amount_minor: number }> }
    equal(readBody.sale.payable_total_minor, 299)
    deepEqual(readBody.items[0], { sale_item_id: 'return-read-item', product_id: product.id, source_id: 'RETURN-P', name: 'Return Product', quantity: 3, unit_price_minor: 100, line_total_minor: 300, discount_amount_minor: 1, already_returned_quantity: 0, already_refunded_amount_minor: 0 })
    equal(readBody.paymentAllocations[0]?.amount_minor, 299)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: `/api/v1/retail/locations/${other.id}/sales/return-read-sale` })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: `${base}-missing` })).statusCode, 404)
    const payload = { clientOperationId: 'return-read-1', items: [{ saleItemId: 'return-read-item', quantity: 1 }] }
    equal((await app.inject({ method: 'POST', url: `${base}/returns`, payload, headers: { cookie: `madina-session=${sessions['manager-1']}` } })).statusCode, 403)
    equal((await request(app, sessions['operator-1']!, { method: 'POST', url: `${base}/returns`, payload })).statusCode, 403)
    equal((await request(app, sessions['viewer-1']!, { method: 'POST', url: `${base}/returns`, payload })).statusCode, 403)
    const first = await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/returns`, payload })
    equal(first.statusCode, 201)
    equal(((first.json() as { items: Array<{ refunded_amount_minor: number }> }).items)[0]?.refunded_amount_minor, 100)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/returns`, payload })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/returns`, payload: { ...payload, items: [{ saleItemId: 'return-read-item', quantity: 2 }] } })).statusCode, 409)
    const mixedBase = `/api/v1/retail/locations/${store.id}/sales/return-mixed-sale/returns`
    const mixedFirst = await request(app, sessions['manager-1']!, { method: 'POST', url: mixedBase, payload: { clientOperationId: 'return-mixed-1', items: [{ saleItemId: 'return-mixed-item', quantity: 14 }] } })
    equal(mixedFirst.statusCode, 201)
    deepEqual((mixedFirst.json() as { refundAllocations: Array<{ method: string; amount_minor: number }> }).refundAllocations.map((allocation) => [allocation.method, allocation.amount_minor]), [['cash', 6000], ['card', 1000]])
    const mixedSecond = await request(app, sessions['manager-1']!, { method: 'POST', url: mixedBase, payload: { clientOperationId: 'return-mixed-2', items: [{ saleItemId: 'return-mixed-item', quantity: 3 }] } })
    equal(mixedSecond.statusCode, 201)
    deepEqual((mixedSecond.json() as { refundAllocations: Array<{ method: string; amount_minor: number }> }).refundAllocations.map((allocation) => [allocation.method, allocation.amount_minor]), [['card', 1500]])
    const second = await request(app, sessions['admin-1']!, { method: 'POST', url: `${base}/returns`, payload: { clientOperationId: 'return-read-2', items: [{ saleItemId: 'return-read-item', quantity: 1 }] } })
    const third = await request(app, sessions['admin-1']!, { method: 'POST', url: `${base}/returns`, payload: { clientOperationId: 'return-read-3', items: [{ saleItemId: 'return-read-item', quantity: 1 }] } })
    equal((second.json() as { items: Array<{ refunded_amount_minor: number }> }).items[0]?.refunded_amount_minor, 100)
    equal((third.json() as { items: Array<{ refunded_amount_minor: number }> }).items[0]?.refunded_amount_minor, 99)
    await catalog.updateProduct(product.id, { name: product.name, status: 'inactive' }, context)
    equal((await request(app, sessions['manager-1']!, { method: 'GET', url: base })).statusCode, 200)
    equal((await inventory.findBalance(product.id, store.id))?.onHandQuantity, 30)
  } finally {
    await app.close(); sales.close(); inventory.close(); catalog.close(); access.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Retail Sale, price, and currency APIs enforce Stage 8B authority boundaries', async () => {
  const directory=mkdtempSync(join(tmpdir(),'madina-retail-sale-api-')),databaseFile=join(directory,'madina.sqlite'),previousDatabaseFile=process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions=await seedSessions(databaseFile,[{id:'admin-1',role:'admin'},{id:'admin-2',role:'admin'},{id:'manager-1',role:'manager'},{id:'operator-1',role:'operator'}])
  const access=new SqliteRetailAccessRepository(databaseFile),catalog=new SqliteRetailCatalogRepository(databaseFile),inventory=new SqliteRetailInventoryRepository(databaseFile),audit=new SqliteAuditRepository(databaseFile),context={actorType:'user' as const,actorUserId:'admin-1',requestId:'sale-api'}
  const store=await access.createLocation({code:'SALE-A',name:'Sale A',type:'store',status:'active'},context),other=await access.createLocation({code:'SALE-B',name:'Sale B',type:'store',status:'active'},context),inactive=await access.createLocation({code:'SALE-I',name:'Sale I',type:'store',status:'inactive'},context),unconfigured=await access.createLocation({code:'SALE-C',name:'Sale C',type:'store',status:'active'},context)
  const product=await catalog.createProduct({sourceId:'SALE-1',name:'Sale product'},context),unpriced=await catalog.createProduct({sourceId:'SALE-2',name:'Unpriced'},context)
  await access.configureCurrency(store.id,'USD',2,context);await catalog.setPrice(product.id,store.id,10,context);await catalog.setPrice(product.id,unconfigured.id,10,context);await inventory.recordMovement({productId:product.id,locationId:store.id,quantityDelta:10,type:'opening',sourceType:'test',sourceId:'sale-api',sourceLineId:'opening'},context);await inventory.recordMovement({productId:product.id,locationId:unconfigured.id,quantityDelta:1,type:'opening',sourceType:'test',sourceId:'sale-api',sourceLineId:'unconfigured'},context);await access.grant('admin-1',store.id,context);await access.grant('manager-1',store.id,context);await access.grant('manager-1',inactive.id,context);await access.grant('manager-1',unconfigured.id,context)
  process.env.DATABASE_FILE=databaseFile;const app=buildApp();const base=`/api/v1/retail/locations/${store.id}`;const sale={clientOperationId:'sale-api-1',saleId:'sale-api-1',lines:[{id:'sale-api-line',productId:product.id,quantity:1,unitPriceMinor:999}],allocations:[{id:'sale-api-payment',method:'cash',amountMinor:10,ordinal:0}],currencyCode:'XXX',currencyExponent:9}
  try { await app.ready()
    equal((await app.inject({method:'POST',url:`${base}/sales/complete`,payload:sale})).statusCode,401)
    equal((await request(app,sessions['operator-1']!,{method:'POST',url:`${base}/sales/complete`,payload:sale})).statusCode,403)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${other.id}/sales/complete`,payload:sale})).statusCode,403)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${inactive.id}/sales/complete`,payload:sale})).statusCode,403)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{}})).statusCode,400)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-invalid-quantity',saleId:'sale-api-invalid-quantity',lines:[{id:'sale-api-invalid-line',productId:product.id,quantity:0}]}})).statusCode,400)
    const created=await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:sale});equal(created.statusCode,201);const completed=created.json() as {sale:{id:string;currency_code:string;currency_exponent:number};items:Array<{unit_price_minor:number}>};equal(completed.sale.id,sale.saleId);equal(completed.sale.currency_code,'USD');equal(completed.sale.currency_exponent,2);equal(completed.items[0]?.unit_price_minor,10)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:sale})).statusCode,200)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,saleId:'sale-api-conflict'}})).statusCode,409)
    const discountedSale={clientOperationId:'sale-api-discount',saleId:'sale-api-discount',lines:[{id:'sale-api-discount-line',productId:product.id,quantity:1,unitPriceMinor:999,discountAmountMinor:3}],allocations:[{id:'sale-api-discount-payment',method:'cash',amountMinor:7,ordinal:0}]}
    const discountedCreated=await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:discountedSale});equal(discountedCreated.statusCode,201);const discountedCompleted=discountedCreated.json() as {sale:{id:string;subtotal_minor:number;payable_total_minor:number};items:Array<{unit_price_minor:number;line_total_minor:number}>};equal(discountedCompleted.sale.id,discountedSale.saleId);equal(discountedCompleted.sale.subtotal_minor,10);equal(discountedCompleted.sale.payable_total_minor,7);equal(discountedCompleted.items[0]?.unit_price_minor,10);equal(discountedCompleted.items[0]?.line_total_minor,10)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:discountedSale})).statusCode,200)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...discountedSale,lines:[{...discountedSale.lines[0],discountAmountMinor:2}],allocations:[{...discountedSale.allocations[0],amountMinor:8}]}})).statusCode,409)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-discount-zero',saleId:'sale-api-discount-zero',lines:[{id:'sale-api-discount-zero-line',productId:product.id,quantity:1,discountAmountMinor:0}],allocations:[{id:'sale-api-discount-zero-payment',method:'cash',amountMinor:10,ordinal:0}]}})).statusCode,400)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-discount-full',saleId:'sale-api-discount-full',lines:[{id:'sale-api-discount-full-line',productId:product.id,quantity:1,discountAmountMinor:10}],allocations:[{id:'sale-api-discount-full-payment',method:'cash',amountMinor:1,ordinal:0}]}})).statusCode,400)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-stock',saleId:'sale-api-stock',lines:[{id:'stock',productId:product.id,quantity:99}],allocations:[{id:'stock-pay',method:'cash',amountMinor:990,ordinal:0}]}})).statusCode,409)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-price',saleId:'sale-api-price',lines:[{id:'price',productId:unpriced.id,quantity:1}],allocations:[{id:'price-pay',method:'cash',amountMinor:1,ordinal:0}]}})).statusCode,409)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${unconfigured.id}/sales/complete`,payload:{...sale,clientOperationId:'sale-api-currency',saleId:'sale-api-currency'}})).statusCode,409)
    const priceUrl=`${base}/products/${product.id}/price`;equal((await app.inject({method:'PUT',url:priceUrl,payload:{unitPriceMinor:25}})).statusCode,401);equal((await request(app,sessions['operator-1']!,{method:'PUT',url:priceUrl,payload:{unitPriceMinor:25}})).statusCode,403);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:`/api/v1/retail/locations/${other.id}/products/${product.id}/price`,payload:{unitPriceMinor:25}})).statusCode,403);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:`/api/v1/retail/locations/${inactive.id}/products/${product.id}/price`,payload:{unitPriceMinor:25}})).statusCode,403);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:priceUrl,payload:{unitPriceMinor:0}})).statusCode,409);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:priceUrl,payload:{unitPriceMinor:-1}})).statusCode,409);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:priceUrl,payload:{unitPriceMinor:Number.MAX_SAFE_INTEGER+1}})).statusCode,400);equal((await request(app,sessions['manager-1']!,{method:'PUT',url:priceUrl,payload:{unitPriceMinor:25}})).statusCode,200);equal(await catalog.findPrice(product.id,store.id),25);equal((await request(app,sessions['manager-1']!,{method:'GET',url:priceUrl})).statusCode,200);equal((await request(app,sessions['operator-1']!,{method:'GET',url:priceUrl})).statusCode,403);equal((await audit.findAll()).some(event=>event.action==='retail.product_price_set'),true)
    const currencyUrl=`${base}`;equal((await app.inject({method:'PATCH',url:currencyUrl,payload:{currencyCode:'EUR',currencyExponent:0}})).statusCode,401);equal((await request(app,sessions['manager-1']!,{method:'PATCH',url:currencyUrl,payload:{currencyCode:'EUR',currencyExponent:0}})).statusCode,403);equal((await request(app,sessions['admin-2']!,{method:'PATCH',url:currencyUrl,payload:{currencyCode:'EUR',currencyExponent:0}})).statusCode,403);equal((await request(app,sessions['admin-1']!,{method:'PATCH',url:`/api/v1/retail/locations/${inactive.id}`,payload:{currencyCode:'EUR',currencyExponent:0}})).statusCode,403);for(const payload of [{currencyCode:'usd',currencyExponent:0},{currencyCode:'US',currencyExponent:0},{currencyCode:'УСД',currencyExponent:0},{currencyCode:'USD',currencyExponent:-1},{currencyCode:'USD',currencyExponent:10},{currencyCode:'USD',currencyExponent:1.5},{currencyCode:'USD',currencyExponent:Number.MAX_SAFE_INTEGER+1}])equal((await request(app,sessions['admin-1']!,{method:'PATCH',url:currencyUrl,payload})).statusCode,400);equal((await request(app,sessions['admin-1']!,{method:'PATCH',url:currencyUrl,payload:{currencyCode:'EUR',currencyExponent:0}})).statusCode,200);equal((await access.findLocation(store.id))?.currencyCode,'EUR');equal((await audit.findAll()).some(event=>event.action==='retail.location_updated'),true)
  } finally { audit.close();await app.close();inventory.close();catalog.close();access.close();if(previousDatabaseFile===undefined)delete process.env.DATABASE_FILE;else process.env.DATABASE_FILE=previousDatabaseFile;rmSync(directory,{recursive:true,force:true}) }
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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

test('Goods Receipt routes enforce warehouse-only capability and active Location authorization without payload escalation', async () => {
  const directory=mkdtempSync(join(tmpdir(),'madina-retail-goods-receipt-routes-')),databaseFile=join(directory,'madina.sqlite'),previousDatabaseFile=process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions=await seedSessions(databaseFile,[{id:'admin-1',role:'admin'},{id:'manager-1',role:'manager'},{id:'operator-1',role:'operator'}])
  const access=new SqliteRetailAccessRepository(databaseFile),catalog=new SqliteRetailCatalogRepository(databaseFile),inventory=new SqliteRetailInventoryRepository(databaseFile)
  const context={actorType:'user' as const,actorUserId:'admin-1',requestId:'goods-receipt-route-test'}
  const warehouseA=await access.createLocation({code:'WH-A',name:'Warehouse A',type:'central_warehouse',status:'active'},context)
  const warehouseB=await access.createLocation({code:'WH-B',name:'Warehouse B',type:'central_warehouse',status:'active'},context)
  const store=await access.createLocation({code:'STORE',name:'Store',type:'store',status:'active'},context)
  const inactive=await access.createLocation({code:'WH-I',name:'Inactive Warehouse',type:'central_warehouse',status:'inactive'},context)
  const product=await catalog.createProduct({sourceId:'P-1',name:'Product'},context)
  await access.grant('manager-1',warehouseA.id,context);await access.grant('manager-1',inactive.id,context)
  process.env.DATABASE_FILE=databaseFile
  const app=buildApp()
  try { await app.ready()
    const base=`/api/v1/retail/locations/${warehouseA.id}/goods-receipts`
    const payload={receiptReference:'GR-API-1',lines:[{productId:product.id,quantity:4}],locationId:warehouseB.id,role:'admin',capability:'retail:goods-receipts:manage'}
    equal((await app.inject({method:'POST',url:base,payload})).statusCode,401)
    equal((await request(app,sessions['operator-1']!,{method:'POST',url:base,payload})).statusCode,403)
    await access.revoke('manager-1',warehouseA.id,context)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:base,payload})).statusCode,403)
    await access.grant('manager-1',warehouseA.id,context)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${inactive.id}/goods-receipts`,payload})).statusCode,403)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${store.id}/goods-receipts`,payload})).statusCode,403)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`/api/v1/retail/locations/${warehouseB.id}/goods-receipts`,payload})).statusCode,403)
    const created=await request(app,sessions['manager-1']!,{method:'POST',url:base,payload})
    equal(created.statusCode,201)
    const receiptId=(created.json() as {goodsReceipt:{id:string;locationId:string}}).goodsReceipt.id
    equal((created.json() as {goodsReceipt:{locationId:string}}).goodsReceipt.locationId,warehouseA.id)
    equal((await request(app,sessions['manager-1']!,{method:'POST',url:`${base}/${receiptId}/complete`,payload:{locationId:warehouseB.id,role:'admin'}})).statusCode,200)
    equal((await inventory.findBalance(product.id,warehouseA.id))?.onHandQuantity,4)
    equal((await inventory.findBalance(product.id,warehouseB.id)),undefined)
    equal((await request(app,sessions['manager-1']!,{method:'GET',url:`${base}/${receiptId}`})).statusCode,200)
    await access.revoke('manager-1',warehouseA.id,context)
    equal((await request(app,sessions['manager-1']!,{method:'GET',url:`${base}/${receiptId}`})).statusCode,403)
  } finally { await app.close();inventory.close();catalog.close();access.close();if(previousDatabaseFile===undefined)delete process.env.DATABASE_FILE;else process.env.DATABASE_FILE=previousDatabaseFile;rmSync(directory,{recursive:true,force:true}) }
})

test('Retail Transfer routes require both persisted Locations and reject request-field escalation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-transfer-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'manager-1', role: 'manager' }, { id: 'operator-1', role: 'operator' },
  ])
  const access = new SqliteRetailAccessRepository(databaseFile)
  const catalog = new SqliteRetailCatalogRepository(databaseFile)
  const inventory = new SqliteRetailInventoryRepository(databaseFile)
  const context = { actorType: 'user' as const, actorUserId: 'manager-1', requestId: 'transfer-route-test' }
  const source = await access.createLocation({ code: 'SOURCE', name: 'Source', type: 'store', status: 'active' }, context)
  const destination = await access.createLocation({ code: 'DESTINATION', name: 'Destination', type: 'store', status: 'active' }, context)
  const inactive = await access.createLocation({ code: 'INACTIVE', name: 'Inactive', type: 'store', status: 'inactive' }, context)
  const product = await catalog.createProduct({ sourceId: 'P-1', name: 'Product' }, context)
  await inventory.recordMovement({ productId: product.id, locationId: source.id, quantityDelta: 8, type: 'opening', sourceType: 'test', sourceId: 'seed', sourceLineId: '1' }, context)
  await access.grant('manager-1', source.id, context)
  await access.grant('manager-1', inactive.id, context)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const base = `/api/v1/retail/locations/${source.id}/transfers`
  const payload = { destinationLocationId: destination.id, lines: [{ productId: product.id, quantity: 3 }], role: 'admin', capability: 'retail:transfers:manage', grants: [source.id, destination.id], sourceLocationId: inactive.id }

  try {
    await app.ready()
    equal((await app.inject({ method: 'POST', url: base, payload })).statusCode, 401)
    equal((await request(app, sessions['operator-1']!, { method: 'POST', url: base, payload })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: base, payload })).statusCode, 403)
    await access.grant('manager-1', destination.id, context)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `/api/v1/retail/locations/${inactive.id}/transfers`, payload })).statusCode, 403)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: base, payload: { ...payload, destinationLocationId: inactive.id } })).statusCode, 403)

    const created = await request(app, sessions['manager-1']!, { method: 'POST', url: base, payload })
    equal(created.statusCode, 201)
    const transfer = (created.json() as { transfer: { id: string; sourceLocationId: string; destinationLocationId: string } }).transfer
    equal(transfer.sourceLocationId, source.id)
    equal(transfer.destinationLocationId, destination.id)

    await access.revoke('manager-1', source.id, context)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/${transfer.id}/dispatch`, payload: { sourceLocationId: inactive.id, destinationLocationId: inactive.id, role: 'admin', grants: [inactive.id] } })).statusCode, 403)
    await access.grant('manager-1', source.id, context)
    await access.revoke('manager-1', destination.id, context)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/${transfer.id}/dispatch`, payload: { sourceLocationId: source.id, destinationLocationId: source.id, capability: 'retail:transfers:manage' } })).statusCode, 403)
    await access.grant('manager-1', destination.id, context)

    const dispatched = await request(app, sessions['manager-1']!, { method: 'POST', url: `${base}/${transfer.id}/dispatch`, payload: { sourceLocationId: inactive.id, destinationLocationId: inactive.id, role: 'operator', capability: 'retail:locations:read', grants: [] } })
    equal(dispatched.statusCode, 200)
    equal((await inventory.findBalance(product.id, source.id))?.onHandQuantity, 5)
    await access.revoke('manager-1', destination.id, context)
    equal((await request(app, sessions['manager-1']!, { method: 'POST', url: `/api/v1/retail/locations/${destination.id}/transfers/${transfer.id}/receive`, payload: { sourceLocationId: inactive.id, destinationLocationId: inactive.id, role: 'admin' } })).statusCode, 403)
    await access.grant('manager-1', destination.id, context)
    const received = await request(app, sessions['manager-1']!, { method: 'POST', url: `/api/v1/retail/locations/${destination.id}/transfers/${transfer.id}/receive`, payload: { sourceLocationId: inactive.id, destinationLocationId: inactive.id, role: 'operator', capability: 'retail:locations:read' } })
    equal(received.statusCode, 200)
    equal((await inventory.findBalance(product.id, destination.id))?.onHandQuantity, 3)
  } finally {
    await app.close(); inventory.close(); catalog.close(); access.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})
