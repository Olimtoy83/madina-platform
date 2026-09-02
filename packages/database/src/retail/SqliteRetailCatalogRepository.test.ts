import { equal, rejects } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'

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
