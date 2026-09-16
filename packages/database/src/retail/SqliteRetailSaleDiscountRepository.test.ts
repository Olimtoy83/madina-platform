import { createHash } from 'node:crypto'
import { equal, rejects } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { User } from '@madina/auth'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailSaleRepository } from './SqliteRetailSaleRepository.js'

const context = {
  actorType: 'user' as const,
  actorUserId: 'u',
  requestId: 'sale-discount-test',
}

test('no-discount Sale preserves the Stage 8 completion payload hash', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sale-discount-hash-'))
  const filename = join(directory, 'x.sqlite')

  initializeDatabase(filename)

  const access = new SqliteRetailAccessRepository(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  const inventory = new SqliteRetailInventoryRepository(filename)
  const sales = new SqliteRetailSaleRepository(filename)

  try {
    const location = await access.createLocation({
      code: 'S',
      name: 'Store',
      type: 'store',
      status: 'active',
    }, context)

    await access.configureCurrency(location.id, 'USD', 2, context)

    const product = await catalog.createProduct({
      sourceId: 'P',
      name: 'Product',
    }, context)

    await catalog.setPrice(product.id, location.id, 25, context)

    await inventory.recordMovement({
      productId: product.id,
      locationId: location.id,
      quantityDelta: 3,
      type: 'opening',
      sourceType: 'test',
      sourceId: 'seed',
      sourceLineId: '1',
    }, context)

    const input = {
      clientOperationId: 'stage8-compatible-op',
      saleId: 'stage8-compatible-sale',
      lines: [{
        id: 'stage8-compatible-line',
        productId: product.id,
        quantity: 2,
      }],
      allocations: [{
        id: 'stage8-compatible-payment',
        method: 'cash' as const,
        amountMinor: 50,
        ordinal: 0,
      }],
    }

    const expectedStage8Hash = createHash('sha256')
      .update(JSON.stringify({
        locationId: location.id,
        saleId: input.saleId,
        lines: [...input.lines].sort((a, b) => a.id.localeCompare(b.id)),
        allocations: [...input.allocations].sort(
          (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
        ),
      }))
      .digest('hex')

    const result = await sales.complete(location.id, input, context)

    equal(result.replayed, false)

    const database = new DatabaseSync(filename)

    try {
      const receipt = database.prepare(`
        SELECT schema_version, payload_hash
        FROM retail_operation_receipts
        WHERE operation_kind = 'retail_sale_complete'
          AND client_operation_id = ?
      `).get(input.clientOperationId) as {
        schema_version: number
        payload_hash: string
      } | undefined

      equal(receipt?.schema_version, 1)
      equal(receipt?.payload_hash, expectedStage8Hash)
    } finally {
      database.close()
    }

    const replay = await sales.complete(location.id, input, context)
    equal(replay.replayed, true)
  } finally {
    sales.close()
    inventory.close()
    catalog.close()
    access.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('discounted Sale preserves gross price evidence and records authorized item discount', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sale-discount-complete-'))
  const filename = join(directory, 'x.sqlite')

  initializeDatabase(filename)

  const auth = new SqliteAuthRepository(filename)
  const access = new SqliteRetailAccessRepository(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  const inventory = new SqliteRetailInventoryRepository(filename)
  const sales = new SqliteRetailSaleRepository(filename)

  const now = new Date('2026-09-16T00:00:00.000Z')

  const manager: User = {
    id: 'discount-manager',
    username: 'discount-manager',
    normalizedUsername: 'discount-manager',
    role: 'manager',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }

  const managerContext = {
    actorType: 'user' as const,
    actorUserId: manager.id,
    requestId: 'discounted-sale-test',
  }

  try {
    await auth.createUser(manager)

    const location = await access.createLocation({
      code: 'DS',
      name: 'Discount Store',
      type: 'store',
      status: 'active',
    }, managerContext)

    await access.configureCurrency(location.id, 'USD', 2, managerContext)

    const product = await catalog.createProduct({
      sourceId: 'DISCOUNT-PRODUCT',
      name: 'Discount Product',
    }, managerContext)

    await catalog.setPrice(product.id, location.id, 5000, managerContext)

    await inventory.recordMovement({
      productId: product.id,
      locationId: location.id,
      quantityDelta: 5,
      type: 'opening',
      sourceType: 'test',
      sourceId: 'discount-seed',
      sourceLineId: '1',
    }, managerContext)

    const result = await sales.complete(location.id, {
      clientOperationId: 'discount-op-1',
      saleId: 'discount-sale-1',
      lines: [{
        id: 'discount-line-1',
        productId: product.id,
        quantity: 2,
        discountAmountMinor: 1000,
      }],
      allocations: [{
        id: 'discount-payment-1',
        method: 'cash',
        amountMinor: 9000,
        ordinal: 0,
      }],
    }, managerContext)

    equal(result.replayed, false)

    const database = new DatabaseSync(filename)

    try {
      const sale = database.prepare(`
        SELECT subtotal_minor, payable_total_minor
        FROM retail_sales
        WHERE id = ?
      `).get('discount-sale-1') as {
        subtotal_minor: number
        payable_total_minor: number
      } | undefined

      equal(sale?.subtotal_minor, 10000)
      equal(sale?.payable_total_minor, 9000)

      const item = database.prepare(`
        SELECT unit_price_minor, line_total_minor
        FROM retail_sale_items
        WHERE id = ?
      `).get('discount-line-1') as {
        unit_price_minor: number
        line_total_minor: number
      } | undefined

      equal(item?.unit_price_minor, 5000)
      equal(item?.line_total_minor, 10000)

      const discount = database.prepare(`
        SELECT amount_minor, authorized_by
        FROM retail_sale_item_discounts
        WHERE sale_item_id = ?
      `).get('discount-line-1') as {
        amount_minor: number
        authorized_by: string
      } | undefined

      equal(discount?.amount_minor, 1000)
      equal(discount?.authorized_by, manager.id)
    } finally {
      database.close()
    }
  } finally {
    sales.close()
    inventory.close()
    catalog.close()
    access.close()
    auth.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
test('discount amount validation rejects invalid and non-payable item discounts', async () => {
const invalidDiscounts = [
  { name: 'zero', value: 0 },
  { name: 'negative', value: -1 },
  { name: 'fractional', value: 1.5 },
  { name: 'unsafe', value: Number.MAX_SAFE_INTEGER + 1 },
  { name: 'equal-line-total', value: 100 },
  { name: 'greater-than-line-total', value: 101 },
]

for (const invalid of invalidDiscounts) {
  const directory = mkdtempSync(join(tmpdir(), `sale-discount-invalid-${invalid.name}-`))
  const filename = join(directory, 'x.sqlite')

  initializeDatabase(filename)

  const auth = new SqliteAuthRepository(filename)
  const access = new SqliteRetailAccessRepository(filename)
  const catalog = new SqliteRetailCatalogRepository(filename)
  const inventory = new SqliteRetailInventoryRepository(filename)
  const sales = new SqliteRetailSaleRepository(filename)

  const now = new Date('2026-09-16T00:00:00.000Z')

  const manager: User = {
    id: `manager-${invalid.name}`,
    username: `manager-${invalid.name}`,
    normalizedUsername: `manager-${invalid.name}`,
    role: 'manager',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }

  const managerContext = {
    actorType: 'user' as const,
    actorUserId: manager.id,
    requestId: `invalid-discount-${invalid.name}`,
  }

  try {
    await auth.createUser(manager)

    const location = await access.createLocation({
      code: `I-${invalid.name}`,
      name: `Invalid ${invalid.name}`,
      type: 'store',
      status: 'active',
    }, managerContext)

    await access.configureCurrency(location.id, 'USD', 2, managerContext)

    const product = await catalog.createProduct({
      sourceId: `P-${invalid.name}`,
      name: `Product ${invalid.name}`,
    }, managerContext)

    await catalog.setPrice(product.id, location.id, 100, managerContext)

    await inventory.recordMovement({
      productId: product.id,
      locationId: location.id,
      quantityDelta: 5,
      type: 'opening',
      sourceType: 'test',
      sourceId: `seed-${invalid.name}`,
      sourceLineId: '1',
    }, managerContext)

    const expected = Number.isSafeInteger(invalid.value) && invalid.value >= 100
      ? /Retail Sale discount must be less than line total\./
      : /Retail Sale discount amount is invalid\./

    await rejects(
      sales.complete(location.id, {
        clientOperationId: `invalid-op-${invalid.name}`,
        saleId: `invalid-sale-${invalid.name}`,
        lines: [{
          id: `invalid-line-${invalid.name}`,
          productId: product.id,
          quantity: 1,
          discountAmountMinor: invalid.value,
        }],
        allocations: [{
          id: `invalid-payment-${invalid.name}`,
          method: 'cash',
          amountMinor: 99,
          ordinal: 0,
        }],
      }, managerContext),
      expected,
    )

    const database = new DatabaseSync(filename)

    try {
      const saleCount = database.prepare(
        'SELECT COUNT(*) AS count FROM retail_sales WHERE id = ?',
      ).get(`invalid-sale-${invalid.name}`) as { count: number }

      const receiptCount = database.prepare(`
        SELECT COUNT(*) AS count
        FROM retail_operation_receipts
        WHERE operation_kind = 'retail_sale_complete'
          AND client_operation_id = ?
      `).get(`invalid-op-${invalid.name}`) as { count: number }

      equal(saleCount.count, 0)
      equal(receiptCount.count, 0)
    } finally {
      database.close()
    }
  } finally {
    sales.close()
    inventory.close()
    catalog.close()
    access.close()
    auth.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
})

test('discounted Sale fails closed for non-user actor without persistence effects', async () => {
const directory = mkdtempSync(join(tmpdir(), 'sale-discount-non-user-'))
const filename = join(directory, 'x.sqlite')

initializeDatabase(filename)

const access = new SqliteRetailAccessRepository(filename)
const catalog = new SqliteRetailCatalogRepository(filename)
const inventory = new SqliteRetailInventoryRepository(filename)
const sales = new SqliteRetailSaleRepository(filename)

try {
const location = await access.createLocation({
  code: 'NU',
  name: 'Non User Store',
  type: 'store',
  status: 'active',
}, context)

await access.configureCurrency(location.id, 'USD', 2, context)

const product = await catalog.createProduct({
  sourceId: 'NON-USER-PRODUCT',
  name: 'Non User Product',
}, context)

await catalog.setPrice(product.id, location.id, 1000, context)

await inventory.recordMovement({
  productId: product.id,
  locationId: location.id,
  quantityDelta: 5,
  type: 'opening',
  sourceType: 'test',
  sourceId: 'non-user-seed',
  sourceLineId: '1',
}, context)

const databaseBefore = new DatabaseSync(filename)

let stockBefore: number

try {
  const row = databaseBefore.prepare(`
    SELECT COALESCE(SUM(quantity_delta), 0) AS stock
    FROM retail_inventory_movements
    WHERE product_id = ? AND location_id = ?
  `).get(product.id, location.id) as { stock: number }

  stockBefore = row.stock
} finally {
  databaseBefore.close()
}

const systemContext = {
  actorType: 'system' as const,
  requestId: 'discount-system-attempt',
}

await rejects(
  sales.complete(location.id, {
    clientOperationId: 'discount-system-op',
    saleId: 'discount-system-sale',
    lines: [{
      id: 'discount-system-line',
      productId: product.id,
      quantity: 1,
      discountAmountMinor: 100,
    }],
    allocations: [{
      id: 'discount-system-payment',
      method: 'cash',
      amountMinor: 900,
      ordinal: 0,
    }],
  }, systemContext),
  /Retail Sale discount requires an authorized user\./,
)

const database = new DatabaseSync(filename)

try {
  const saleCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sales WHERE id = ?',
  ).get('discount-system-sale') as { count: number }

  const itemCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id = ?',
  ).get('discount-system-sale') as { count: number }

  const discountCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_sale_item_discounts
    WHERE sale_item_id = ?
  `).get('discount-system-line') as { count: number }

  const receiptCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_operation_receipts
    WHERE operation_kind = 'retail_sale_complete'
      AND client_operation_id = ?
  `).get('discount-system-op') as { count: number }

  const stockAfter = database.prepare(`
    SELECT COALESCE(SUM(quantity_delta), 0) AS stock
    FROM retail_inventory_movements
    WHERE product_id = ? AND location_id = ?
  `).get(product.id, location.id) as { stock: number }

  equal(saleCount.count, 0)
  equal(itemCount.count, 0)
  equal(discountCount.count, 0)
  equal(receiptCount.count, 0)
  equal(stockAfter.stock, stockBefore)
} finally {
  database.close()
}
} finally {
sales.close()
inventory.close()
catalog.close()
access.close()
rmSync(directory, { recursive: true, force: true })
}
})
test('discounted Sale replays exactly and rejects changed discount with the same client operation id', async () => {
const directory = mkdtempSync(join(tmpdir(), 'sale-discount-idempotency-'))
const filename = join(directory, 'x.sqlite')

initializeDatabase(filename)

const auth = new SqliteAuthRepository(filename)
const access = new SqliteRetailAccessRepository(filename)
const catalog = new SqliteRetailCatalogRepository(filename)
const inventory = new SqliteRetailInventoryRepository(filename)
const sales = new SqliteRetailSaleRepository(filename)

const now = new Date('2026-09-16T00:00:00.000Z')

const manager: User = {
id: 'discount-idempotency-manager',
username: 'discount-idempotency-manager',
normalizedUsername: 'discount-idempotency-manager',
role: 'manager',
status: 'active',
sessionVersion: 1,
createdAt: now,
updatedAt: now,
}

const managerContext = {
actorType: 'user' as const,
actorUserId: manager.id,
requestId: 'discount-idempotency-test',
}

try {
await auth.createUser(manager)

const location = await access.createLocation({
  code: 'DI',
  name: 'Discount Idempotency Store',
  type: 'store',
  status: 'active',
}, managerContext)

await access.configureCurrency(location.id, 'USD', 2, managerContext)

const product = await catalog.createProduct({
  sourceId: 'DISCOUNT-IDEMPOTENCY-PRODUCT',
  name: 'Discount Idempotency Product',
}, managerContext)

await catalog.setPrice(product.id, location.id, 5000, managerContext)

await inventory.recordMovement({
  productId: product.id,
  locationId: location.id,
  quantityDelta: 5,
  type: 'opening',
  sourceType: 'test',
  sourceId: 'discount-idempotency-seed',
  sourceLineId: '1',
}, managerContext)

const input = {
  clientOperationId: 'discount-idempotency-op',
  saleId: 'discount-idempotency-sale',
  lines: [{
    id: 'discount-idempotency-line',
    productId: product.id,
    quantity: 1,
    discountAmountMinor: 500,
  }],
  allocations: [{
    id: 'discount-idempotency-payment',
    method: 'cash' as const,
    amountMinor: 4500,
    ordinal: 0,
  }],
}

const first = await sales.complete(location.id, input, managerContext)
equal(first.replayed, false)

const replay = await sales.complete(location.id, input, managerContext)
equal(replay.replayed, true)

await rejects(
  sales.complete(location.id, {
    ...input,
    lines: [{
      ...input.lines[0],
      discountAmountMinor: 600,
    }],
    allocations: [{
      ...input.allocations[0],
      amountMinor: 4400,
    }],
  }, managerContext),
  /IDEMPOTENCY_CONFLICT/,
)

const database = new DatabaseSync(filename)

try {
  const saleCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sales WHERE id = ?',
  ).get(input.saleId) as { count: number }

  const itemCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id = ?',
  ).get(input.saleId) as { count: number }

  const discount = database.prepare(`
    SELECT COUNT(*) AS count, MAX(amount_minor) AS amount_minor
    FROM retail_sale_item_discounts
    WHERE sale_item_id = ?
  `).get(input.lines[0].id) as {
    count: number
    amount_minor: number | null
  }

  const allocationCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_payment_allocations WHERE sale_id = ?',
  ).get(input.saleId) as { count: number }

  const receiptCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_operation_receipts
    WHERE operation_kind = 'retail_sale_complete'
      AND client_operation_id = ?
  `).get(input.clientOperationId) as { count: number }

  const saleMovementCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_inventory_movements
    WHERE source_type = 'retail_sale'
      AND source_id = ?
  `).get(input.saleId) as { count: number }

  const auditCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM audit_events
    WHERE entity_type = 'retail_sale'
      AND entity_id = ?
      AND action = 'retail.sale_completed'
  `).get(input.saleId) as { count: number }

  equal(saleCount.count, 1)
  equal(itemCount.count, 1)
  equal(discount.count, 1)
  equal(discount.amount_minor, 500)
  equal(allocationCount.count, 1)
  equal(receiptCount.count, 1)
  equal(saleMovementCount.count, 1)
  equal(auditCount.count, 1)
} finally {
  database.close()
}
} finally {
sales.close()
inventory.close()
catalog.close()
access.close()
auth.close()
rmSync(directory, { recursive: true, force: true })
}
})

test('discount persistence failure rolls back the entire completed Sale transaction', async () => {
const directory = mkdtempSync(join(tmpdir(), 'sale-discount-rollback-'))
const filename = join(directory, 'x.sqlite')

initializeDatabase(filename)

const auth = new SqliteAuthRepository(filename)
const access = new SqliteRetailAccessRepository(filename)
const catalog = new SqliteRetailCatalogRepository(filename)
const inventory = new SqliteRetailInventoryRepository(filename)
const sales = new SqliteRetailSaleRepository(filename)

const now = new Date('2026-09-16T00:00:00.000Z')

const manager: User = {
id: 'discount-rollback-manager',
username: 'discount-rollback-manager',
normalizedUsername: 'discount-rollback-manager',
role: 'manager',
status: 'active',
sessionVersion: 1,
createdAt: now,
updatedAt: now,
}

const managerContext = {
actorType: 'user' as const,
actorUserId: manager.id,
requestId: 'discount-rollback-test',
}

try {
await auth.createUser(manager)

const location = await access.createLocation({
  code: 'DR',
  name: 'Discount Rollback Store',
  type: 'store',
  status: 'active',
}, managerContext)

await access.configureCurrency(location.id, 'USD', 2, managerContext)

const product = await catalog.createProduct({
  sourceId: 'DISCOUNT-ROLLBACK-PRODUCT',
  name: 'Discount Rollback Product',
}, managerContext)

await catalog.setPrice(product.id, location.id, 5000, managerContext)

await inventory.recordMovement({
  productId: product.id,
  locationId: location.id,
  quantityDelta: 5,
  type: 'opening',
  sourceType: 'test',
  sourceId: 'discount-rollback-seed',
  sourceLineId: '1',
}, managerContext)

const databaseBefore = new DatabaseSync(filename)

let stockBefore: number

try {
  const stock = databaseBefore.prepare(`
    SELECT COALESCE(SUM(quantity_delta), 0) AS stock
    FROM retail_inventory_movements
    WHERE product_id = ? AND location_id = ?
  `).get(product.id, location.id) as { stock: number }

  stockBefore = stock.stock

  databaseBefore.exec(`
    CREATE TRIGGER force_discount_insert_failure
    BEFORE INSERT ON retail_sale_item_discounts
    BEGIN
      SELECT RAISE(ABORT, 'forced discount failure');
    END;
  `)
} finally {
  databaseBefore.close()
}

await rejects(
  sales.complete(location.id, {
    clientOperationId: 'discount-rollback-op',
    saleId: 'discount-rollback-sale',
    lines: [{
      id: 'discount-rollback-line',
      productId: product.id,
      quantity: 1,
      discountAmountMinor: 500,
    }],
    allocations: [{
      id: 'discount-rollback-payment',
      method: 'cash',
      amountMinor: 4500,
      ordinal: 0,
    }],
  }, managerContext),
  /forced discount failure/,
)

const database = new DatabaseSync(filename)

try {
  const saleCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sales WHERE id = ?',
  ).get('discount-rollback-sale') as { count: number }

  const itemCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sale_items WHERE sale_id = ?',
  ).get('discount-rollback-sale') as { count: number }

  const discountCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_sale_item_discounts WHERE sale_item_id = ?',
  ).get('discount-rollback-line') as { count: number }

  const allocationCount = database.prepare(
    'SELECT COUNT(*) AS count FROM retail_payment_allocations WHERE sale_id = ?',
  ).get('discount-rollback-sale') as { count: number }

  const receiptCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_operation_receipts
    WHERE operation_kind = 'retail_sale_complete'
      AND client_operation_id = ?
  `).get('discount-rollback-op') as { count: number }

  const saleMovementCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM retail_inventory_movements
    WHERE source_type = 'retail_sale'
      AND source_id = ?
  `).get('discount-rollback-sale') as { count: number }

  const auditCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM audit_events
    WHERE entity_type = 'retail_sale'
      AND entity_id = ?
      AND action = 'retail.sale_completed'
  `).get('discount-rollback-sale') as { count: number }

  const stockAfter = database.prepare(`
    SELECT COALESCE(SUM(quantity_delta), 0) AS stock
    FROM retail_inventory_movements
    WHERE product_id = ? AND location_id = ?
  `).get(product.id, location.id) as { stock: number }

  equal(saleCount.count, 0)
  equal(itemCount.count, 0)
  equal(discountCount.count, 0)
  equal(allocationCount.count, 0)
  equal(receiptCount.count, 0)
  equal(saleMovementCount.count, 0)
  equal(auditCount.count, 0)
  equal(stockAfter.stock, stockBefore)
} finally {
  database.close()
}
} finally {
sales.close()
inventory.close()
catalog.close()
access.close()
auth.close()
rmSync(directory, { recursive: true, force: true })
}
})