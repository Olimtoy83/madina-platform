import { deepEqual, equal, rejects } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'

const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'retail-catalog-test' }

async function withCatalog(run: (catalog: SqliteRetailCatalogRepository, filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-catalog-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  try { await run(catalog, filename) } finally { catalog.close(); rmSync(directory, { recursive: true, force: true }) }
}

test('Retail Product source identity and barcodes are independent from quantity', async () => {
  await withCatalog(async (catalog, filename) => {
    const product = await catalog.createProduct({ sourceId: 'WL-992025 / A', name: 'Wilmax plate' }, context)
    equal(product.baseUnit, 'piece')
    equal('quantity' in product, false)
    const first = await catalog.addBarcode(product.id, '005052609920253', context)
    const second = await catalog.addBarcode(product.id, '5052609920253', context)
    equal(first.value, '005052609920253')
    equal((await catalog.listBarcodes(product.id)).length, 2)
    equal((await catalog.findProductByBarcode('005052609920253'))?.id, product.id)
    await rejects(catalog.addBarcode(product.id, '5052609920253', context))
    const other = await catalog.createProduct({ sourceId: 'OTHER-1', name: 'Other' }, context)
    await rejects(catalog.addBarcode(other.id, '5052609920253', context), /conflicts/)
    const database = new DatabaseSync(filename)
    try {
      const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'retail_product_barcodes'").all() as Array<{ sql: string | null }>
      equal(indexes.some((index) => index.sql?.includes('UNIQUE')), false)
    } finally { database.close() }
  })
})

test('Retail Product import dry-run, quarantine, conflicts, and repeatability are explicit', async () => {
  await withCatalog(async (catalog) => {
    const rows = [
      { sourceRef: 'row-1', sourceId: 'WL-992025 / A', name: 'Wilmax plate', barcode: '005052609920253' },
      { sourceRef: 'row-2', sourceId: 'WL-992025 / B', name: 'Wilmax bowl', barcode: '005052609920253' },
      { sourceRef: 'row-3', sourceId: '', name: 'Missing ID', barcode: '123' },
      { sourceRef: 'row-4', sourceId: 'BAD-1', name: 'Bad barcode', barcode: 'bad barcode' },
    ]
    const dryRun = await catalog.importProducts(rows, true, context)
    equal(dryRun.summary.created, 1)
    equal(dryRun.summary.conflict, 1)
    equal(dryRun.summary.quarantine, 2)
    equal((await catalog.listProducts()).length, 0)
    const applied = await catalog.importProducts(rows, false, context)
    equal(applied.summary.created, 1)
    equal((await catalog.listProducts()).length, 1)
    equal((await catalog.findProductByBarcode('005052609920253'))?.sourceId, 'WL-992025 / A')
    const repeated = await catalog.importProducts([rows[0]!], false, context)
    equal(repeated.summary.no_op, 1)
    equal((await catalog.listProducts()).length, 1)
  })
})

test('Retail Product price import is dry-run safe, atomic, and leaves inventory untouched', async () => {
  await withCatalog(async (catalog, filename) => {
    const access = new SqliteRetailAccessRepository(filename)
    try {
      const location = await access.createLocation({ code: 'CATALOG', name: 'Catalog', type: 'store', status: 'active' }, context)
      await access.configureCurrency(location.id, 'UZS', 0, context)
      const row = { sourceRef: 'row-1', sourceId: 'SKU-1', name: 'Tea', barcode: '460000000001', unitPriceMinor: 12500 }

      const dryRun = await catalog.importProductsWithPrices(location.id, [row], true, context)
      equal(dryRun.canApply, true)
      deepEqual(dryRun.outcomes[0]?.price, { kind: 'created', unitPriceMinor: 12500 })
      equal((await catalog.listProducts()).length, 0)

      const applied = await catalog.importProductsWithPrices(location.id, [row], false, context)
      equal(applied.canApply, true)
      const product = (await catalog.listProducts())[0]!
      equal((await catalog.findProductByBarcode('460000000001'))?.id, product.id)
      equal(await catalog.findPrice(product.id, location.id), 12500)

      const updated = await catalog.importProductsWithPrices(location.id, [{ ...row, name: 'Green tea', unitPriceMinor: 13000 }], false, context)
      deepEqual(updated.outcomes[0]?.price, { kind: 'updated', unitPriceMinor: 13000 })
      equal((await catalog.findProduct(product.id))?.name, 'Green tea')
      equal(await catalog.findPrice(product.id, location.id), 13000)

      const repeated = await catalog.importProductsWithPrices(location.id, [{ ...row, name: 'Green tea', unitPriceMinor: 13000 }], false, context)
      equal(repeated.outcomes[0]?.kind, 'no_op')
      deepEqual(repeated.outcomes[0]?.price, { kind: 'no_op', unitPriceMinor: 13000 })

      const database = new DatabaseSync(filename)
      try {
        const effects = () => ({
          products: (database.prepare('SELECT COUNT(*) AS count FROM retail_products').get() as { count: number }).count,
          barcodes: (database.prepare('SELECT COUNT(*) AS count FROM retail_product_barcodes').get() as { count: number }).count,
          prices: (database.prepare('SELECT COUNT(*) AS count FROM retail_product_prices').get() as { count: number }).count,
          movements: (database.prepare('SELECT COUNT(*) AS count FROM retail_inventory_movements').get() as { count: number }).count,
          balances: (database.prepare('SELECT COUNT(*) AS count FROM retail_inventory_balances').get() as { count: number }).count,
          audits: (database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'retail.products_imported'").get() as { count: number }).count,
        })
        const beforeRejected = effects()
        const rejected = await catalog.importProductsWithPrices(location.id, [
          { sourceRef: 'bad-price', sourceId: 'SKU-2', name: 'Bad price', unitPriceMinor: 0 },
          { sourceRef: 'barcode-conflict', sourceId: 'SKU-3', name: 'Conflict', barcode: '460000000001', unitPriceMinor: 100 },
        ], false, context)
        equal(rejected.canApply, false)
        equal(rejected.summary.quarantine, 1)
        equal(rejected.summary.conflict, 1)
        deepEqual(effects(), beforeRejected)

        database.exec("CREATE TRIGGER fail_catalog_price BEFORE INSERT ON retail_product_prices WHEN NEW.product_id <> 'never' BEGIN SELECT RAISE(ABORT, 'forced price failure'); END;")
        const beforeRollback = effects()
        await rejects(catalog.importProductsWithPrices(location.id, [{ sourceRef: 'rollback', sourceId: 'SKU-ROLLBACK', name: 'Rollback', barcode: '460000000002', unitPriceMinor: 100 }], false, context), /forced price failure/)
        deepEqual(effects(), beforeRollback)
      } finally { database.close() }
    } finally { access.close() }
  })
})

test('Retail location product edit atomically changes identity, appends barcode, price, and deactivation', async () => {
  await withCatalog(async (catalog, filename) => {
    const access = new SqliteRetailAccessRepository(filename); const database = new DatabaseSync(filename)
    try {
      const location = await access.createLocation({ code: 'EDIT', name: 'Edit', type: 'store', status: 'active' }, context); await access.configureCurrency(location.id, 'UZS', 0, context)
      const product = await catalog.createProduct({ sourceId: '1100000', name: 'qwerty' }, context); await catalog.addBarcode(product.id, '0001', context); await catalog.setPrice(product.id, location.id, 90000, context)
      const updated = await catalog.updateProductAtLocation(product.id, location.id, { name: 'qqqqqqqq', status: 'inactive', appendBarcode: '0002', unitPriceMinor: 100000 }, context)
      equal(updated.sourceId, '1100000'); equal(updated.name, 'qqqqqqqq'); equal(updated.status, 'inactive'); deepEqual((await catalog.listBarcodes(product.id)).map(item => item.value), ['0001', '0002']); equal(await catalog.findPrice(product.id, location.id), 100000)
      equal((database.prepare('SELECT COUNT(*) AS count FROM retail_inventory_movements').get() as { count: number }).count, 0)
      await catalog.updateProduct(product.id, { name: 'qqqqqqqq', status: 'active' }, context)
      const before = { product: await catalog.findProduct(product.id), barcodes: await catalog.listBarcodes(product.id), price: await catalog.findPrice(product.id, location.id) }
      database.exec("CREATE TRIGGER fail_edit_price_update BEFORE UPDATE ON retail_product_prices BEGIN SELECT RAISE(ABORT, 'forced edit price failure'); END;")
      await rejects(catalog.updateProductAtLocation(product.id, location.id, { name: 'must rollback', status: 'active', appendBarcode: '0003', unitPriceMinor: 110000 }, context), /forced edit price failure/)
      deepEqual(await catalog.findProduct(product.id), before.product); deepEqual(await catalog.listBarcodes(product.id), before.barcodes); equal(await catalog.findPrice(product.id, location.id), before.price)
    } finally { database.close(); access.close() }
  })
})
