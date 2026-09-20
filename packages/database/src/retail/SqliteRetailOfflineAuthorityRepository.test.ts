import { equal, rejects, throws } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { hasRetailCapability } from '@madina/retail'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailOfflineAuthorityRepository } from './SqliteRetailOfflineAuthorityRepository.js'
import { RETAIL_OFFLINE_SIGNATURE_ALGORITHM } from '@madina/retail'

const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'offline-authority-test' }
const publicKey = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

async function fixture(run: (value: { file: string; offline: SqliteRetailOfflineAuthorityRepository; access: SqliteRetailAccessRepository; catalog: SqliteRetailCatalogRepository; location: { id: string }; product: { id: string } }) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'retail-offline-authority-'))
  const file = join(directory, 'x.sqlite')
  initializeDatabase(file)
  const auth = new SqliteAuthRepository(file), access = new SqliteRetailAccessRepository(file), catalog = new SqliteRetailCatalogRepository(file), offline = new SqliteRetailOfflineAuthorityRepository(file)
  try {
    await auth.createUser({ id: 'admin-1', username: 'Admin', normalizedUsername: 'admin', email: 'admin@example.test', role: 'admin', status: 'active', sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() })
    await auth.createUser({ id: 'cashier-1', username: 'Cashier', normalizedUsername: 'cashier', email: 'cashier@example.test', role: 'operator', status: 'active', sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() })
    await auth.createUser({ id: 'operator-1', username: 'Operator', normalizedUsername: 'operator', email: 'operator@example.test', role: 'operator', status: 'active', sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() })
    await auth.createUser({ id: 'manager-1', username: 'Manager', normalizedUsername: 'manager', email: 'manager@example.test', role: 'manager', status: 'active', sessionVersion: 1, createdAt: new Date(), updatedAt: new Date() })
    const location = await access.createLocation({ code: 'STORE', name: 'Store', type: 'store', status: 'active' }, context)
    await access.configureCurrency(location.id, 'USD', 2, context)
    const product = await catalog.createProduct({ sourceId: 'P-1', name: 'Product' }, context)
    await catalog.setPrice(product.id, location.id, 1000, context)
    await run({ file, offline, access, catalog, location, product })
  } finally { offline.close(); catalog.close(); access.close(); auth.close(); rmSync(directory, { recursive: true, force: true }) }
}

async function authority(value: { offline: SqliteRetailOfflineAuthorityRepository; location: { id: string }; product: { id: string } }) {
  const terminal = await value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: publicKey() }, context)
  const issued = await value.offline.issueAuthority({ terminalId: terminal.id, userId: 'cashier-1', locationId: value.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 2, productIds: [value.product.id] }, context)
  return { terminal, issued, permits: await value.offline.listPermits(issued.id) }
}

test('offline terminal capability is limited to admin and manager', () => {
  equal(hasRetailCapability('admin', 'retail:offline-terminals:manage'), true)
  equal(hasRetailCapability('manager', 'retail:offline-terminals:manage'), true)
  equal(hasRetailCapability('operator', 'retail:offline-terminals:manage'), false)
  equal(hasRetailCapability('viewer', 'retail:offline-terminals:manage'), false)
})

test('offline terminal lifecycle requires terminal-management capability and manager Location access', async () => fixture(async (value) => {
  await rejects(value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: publicKey() }, { actorType: 'user', actorUserId: 'operator-1', requestId: 'operator' }), /management access/)
  const manager = { actorType: 'user' as const, actorUserId: 'manager-1', requestId: 'manager' }
  await rejects(value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: publicKey() }, manager), /Location access/)
  await value.access.grant('manager-1', value.location.id, context)
  equal((await value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: publicKey() }, manager)).enrolledByUserId, 'manager-1')
}))

