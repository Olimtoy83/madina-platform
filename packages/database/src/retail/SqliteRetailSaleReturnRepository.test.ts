import { deepEqual, equal, rejects, throws } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Worker } from 'node:worker_threads'
import type { User } from '@madina/auth'
import { hasRetailCapability } from '@madina/retail'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailSaleRepository } from './SqliteRetailSaleRepository.js'
import { SqliteRetailSaleReturnRepository } from './SqliteRetailSaleReturnRepository.js'

const user: User = { id: 'return-manager', username: 'return-manager', normalizedUsername: 'return-manager', role: 'manager', status: 'active', sessionVersion: 1, createdAt: new Date('2026-09-19T00:00:00.000Z'), updatedAt: new Date('2026-09-19T00:00:00.000Z') }
const context = { actorType: 'user' as const, actorUserId: user.id, requestId: 'return-test' }

async function fixture(run: (value: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'retail-return-'))
  const filename = join(directory, 'return.sqlite')
  initializeDatabase(filename)
  const auth = new SqliteAuthRepository(filename)
  const access = new SqliteRetailAccessRepository(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  const inventory = new SqliteRetailInventoryRepository(filename)
  const sales = new SqliteRetailSaleRepository(filename)
  const returns = new SqliteRetailSaleReturnRepository(filename)
  try {
    await auth.createUser(user)
    const location = await access.createLocation({ code: 'RETURN', name: 'Return Store', type: 'store', status: 'active' }, context)
    await access.configureCurrency(location.id, 'USD', 2, context)
    await run({ filename, auth, access, catalog, inventory, sales, returns, location })
  } finally {
    returns.close(); sales.close(); inventory.close(); catalog.close(); access.close(); auth.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

async function productWithStock(value: any, sourceId: string, price: number, stock: number) {
  const product = await value.catalog.createProduct({ sourceId, name: sourceId }, context)
  await value.catalog.setPrice(product.id, value.location.id, price, context)
  await value.inventory.recordMovement({ productId: product.id, locationId: value.location.id, quantityDelta: stock, type: 'opening', sourceType: 'test', sourceId: `seed-${sourceId}`, sourceLineId: '1' }, context)
  return product
}

function completeInWorker(filename: string, locationId: string, input: { clientOperationId: string; originalSaleId: string; items: readonly { saleItemId: string; quantity: number }[] }) {
  return new Promise<{ ok: boolean; message?: string }>((resolve, reject) => {
    const worker = new Worker(new URL('./SqliteRetailSaleReturnRepository.concurrentWorker.js', import.meta.url), { workerData: { filename, locationId, input, context } })
    worker.once('message', (message: unknown) => resolve(message as { ok: boolean; message?: string }))
    worker.once('error', reject)
  })
}

test('migration 039 creates immutable Return evidence and return capability assignments are exact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'retail-return-migration-'))
  const filename = join(directory, 'return.sqlite')
  try {
    initializeDatabase(filename)
    const database = new DatabaseSync(filename)
    try {
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'retail_sale_return%' ORDER BY name").all().map((row: any) => row.name)
      deepEqual(tables, ['retail_sale_return_items', 'retail_sale_return_operation_receipts', 'retail_sale_return_refund_allocations', 'retail_sale_returns'])
      const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'retail_sale_return%' ORDER BY name").all().map((row: any) => row.name)
      equal(triggers.length, 8)
    } finally { database.close() }
    equal(hasRetailCapability('admin', 'retail:sales:return'), true)
    equal(hasRetailCapability('manager', 'retail:sales:return'), true)
    equal(hasRetailCapability('operator', 'retail:sales:return'), false)
    equal(hasRetailCapability('viewer', 'retail:sales:return'), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('discounted partial Returns use deterministic minor-unit allocation, replay once, and preserve original evidence', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'ROUNDING', 100, 3)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-round', saleId: 'sale-round', lines: [{ id: 'sale-round-item', productId: product.id, quantity: 3, discountAmountMinor: 1 }], allocations: [{ id: 'sale-round-payment', method: 'cash', amountMinor: 299, ordinal: 0 }] }, context)
  const database = new DatabaseSync(value.filename)
  const original = database.prepare('SELECT * FROM retail_sales WHERE id = ?').get('sale-round')
  try {
    const first = await value.returns.complete(value.location.id, { clientOperationId: 'return-round-1', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 1 }] }, context)
    const replay = await value.returns.complete(value.location.id, { clientOperationId: 'return-round-1', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 1 }] }, context)
    const second = await value.returns.complete(value.location.id, { clientOperationId: 'return-round-2', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 1 }] }, context)
    const third = await value.returns.complete(value.location.id, { clientOperationId: 'return-round-3', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 1 }] }, context)
    equal(first.replayed, false); equal(replay.replayed, true); equal(second.replayed, false); equal(third.replayed, false)
    const amounts = database.prepare('SELECT refunded_amount_minor FROM retail_sale_return_items ORDER BY rowid').all().map((row: any) => row.refunded_amount_minor)
    deepEqual(amounts, [100, 100, 99])
    equal(database.prepare('SELECT SUM(refunded_amount_minor) AS amount FROM retail_sale_return_items').get()!.amount, 299)
    equal((await value.inventory.findBalance(product.id, value.location.id))?.onHandQuantity, 3)
    equal(database.prepare("SELECT COUNT(*) AS count FROM retail_inventory_movements WHERE source_type='retail_sale_return'").get()!.count, 3)
    await rejects(value.returns.complete(value.location.id, { clientOperationId: 'return-round-over', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 1 }] }, context), /quantity exceeds/)
    await rejects(value.returns.complete(value.location.id, { clientOperationId: 'return-round-1', originalSaleId: 'sale-round', items: [{ saleItemId: 'sale-round-item', quantity: 2 }] }, context), /IDEMPOTENCY_CONFLICT/)
    deepEqual(database.prepare('SELECT * FROM retail_sales WHERE id = ?').get('sale-round'), original)
  } finally { database.close() }
}))

