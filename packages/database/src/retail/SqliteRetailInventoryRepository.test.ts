import { deepEqual, equal, rejects, throws } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'
import { SqliteRetailCatalogRepository } from './SqliteRetailCatalogRepository.js'
import { SqliteRetailInventoryRepository } from './SqliteRetailInventoryRepository.js'
import { SqliteRetailStoreOpeningRepository, StoreOpeningError, type InitializeStoreOpeningStockInput } from './SqliteRetailStoreOpeningRepository.js'

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

async function withOpening(run: (value: {
  filename: string
  access: SqliteRetailAccessRepository
  catalog: SqliteRetailCatalogRepository
  inventory: SqliteRetailInventoryRepository
  opening: SqliteRetailStoreOpeningRepository
  locationId: string
  otherLocationId: string
  productIds: [string, string]
  input: InitializeStoreOpeningStockInput
}) => Promise<void>): Promise<void> {
  await withRepositories(async ({ filename, access, catalog, inventory }) => {
    const database = new DatabaseSync(filename)
    database.prepare("INSERT INTO users(id,username,normalized_username,role,status,session_version,created_at,updated_at) VALUES('admin-1','Admin One','admin one','admin','active',1,'2026-01-01','2026-01-01')").run()
    database.prepare("INSERT INTO users(id,username,normalized_username,role,status,session_version,created_at,updated_at) VALUES('admin-2','Admin Two','admin two','admin','active',1,'2026-01-01','2026-01-01')").run()
    database.close()
    const { product, otherProduct, location, otherLocation } = await seed({ access, catalog })
    const opening = new SqliteRetailStoreOpeningRepository(filename)
    const input = { clientOperationId: 'opening-1', locationId: location.id, actorUserId: 'admin-1', worksheetReference: 'SABONO-OPEN-1', lines: [{ productId: product.id, quantity: 7 }, { productId: otherProduct.id, quantity: 3 }] }
    try { await run({ filename, access, catalog, inventory, opening, locationId: location.id, otherLocationId: otherLocation.id, productIds: [product.id, otherProduct.id], input }) }
    finally { opening.close() }
  })
}