test('offline authority snapshots server price and creates immutable public-key terminal evidence', async () => fixture(async (value) => {
  const { terminal, issued, permits } = await authority(value)
  equal(terminal.currentKeyVersion, 1); equal(permits.length, 2)
  const database = new DatabaseSync(value.file)
  try {
    const authorityRow = database.prepare('SELECT payment_method,discounts_allowed,currency_code,currency_exponent FROM retail_offline_authorities WHERE id=?').get(issued.id) as { payment_method: string; discounts_allowed: number; currency_code: string; currency_exponent: number }
    equal(authorityRow.payment_method, 'cash'); equal(authorityRow.discounts_allowed, 0); equal(authorityRow.currency_code, 'USD'); equal(authorityRow.currency_exponent, 2)
    equal((database.prepare('SELECT unit_price_minor FROM retail_offline_authority_product_prices WHERE authority_id=?').get(issued.id) as { unit_price_minor: number }).unit_price_minor, 1000)
    const columns = database.prepare('PRAGMA table_info(retail_offline_terminal_keys)').all() as { name: string }[]
    equal(columns.some((column) => column.name.toLowerCase().includes('private')), false)
    throws(() => database.prepare('UPDATE retail_offline_authorities SET expires_at=? WHERE id=?').run(new Date().toISOString(), issued.id), /immutable/)
    throws(() => database.prepare('UPDATE retail_offline_authority_product_prices SET unit_price_minor=1 WHERE authority_id=?').run(issued.id), /immutable/)
  } finally { database.close() }
  const rotated = await value.offline.rotateTerminalKey(terminal.id, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey(), context)
  equal(rotated.currentKeyVersion, 2)
  await value.offline.revokeTerminal(terminal.id, 'lost device', context)
  await rejects(value.offline.rotateTerminalKey(terminal.id, RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey(), context), /revoked/)
  await value.offline.revokeAuthority(issued.id, 'expired device', context)
  equal((await value.offline.findAuthority(issued.id))?.revoked, true)
}))

test('offline authority rejects unsafe policy and atomically rolls back a failed permit issuance', async () => fixture(async (value) => {
  const terminal = await value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: publicKey() }, context)
  const input = { terminalId: terminal.id, userId: 'cashier-1', locationId: value.location.id, expiresAt: new Date(Date.now() + 60_000), permitCount: 2, productIds: [value.product.id] }
  await rejects(value.offline.issueAuthority({ ...input, terminalId: 'missing' }, context), /not found/)
  await rejects(value.offline.issueAuthority({ ...input, locationId: 'wrong-location' }, context), /Location mismatch/)
  await rejects(value.offline.issueAuthority({ ...input, expiresAt: new Date(0) }, context), /expiresAt/)
  await rejects(value.offline.issueAuthority({ ...input, permitCount: 0 }, context), /permit count/)
  await rejects(value.offline.issueAuthority({ ...input, paymentMethod: 'card' }, context), /cash/)
  await rejects(value.offline.issueAuthority({ ...input, discountsAllowed: true }, context), /discounts/)
  await rejects(value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: 'ed25519', publicKey: publicKey() }, context), /unsupported/)
  await rejects(value.offline.enrollTerminal({ locationId: value.location.id, keyAlgorithm: RETAIL_OFFLINE_SIGNATURE_ALGORITHM, publicKey: 'not-base64!' }, context), /invalid/)
  const database = new DatabaseSync(value.file)
  try {
    database.exec("CREATE TRIGGER test_fail_offline_permit BEFORE INSERT ON retail_offline_authority_permits BEGIN SELECT RAISE(ABORT, 'forced permit failure'); END;")
    await rejects(value.offline.issueAuthority(input, context), /forced permit failure/)
    equal((database.prepare('SELECT COUNT(*) AS count FROM retail_offline_authorities').get() as { count: number }).count, 0)
    equal((database.prepare('SELECT COUNT(*) AS count FROM retail_offline_authority_permits').get() as { count: number }).count, 0)
  } finally { database.close() }
}))

test('offline evidence is append-only, replay-safe, and has no Sale or inventory effects', async () => fixture(async (value) => {
  const { terminal, issued, permits } = await authority(value)
  const input = { offlineOperationId: 'operation-1', authorityId: issued.id, authorityVersion: issued.authorityVersion, permitId: permits[0]!.id, terminalId: terminal.id, terminalKeyVersion: terminal.currentKeyVersion, userId: 'cashier-1', locationId: value.location.id, proposedSaleId: 'proposed-sale-1', claimedCompletedAt: new Date(), canonicalPayload: '{"v":1}', payloadHash: 'hash-1', signature: 'signature-1' }
  equal((await value.offline.persistEvidence(input)).replayed, false)
  equal((await value.offline.persistEvidence(input)).replayed, true)
  await rejects(value.offline.persistEvidence({ ...input, canonicalPayload: '{"v":2}' }), /IDEMPOTENCY_CONFLICT/)
  const database = new DatabaseSync(value.file)
  try {
    equal((database.prepare('SELECT COUNT(*) AS count FROM retail_sales').get() as { count: number }).count, 0)
    equal((database.prepare('SELECT COUNT(*) AS count FROM retail_inventory_movements').get() as { count: number }).count, 0)
    equal((database.prepare('SELECT COUNT(*) AS count FROM retail_payment_allocations').get() as { count: number }).count, 0)
  } finally { database.close() }
}))