test('discounted Return allocation preserves the 33331 minor-unit example exactly', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'ROUNDING-33331', 12345, 3)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-33331', saleId: 'sale-33331', lines: [{ id: 'sale-33331-item', productId: product.id, quantity: 3, discountAmountMinor: 3704 }], allocations: [{ id: 'sale-33331-payment', method: 'cash', amountMinor: 33331, ordinal: 0 }] }, context)
  const two = await value.returns.complete(value.location.id, { clientOperationId: 'return-33331-two', originalSaleId: 'sale-33331', items: [{ saleItemId: 'sale-33331-item', quantity: 2 }] }, context)
  const one = await value.returns.complete(value.location.id, { clientOperationId: 'return-33331-one', originalSaleId: 'sale-33331', items: [{ saleItemId: 'sale-33331-item', quantity: 1 }] }, context)
  equal((two.items as any[])[0].refunded_amount_minor, 22221)
  equal((one.items as any[])[0].refunded_amount_minor, 11110)
}))

test('one Return records multiple original SaleItems and one movement for each', async () => fixture(async (value) => {
  const firstProduct = await productWithStock(value, 'MULTI-FIRST', 100, 2)
  const secondProduct = await productWithStock(value, 'MULTI-SECOND', 200, 2)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-multi', saleId: 'sale-multi', lines: [{ id: 'sale-multi-first', productId: firstProduct.id, quantity: 2 }, { id: 'sale-multi-second', productId: secondProduct.id, quantity: 1 }], allocations: [{ id: 'sale-multi-payment', method: 'cash', amountMinor: 400, ordinal: 0 }] }, context)
  const result = await value.returns.complete(value.location.id, { clientOperationId: 'return-multi', originalSaleId: 'sale-multi', items: [{ saleItemId: 'sale-multi-second', quantity: 1 }, { saleItemId: 'sale-multi-first', quantity: 1 }] }, context)
  equal((result.items as unknown[]).length, 2)
  equal((result.movements as unknown[]).length, 2)
  equal((await value.inventory.findBalance(firstProduct.id, value.location.id))?.onHandQuantity, 1)
  equal((await value.inventory.findBalance(secondProduct.id, value.location.id))?.onHandQuantity, 2)
}))

test('mixed original payments are refunded by immutable ordinal capacity and Return input rejects invalid quantities', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'MIXED', 500, 20)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-mixed', saleId: 'sale-mixed', lines: [{ id: 'sale-mixed-item', productId: product.id, quantity: 20 }], allocations: [{ id: 'card', method: 'card', amountMinor: 4000, ordinal: 1 }, { id: 'cash', method: 'cash', amountMinor: 6000, ordinal: 0 }] }, context)
  const first = await value.returns.complete(value.location.id, { clientOperationId: 'return-mixed-1', originalSaleId: 'sale-mixed', items: [{ saleItemId: 'sale-mixed-item', quantity: 14 }] }, context)
  const second = await value.returns.complete(value.location.id, { clientOperationId: 'return-mixed-2', originalSaleId: 'sale-mixed', items: [{ saleItemId: 'sale-mixed-item', quantity: 3 }] }, context)
  const firstRefunds = (first.refundAllocations as any[]).map((item) => [item.method, item.amount_minor])
  const secondRefunds = (second.refundAllocations as any[]).map((item) => [item.method, item.amount_minor])
  deepEqual(firstRefunds, [['cash', 6000], ['card', 1000]])
  deepEqual(secondRefunds, [['card', 1500]])
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await rejects(value.returns.complete(value.location.id, { clientOperationId: `invalid-${quantity}`, originalSaleId: 'sale-mixed', items: [{ saleItemId: 'sale-mixed-item', quantity }] }, context), /quantity is invalid/)
  await rejects(value.returns.complete(value.location.id, { clientOperationId: 'duplicate', originalSaleId: 'sale-mixed', items: [{ saleItemId: 'sale-mixed-item', quantity: 1 }, { saleItemId: 'sale-mixed-item', quantity: 1 }] }, context), /duplicate SaleItem/)
}))

