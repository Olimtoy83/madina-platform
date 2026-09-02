import { equal, rejects, throws } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'

const context = { actorType: 'user' as const, actorUserId: 'admin-1', requestId: 'inventory-test' }

async function withRepositories(run: (repositories: { filename: string; access: SqliteRetailAccessRepository; catalog: SqliteRetailCatalogRepository; inventory: SqliteRetailInventoryRepository }) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-inventory-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)
  const access = new SqliteRetailAccessRepository(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  const inventory = new SqliteRetailInventoryRepository(filename)
  try { await run({ filename, access, catalog, inventory }) } finally { inventory.close(); catalog.close(); access.close(); rmSync(directory, { recursive: true, force: true }) }
}

async function seed(repositories: { access: SqliteRetailAccessRepository; catalog: SqliteRetailCatalogRepository }) {
  const product = await repositories.catalog.createProduct({ sourceId: 'P-1', name: 'Product 1' }, context)
  const otherProduct = await repositories.catalog.createProduct({ sourceId: 'P-2', name: 'Product 2' }, context)
  const location = await repositories.access.createLocation({ code: 'STORE-A', name: 'Store A', type: 'store', status: 'active' }, context)
  const otherLocation = await repositories.access.createLocation({ code: 'STORE-B', name: 'Store B', type: 'store', status: 'active' }, context)
  return { product, otherProduct, location, otherLocation }
}

test('Retail inventory records atomic location-scoped integer balances with idempotent ledger evidence', async () => {
  await withRepositories(async ({ inventory, ...repositories }) => {
    const { product, otherProduct, location, otherLocation } = await seed(repositories)
    equal(await inventory.findBalance(product.id, location.id), undefined)
    const first = await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 10, type: 'opening', sourceType: 'opening_count', sourceId: 'count-1', sourceLineId: 'line-1' }, context)
    const repeated = await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 10, type: 'opening', sourceType: 'opening_count', sourceId: 'count-1', sourceLineId: 'line-1' }, context)
    equal(repeated.id, first.id)
    await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: -3, type: 'reconciliation_adjustment', sourceType: 'test', sourceId: 'decrement-1', sourceLineId: 'line-1' }, context)
    await inventory.recordMovement({ productId: product.id, locationId: otherLocation.id, quantityDelta: 7, type: 'opening', sourceType: 'test', sourceId: 'location-b', sourceLineId: 'line-1' }, context)
    await inventory.recordMovement({ productId: otherProduct.id, locationId: location.id, quantityDelta: 4, type: 'opening', sourceType: 'test', sourceId: 'product-b', sourceLineId: 'line-1' }, context)
    equal((await inventory.findBalance(product.id, location.id))?.onHandQuantity, 7)
    equal((await inventory.findBalance(product.id, otherLocation.id))?.onHandQuantity, 7)
    equal((await inventory.findBalance(otherProduct.id, location.id))?.onHandQuantity, 4)
    const history = await inventory.listMovements(product.id, location.id)
    equal(history.length, 2)
    equal(history.reduce((total, movement) => total + movement.quantityDelta, 0), 7)
    equal((await inventory.listBalances(location.id)).length, 2)
  })
})

test('Retail inventory rejects invalid or negative mutations without diverging balance and ledger', async () => {
  await withRepositories(async ({ inventory, ...repositories }) => {
    const { product, location } = await seed(repositories)
    await rejects(inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 0, type: 'opening', sourceType: 'test', sourceId: 'zero', sourceLineId: 'line-1' }, context), /non-zero safe integer/)
    await rejects(inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: -1, type: 'sale', sourceType: 'test', sourceId: 'negative', sourceLineId: 'line-1' }, context), /negative on-hand/)
    equal(await inventory.findBalance(product.id, location.id), undefined)
    equal((await inventory.listMovements(product.id, location.id)).length, 0)
    await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 5, type: 'opening', sourceType: 'test', sourceId: 'positive', sourceLineId: 'line-1' }, context)
    const outcomes = await Promise.allSettled([
      inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: -4, type: 'sale', sourceType: 'test', sourceId: 'sale-a', sourceLineId: 'line-1' }, context),
      inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: -4, type: 'sale', sourceType: 'test', sourceId: 'sale-b', sourceLineId: 'line-1' }, context),
    ])
    equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    equal((await inventory.findBalance(product.id, location.id))?.onHandQuantity, 1)
  })
})

test('Retail inventory forbids new movements for inactive entities while preserving append-only history', async () => {
  await withRepositories(async ({ filename, inventory, access, catalog, ...repositories }) => {
    const { product, otherProduct, location } = await seed({ access, catalog, ...repositories })
    const movement = await inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 2, type: 'opening', sourceType: 'test', sourceId: 'history', sourceLineId: 'line-1' }, context)
    await catalog.updateProduct(product.id, { name: product.name, status: 'inactive' }, context)
    await rejects(inventory.recordMovement({ productId: product.id, locationId: location.id, quantityDelta: 1, type: 'opening', sourceType: 'test', sourceId: 'inactive-product', sourceLineId: 'line-1' }, context), /inactive/)
    equal((await inventory.listMovements(product.id, location.id))[0]?.id, movement.id)
    const database = new DatabaseSync(filename)
    try {
      throws(() => database.prepare('UPDATE retail_inventory_movements SET quantity_delta = 3 WHERE id = ?').run(movement.id), /immutable/)
      throws(() => database.prepare('DELETE FROM retail_inventory_movements WHERE id = ?').run(movement.id), /immutable/)
    } finally { database.close() }
    const inactive = await access.createLocation({ code: 'INACTIVE', name: 'Inactive', type: 'store', status: 'inactive' }, context)
    await rejects(inventory.recordMovement({ productId: otherProduct.id, locationId: inactive.id, quantityDelta: 1, type: 'opening', sourceType: 'test', sourceId: 'inactive-location', sourceLineId: 'line-1' }, context), /Location is inactive/)
  })
})