function openingCounts(database: DatabaseSync, operationId = 'opening-1') {
  const count = (table: string, where: string, value: string) => (database.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}=?`).get(value) as { n: number }).n
  return {
    receipts: count('retail_store_opening_receipts', 'client_operation_id', operationId),
    movements: count('retail_inventory_movements', 'source_id', operationId),
    audits: count('audit_events', 'entity_id', operationId),
  }
}

async function openingRejected(opening: SqliteRetailStoreOpeningRepository, input: InitializeStoreOpeningStockInput, code: StoreOpeningError['code'], actor = context) {
  await rejects(opening.initializeStoreOpeningStock(input, actor), (error: unknown) => error instanceof StoreOpeningError && error.code === code)
}

test('Store opening initializes a whole positive worksheet with immutable receipt, ledger and audit; reordered replay is inert', async () => {
  await withOpening(async ({ filename, opening, inventory, input, productIds }) => {
    const first = await opening.initializeStoreOpeningStock(input, context)
    equal(first.replayed, false)
    deepEqual(first.lines.map(line => line.productId), [...productIds].sort())
    const database = new DatabaseSync(filename)
    try {
      deepEqual(openingCounts(database), { receipts: 1, movements: 2, audits: 1 })
      equal((database.prepare("SELECT count(*) AS n FROM audit_events WHERE action='retail.inventory_movement_recorded' AND metadata_json LIKE '%retail_store_opening%'").get() as { n: number }).n, 2)
      const audit = database.prepare("SELECT actor_user_id,occurred_at,metadata_json FROM audit_events WHERE action='retail.store_opening_initialized' AND entity_id=?").get(input.clientOperationId) as { actor_user_id: string; occurred_at: string; metadata_json: string }
      equal(audit.actor_user_id, input.actorUserId)
      equal(audit.occurred_at, first.initializedAt.toISOString())
      deepEqual(JSON.parse(audit.metadata_json), { locationId: input.locationId, worksheetReference: input.worksheetReference, lines: first.lines })
      for (const line of first.lines) {
        equal((await inventory.findBalance(line.productId, input.locationId))?.onHandQuantity, line.quantity)
        const movement = (await inventory.listMovements(line.productId, input.locationId))[0]!
        equal(movement.id, line.movementId)
        equal(movement.type, 'opening')
        equal(movement.sourceType, 'retail_store_opening')
        equal(movement.sourceId, input.clientOperationId)
        equal(movement.sourceLineId, line.productId)
      }
      await inventory.recordMovement({ productId: first.lines[0]!.productId, locationId: input.locationId, quantityDelta: -1, type: 'sale', sourceType: 'later-test-sale', sourceId: 'later-sale', sourceLineId: 'line' }, context)
      const beforeBalances = database.prepare('SELECT product_id,on_hand_quantity,updated_at FROM retail_inventory_balances WHERE location_id=? ORDER BY product_id').all(input.locationId)
      const replay = await opening.initializeStoreOpeningStock({ ...input, lines: [...input.lines].reverse() }, context)
      deepEqual({ ...replay, replayed: false }, first)
      deepEqual(openingCounts(database), { receipts: 1, movements: 2, audits: 1 })
      deepEqual(database.prepare('SELECT product_id,on_hand_quantity,updated_at FROM retail_inventory_balances WHERE location_id=? ORDER BY product_id').all(input.locationId), beforeBalances)
      throws(() => database.prepare('UPDATE retail_store_opening_receipts SET worksheet_reference=? WHERE client_operation_id=?').run('changed', input.clientOperationId), /immutable/)
      throws(() => database.prepare('DELETE FROM retail_store_opening_receipts WHERE client_operation_id=?').run(input.clientOperationId), /immutable/)
    } finally { database.close() }
  })
})

test('Store opening replay ignores another Location movement with the same source type and operation id', async () => {
  await withOpening(async ({ filename, opening, inventory, input, otherLocationId, productIds }) => {
    const [targetProductId, unrelatedProductId] = productIds
    const prior = await inventory.recordMovement({ productId: unrelatedProductId, locationId: otherLocationId, quantityDelta: 11, type: 'opening', sourceType: 'retail_store_opening', sourceId: input.clientOperationId, sourceLineId: unrelatedProductId }, context)
    const command = { ...input, lines: [{ productId: targetProductId, quantity: 7 }] }
    const first = await opening.initializeStoreOpeningStock(command, context)
    equal(first.replayed, false)
    equal(first.lines.length, 1)
    equal(first.lines[0]?.productId, targetProductId)
    equal(first.lines[0]?.quantity, 7)
    equal((await inventory.findBalance(targetProductId, input.locationId))?.onHandQuantity, 7)
    const database = new DatabaseSync(filename)
    try {
      const priorRow = database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id)
      const priorBalance = await inventory.findBalance(unrelatedProductId, otherLocationId)
      const targetBalance = await inventory.findBalance(targetProductId, input.locationId)
      const targetRows = database.prepare('SELECT * FROM retail_inventory_movements WHERE location_id=? AND source_type=? AND source_id=?').all(input.locationId, 'retail_store_opening', input.clientOperationId)
      equal(targetRows.length, 1)
      equal(targetRows[0]!.id, first.lines[0]?.movementId)
      const receipts = database.prepare('SELECT * FROM retail_store_opening_receipts WHERE location_id=?').all(input.locationId)
      equal(receipts.length, 1)
      const audits = database.prepare('SELECT * FROM audit_events ORDER BY id').all()

      const replay = await opening.initializeStoreOpeningStock(command, context)
      deepEqual({ ...replay, replayed: false }, first)
      equal(replay.replayed, true)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements WHERE location_id=? AND source_type=? AND source_id=?').all(input.locationId, 'retail_store_opening', input.clientOperationId), targetRows)
      deepEqual(await inventory.findBalance(targetProductId, input.locationId), targetBalance)
      deepEqual(database.prepare('SELECT * FROM retail_store_opening_receipts WHERE location_id=?').all(input.locationId), receipts)
      deepEqual(database.prepare('SELECT * FROM audit_events ORDER BY id').all(), audits)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id), priorRow)
      deepEqual(await inventory.findBalance(unrelatedProductId, otherLocationId), priorBalance)
    } finally { database.close() }
  })
})

test('Store opening replay ignores another source type sharing the operation id', async () => {
  await withOpening(async ({ filename, opening, inventory, input, otherLocationId, productIds }) => {
    const productId = productIds[0]
    const prior = await inventory.recordMovement({ productId, locationId: otherLocationId, quantityDelta: 5, type: 'opening', sourceType: 'unrelated_opening_source', sourceId: input.clientOperationId, sourceLineId: productId }, context)
    const command = { ...input, lines: [{ productId, quantity: 7 }] }
    const first = await opening.initializeStoreOpeningStock(command, context)
    const database = new DatabaseSync(filename)
    try {
      const movements = database.prepare('SELECT * FROM retail_inventory_movements ORDER BY id').all()
      const balances = database.prepare('SELECT * FROM retail_inventory_balances ORDER BY location_id,product_id').all()
      const receipts = database.prepare('SELECT * FROM retail_store_opening_receipts').all()
      const audits = database.prepare('SELECT * FROM audit_events ORDER BY id').all()
      equal(movements.length, 2)
      equal(movements.filter(row => row.id === prior.id).length, 1)

      const replay = await opening.initializeStoreOpeningStock(command, context)
      deepEqual({ ...replay, replayed: false }, first)
      equal(replay.replayed, true)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements ORDER BY id').all(), movements)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_balances ORDER BY location_id,product_id').all(), balances)
      deepEqual(database.prepare('SELECT * FROM retail_store_opening_receipts').all(), receipts)
      deepEqual(database.prepare('SELECT * FROM audit_events ORDER BY id').all(), audits)
    } finally { database.close() }
  })
})

test('Store opening replay rejects extra movement inside its own Location and source scope', async () => {
  await withOpening(async ({ filename, opening, inventory, input, productIds }) => {
    const [openingProductId, extraProductId] = productIds
    const command = { ...input, lines: [{ productId: openingProductId, quantity: 7 }] }
    await opening.initializeStoreOpeningStock(command, context)
    await inventory.recordMovement({ productId: extraProductId, locationId: input.locationId, quantityDelta: 2, type: 'opening', sourceType: 'retail_store_opening', sourceId: input.clientOperationId, sourceLineId: extraProductId }, context)
    const database = new DatabaseSync(filename)
    try {
      const movements = database.prepare('SELECT * FROM retail_inventory_movements ORDER BY id').all()
      const balances = database.prepare('SELECT * FROM retail_inventory_balances ORDER BY location_id,product_id').all()
      const receipts = database.prepare('SELECT * FROM retail_store_opening_receipts').all()
      const audits = database.prepare('SELECT * FROM audit_events ORDER BY id').all()
      equal(movements.length, 2)

      await openingRejected(opening, command, 'OPENING_EVIDENCE_INVALID')
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements ORDER BY id').all(), movements)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_balances ORDER BY location_id,product_id').all(), balances)
      deepEqual(database.prepare('SELECT * FROM retail_store_opening_receipts').all(), receipts)
      deepEqual(database.prepare('SELECT * FROM audit_events ORDER BY id').all(), audits)
    } finally { database.close() }
  })
})

test('Store opening exact operation identity rejects changed quantity, worksheet, product set and actor without mutation', async () => {
  await withOpening(async ({ filename, opening, input }) => {
    await opening.initializeStoreOpeningStock(input, context)
    await openingRejected(opening, { ...input, lines: [{ ...input.lines[0]!, quantity: 8 }, input.lines[1]!] }, 'IDEMPOTENCY_CONFLICT')
    await openingRejected(opening, { ...input, worksheetReference: 'DIFFERENT' }, 'IDEMPOTENCY_CONFLICT')
    await openingRejected(opening, { ...input, lines: [input.lines[0]!] }, 'IDEMPOTENCY_CONFLICT')
    await openingRejected(opening, { ...input, actorUserId: 'admin-2' }, 'IDEMPOTENCY_CONFLICT', { actorType: 'user', actorUserId: 'admin-2', requestId: 'other-admin' })
    await openingRejected(opening, { ...input, clientOperationId: 'opening-2' }, 'OPENING_ALREADY_INITIALIZED')
    const database = new DatabaseSync(filename)
    try { deepEqual(openingCounts(database), { receipts: 1, movements: 2, audits: 1 }) } finally { database.close() }
  })
})

test('Store opening rejects invalid worksheet lines and entity states without partial writes', async () => {
  await withOpening(async ({ filename, opening, input, access, catalog, productIds, otherLocationId }) => {
    for (const lines of [[], [input.lines[0]!, input.lines[0]!], [{ productId: productIds[0], quantity: 0 }], [{ productId: productIds[0], quantity: -1 }], [{ productId: productIds[0], quantity: 1.5 }], [{ productId: productIds[0], quantity: Number.MAX_SAFE_INTEGER + 1 }]]) {
      await openingRejected(opening, { ...input, lines }, 'INVALID_COMMAND')
    }
    await openingRejected(opening, { ...input, worksheetReference: '' }, 'INVALID_COMMAND')
    await openingRejected(opening, { ...input, lines: [{ productId: 'unknown', quantity: 1 }] }, 'PRODUCT_NOT_FOUND')
    await openingRejected(opening, { ...input, locationId: 'unknown' }, 'LOCATION_NOT_FOUND')
    const warehouse = await access.createLocation({ code: 'WH', name: 'Warehouse', type: 'central_warehouse', status: 'active' }, context)
    await openingRejected(opening, { ...input, locationId: warehouse.id }, 'LOCATION_NOT_STORE')
    const inactiveStore = await access.createLocation({ code: 'OFF', name: 'Inactive', type: 'store', status: 'inactive' }, context)
    await openingRejected(opening, { ...input, locationId: inactiveStore.id }, 'LOCATION_INACTIVE')
    await catalog.updateProduct(productIds[1], { name: 'Product 2', status: 'inactive' }, context)
    await openingRejected(opening, input, 'PRODUCT_INACTIVE')
    const database = new DatabaseSync(filename)
    try {
      deepEqual(openingCounts(database), { receipts: 0, movements: 0, audits: 0 })
      equal((database.prepare('SELECT count(*) AS n FROM retail_inventory_balances WHERE location_id=?').get(input.locationId) as { n: number }).n, 0)
      equal((database.prepare('SELECT count(*) AS n FROM retail_inventory_balances WHERE location_id=?').get(otherLocationId) as { n: number }).n, 0)
    } finally { database.close() }
  })
})

test('Store opening rejects location-wide balance, movement, Sale, reconciliation, transfer and Authority history', async () => {
  for (const history of ['balance', 'movement', 'sale', 'reconciliation', 'transfer-source', 'transfer-destination', 'authority'] as const) {
    await withOpening(async ({ filename, opening, input, productIds, otherLocationId }) => {
      const database = new DatabaseSync(filename)
      try {
        if (history === 'balance') database.prepare('INSERT INTO retail_inventory_balances(product_id,location_id,on_hand_quantity,updated_at) VALUES(?,?,0,?)').run(productIds[0], input.locationId, '2026-01-01')
        if (history === 'movement') database.prepare("INSERT INTO retail_inventory_movements(id,product_id,location_id,quantity_delta,movement_type,source_type,source_id,source_line_id,created_at) VALUES('prior',?,?,1,'opening','prior','prior','prior','2026-01-01')").run(productIds[0], input.locationId)
        if (history === 'sale') database.prepare("INSERT INTO retail_sales(id,location_id,status,currency_code,currency_exponent,subtotal_minor,payable_total_minor,created_at,completed_at) VALUES('prior-sale',?,'completed','USD',2,1,1,'2026-01-01','2026-01-01')").run(input.locationId)
        if (history === 'reconciliation') database.prepare("INSERT INTO retail_inventory_reconciliations(id,location_id,purpose,status,created_at,created_by) VALUES('prior-rec',?,'opening','open','2026-01-01','admin-1')").run(input.locationId)
        if (history === 'transfer-source' || history === 'transfer-destination') database.prepare("INSERT INTO retail_transfers(id,source_location_id,destination_location_id,status,created_at,created_by) VALUES('prior-transfer',?,?,'draft','2026-01-01','admin-1')").run(history === 'transfer-source' ? input.locationId : otherLocationId, history === 'transfer-source' ? otherLocationId : input.locationId)
        if (history === 'authority') {
          database.prepare("INSERT INTO retail_offline_terminals(id,location_id,current_key_version,enrolled_by_user_id,enrolled_at,updated_at) VALUES('terminal',?,1,'admin-1','2026-01-01','2026-01-01')").run(input.locationId)
          database.prepare("INSERT INTO retail_offline_terminal_keys(terminal_id,key_version,key_algorithm,public_key,created_at,created_by_user_id) VALUES('terminal',1,'Ed25519','test','2026-01-01','admin-1')").run()
          database.prepare("INSERT INTO retail_offline_authorities(id,authority_version,terminal_id,terminal_key_version,user_id,location_id,issued_at,expires_at,currency_code,currency_exponent,payment_method,discounts_allowed,permit_count,issued_by_user_id) VALUES('authority',1,'terminal',1,'admin-1',?,'2026-01-01','2027-01-01','USD',2,'cash',0,1,'admin-1')").run(input.locationId)
        }
        await openingRejected(opening, input, 'OPENING_HISTORY_NOT_PRISTINE')
        deepEqual(openingCounts(database), { receipts: 0, movements: 0, audits: 0 })
      } finally { database.close() }
    })
  }
})

test('Store opening rolls back every line, balance, receipt and audit when command audit fails', async () => {
  await withOpening(async ({ filename, opening, input }) => {
    const database = new DatabaseSync(filename)
    try {
      database.exec("CREATE TRIGGER fail_opening_audit BEFORE INSERT ON audit_events WHEN NEW.action='retail.store_opening_initialized' BEGIN SELECT RAISE(ABORT,'forced opening audit failure'); END")
      await rejects(opening.initializeStoreOpeningStock(input, context), /forced opening audit failure/)
      deepEqual(openingCounts(database), { receipts: 0, movements: 0, audits: 0 })
      equal((database.prepare('SELECT count(*) AS n FROM retail_inventory_balances WHERE location_id=?').get(input.locationId) as { n: number }).n, 0)
      equal((database.prepare("SELECT count(*) AS n FROM audit_events WHERE action='retail.inventory_movement_recorded' AND metadata_json LIKE '%retail_store_opening%'").get() as { n: number }).n, 0)
    } finally { database.close() }
  })
})

test('Store opening rejects a source-key movement belonging to another Store without opening effects', async () => {
  await withOpening(async ({ filename, opening, inventory, input, otherLocationId, productIds }) => {
    const productId = productIds[0]
    const prior = await inventory.recordMovement({ productId, locationId: otherLocationId, quantityDelta: 11, type: 'opening', sourceType: 'retail_store_opening', sourceId: input.clientOperationId, sourceLineId: productId }, context)
    const database = new DatabaseSync(filename)
    try {
      const priorRow = database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id)
      const priorBalance = await inventory.findBalance(productId, otherLocationId)
      const beforeAuditCount = (database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n
      await openingRejected(opening, { ...input, lines: [{ productId, quantity: 7 }] }, 'OPENING_EVIDENCE_INVALID')

      equal(database.prepare('SELECT 1 FROM retail_store_opening_receipts WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare('SELECT 1 FROM retail_inventory_balances WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare('SELECT 1 FROM retail_inventory_movements WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare("SELECT 1 FROM audit_events WHERE action='retail.store_opening_initialized' AND entity_id=?").get(input.clientOperationId), undefined)
      equal((database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n, beforeAuditCount)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id), priorRow)
      deepEqual(await inventory.findBalance(productId, otherLocationId), priorBalance)
    } finally { database.close() }
  })
})

test('Store opening rolls back an earlier line when a later source key collides elsewhere', async () => {
  await withOpening(async ({ filename, opening, inventory, input, otherLocationId, productIds }) => {
    const [firstProductId, collidingProductId] = [...productIds].sort()
    const prior = await inventory.recordMovement({ productId: collidingProductId, locationId: otherLocationId, quantityDelta: 17, type: 'opening', sourceType: 'retail_store_opening', sourceId: input.clientOperationId, sourceLineId: collidingProductId }, context)
    const database = new DatabaseSync(filename)
    try {
      const priorRow = database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id)
      const priorBalance = await inventory.findBalance(collidingProductId, otherLocationId)
      const beforeAuditCount = (database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n
      await openingRejected(opening, { ...input, lines: [{ productId: collidingProductId, quantity: 3 }, { productId: firstProductId, quantity: 7 }] }, 'OPENING_EVIDENCE_INVALID')

      equal(database.prepare('SELECT 1 FROM retail_store_opening_receipts WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare('SELECT 1 FROM retail_inventory_balances WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare('SELECT 1 FROM retail_inventory_movements WHERE location_id=?').get(input.locationId), undefined)
      equal(database.prepare("SELECT 1 FROM audit_events WHERE action='retail.store_opening_initialized' AND entity_id=?").get(input.clientOperationId), undefined)
      equal((database.prepare('SELECT count(*) AS n FROM audit_events').get() as { n: number }).n, beforeAuditCount)
      deepEqual(database.prepare('SELECT * FROM retail_inventory_movements WHERE id=?').get(prior.id), priorRow)
      deepEqual(await inventory.findBalance(collidingProductId, otherLocationId), priorBalance)
    } finally { database.close() }
  })
})

test('Competing Store opening commands cannot create mixed or partial stock', async () => {
  await withOpening(async ({ filename, opening, input }) => {
    const second = new SqliteRetailStoreOpeningRepository(filename)
    try {
      const outcomes = await Promise.allSettled([
        opening.initializeStoreOpeningStock(input, context),
        second.initializeStoreOpeningStock({ ...input, clientOperationId: 'opening-2', lines: [{ ...input.lines[0]!, quantity: 20 }] }, context),
      ])
      equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
      const database = new DatabaseSync(filename)
      try {
        equal((database.prepare('SELECT count(*) AS n FROM retail_store_opening_receipts').get() as { n: number }).n, 1)
        const rows = database.prepare("SELECT product_id,quantity_delta FROM retail_inventory_movements WHERE source_type='retail_store_opening' ORDER BY product_id").all() as Array<{ product_id: string; quantity_delta: number }>
        equal(rows.length, outcomes[0]?.status === 'fulfilled' ? 2 : 1)
      } finally { database.close() }
    } finally { second.close() }
  })
})