test('two independent SQLite connections cannot both over-return the same completed SaleItem', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'CONCURRENT', 100, 3)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-concurrent', saleId: 'sale-concurrent', lines: [{ id: 'sale-concurrent-item', productId: product.id, quantity: 3 }], allocations: [{ id: 'sale-concurrent-payment', method: 'cash', amountMinor: 300, ordinal: 0 }] }, context)
  const outcomes = await Promise.all([
    completeInWorker(value.filename, value.location.id, { clientOperationId: 'return-concurrent-a', originalSaleId: 'sale-concurrent', items: [{ saleItemId: 'sale-concurrent-item', quantity: 2 }] }),
    completeInWorker(value.filename, value.location.id, { clientOperationId: 'return-concurrent-b', originalSaleId: 'sale-concurrent', items: [{ saleItemId: 'sale-concurrent-item', quantity: 2 }] }),
  ])
  equal(outcomes.filter((outcome) => outcome.ok).length, 1)
  equal(outcomes.some((outcome) => /quantity exceeds/.test(outcome.message ?? '')), true)
  const database = new DatabaseSync(value.filename)
  try {
    equal(database.prepare('SELECT SUM(quantity) AS quantity FROM retail_sale_return_items').get()!.quantity, 2)
    equal(database.prepare('SELECT SUM(refunded_amount_minor) AS amount FROM retail_sale_return_items').get()!.amount, 200)
  } finally { database.close() }
}))

test('historically sold inactive Product returns through the narrow Return movement path while ordinary inventory remains closed', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'INACTIVE', 100, 2)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-inactive', saleId: 'sale-inactive', lines: [{ id: 'sale-inactive-item', productId: product.id, quantity: 1 }], allocations: [{ id: 'sale-inactive-payment', method: 'cash', amountMinor: 100, ordinal: 0 }] }, context)
  await value.catalog.updateProduct(product.id, { name: product.name, status: 'inactive' }, context)
  await value.returns.complete(value.location.id, { clientOperationId: 'return-inactive', originalSaleId: 'sale-inactive', items: [{ saleItemId: 'sale-inactive-item', quantity: 1 }] }, context)
  await rejects(value.inventory.recordMovement({ productId: product.id, locationId: value.location.id, quantityDelta: 1, type: 'opening', sourceType: 'test', sourceId: 'inactive', sourceLineId: '1' }, context), /inactive/)
  const database = new DatabaseSync(value.filename)
  try {
    equal(database.prepare('SELECT status FROM retail_products WHERE id = ?').get(product.id)!.status, 'inactive')
    throws(() => database.prepare('UPDATE retail_sale_returns SET location_id = ?').run(value.location.id), /immutable/)
    throws(() => database.prepare('DELETE FROM retail_sale_return_items').run(), /immutable/)
  } finally { database.close() }
}))

test('failure after Return item persistence rolls back Return, refund, stock, and receipt evidence', async () => fixture(async (value) => {
  const product = await productWithStock(value, 'ROLLBACK', 100, 2)
  await value.sales.complete(value.location.id, { clientOperationId: 'sale-rollback', saleId: 'sale-rollback', lines: [{ id: 'sale-rollback-item', productId: product.id, quantity: 1 }], allocations: [{ id: 'sale-rollback-payment', method: 'cash', amountMinor: 100, ordinal: 0 }] }, context)
  const database = new DatabaseSync(value.filename)
  try {
    database.exec("CREATE TRIGGER fail_return_refund BEFORE INSERT ON retail_sale_return_refund_allocations BEGIN SELECT RAISE(ABORT, 'forced refund failure'); END;")
    await rejects(value.returns.complete(value.location.id, { clientOperationId: 'return-rollback', originalSaleId: 'sale-rollback', items: [{ saleItemId: 'sale-rollback-item', quantity: 1 }] }, context), /forced refund failure/)
    equal(database.prepare('SELECT COUNT(*) AS count FROM retail_sale_returns').get()!.count, 0)
    equal(database.prepare('SELECT COUNT(*) AS count FROM retail_sale_return_items').get()!.count, 0)
    equal(database.prepare('SELECT COUNT(*) AS count FROM retail_sale_return_refund_allocations').get()!.count, 0)
    equal(database.prepare('SELECT COUNT(*) AS count FROM retail_sale_return_operation_receipts').get()!.count, 0)
    equal((await value.inventory.findBalance(product.id, value.location.id))?.onHandQuantity, 1)
  } finally { database.close() }
}))
