import { deepEqual, equal, notEqual, ok } from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { hashSessionSecret } from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteRetailAccessRepository,
  SqliteRetailCatalogRepository,
} from '@madina/database'
import { hasRetailCapability } from '@madina/retail'
import { buildApp } from '../../../../app.js'

type OpeningResponse = {
  clientOperationId: string
  locationId: string
  worksheetReference: string
  actorUserId: string
  initializedAt: string
  lines: { productId: string; quantity: number; movementId: string }[]
}

function openingSnapshot(database: DatabaseSync, locationId: string) {
  return {
    receipts: database.prepare('SELECT * FROM retail_store_opening_receipts WHERE location_id=? ORDER BY client_operation_id').all(locationId),
    movements: database.prepare('SELECT id,product_id,location_id,quantity_delta,movement_type,source_type,source_id,source_line_id FROM retail_inventory_movements WHERE location_id=? ORDER BY product_id,id').all(locationId),
    balances: database.prepare('SELECT product_id,location_id,on_hand_quantity,updated_at FROM retail_inventory_balances WHERE location_id=? ORDER BY product_id').all(locationId),
    movementAudits: database.prepare("SELECT id,entity_id,actor_user_id,metadata_json FROM audit_events WHERE action='retail.inventory_movement_recorded' AND json_extract(metadata_json,'$.locationId')=? ORDER BY id").all(locationId),
    commandAudits: database.prepare("SELECT id,entity_id,actor_user_id,metadata_json FROM audit_events WHERE action='retail.store_opening_initialized' AND json_extract(metadata_json,'$.locationId')=? ORDER BY id").all(locationId),
    sales: (database.prepare('SELECT count(*) AS n FROM retail_sales WHERE location_id=?').get(locationId) as { n: number }).n,
    transfers: (database.prepare('SELECT count(*) AS n FROM retail_transfers WHERE source_location_id=? OR destination_location_id=?').get(locationId, locationId) as { n: number }).n,
    goodsReceipts: (database.prepare('SELECT count(*) AS n FROM retail_goods_receipts WHERE location_id=?').get(locationId) as { n: number }).n,
    authorities: (database.prepare('SELECT count(*) AS n FROM retail_offline_authorities WHERE location_id=?').get(locationId) as { n: number }).n,
  }
}

test('production HTTP Store opening: first execution, exact replay, and post-opening protection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-store-opening-acceptance-'))
  const file = join(directory, 'acceptance.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  const previousNodeEnv = process.env.NODE_ENV
  process.env.DATABASE_FILE = file
  process.env.NODE_ENV = 'test'
  let database: DatabaseSync | undefined
  let access: SqliteRetailAccessRepository | undefined
  let catalog: SqliteRetailCatalogRepository | undefined
  let app: ReturnType<typeof buildApp> | undefined

  try {
    initializeDatabase(file)
    const adminId = 'opening-acceptance-admin'
    const managerId = 'opening-acceptance-manager'
    const adminSecret = 'opening-acceptance-admin-session'
    const managerSecret = 'opening-acceptance-manager-session'
    const auth = new SqliteAuthRepository(file)
    try {
      const now = new Date()
      for (const [id, role, secret] of [
        [adminId, 'admin', adminSecret],
        [managerId, 'manager', managerSecret],
      ] as const) {
        await auth.createUser({ id, username: id, normalizedUsername: id, role, status: 'active', sessionVersion: 1, createdAt: now, updatedAt: now })
        await auth.createSession({ id: `${id}-session`, userId: id, tokenHash: hashSessionSecret(secret), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000), sessionVersion: 1 })
      }
    } finally {
      auth.close()
    }

    access = new SqliteRetailAccessRepository(file)
    catalog = new SqliteRetailCatalogRepository(file)
    database = new DatabaseSync(file)
    const context = { actorType: 'user' as const, actorUserId: adminId, requestId: 'opening-acceptance-fixture' }
    const store = await access.createLocation({ code: 'OPENING-ACCEPTANCE', name: 'Opening acceptance Store', type: 'store', status: 'active' }, context)
    const p1 = await catalog.createProduct({ sourceId: 'OPENING-ACCEPTANCE-P1', name: 'Opening acceptance P1' }, context)
    const p2 = await catalog.createProduct({ sourceId: 'OPENING-ACCEPTANCE-P2', name: 'Opening acceptance P2' }, context)
    equal(p1.status, 'active')
    equal(p2.status, 'active')
    equal(await access.hasActiveGrant(adminId, store.id), false)
    equal(hasRetailCapability('admin', 'retail:inventory:opening:manage'), true)
    equal(hasRetailCapability('manager', 'retail:inventory:opening:manage'), false)
    const pristine = openingSnapshot(database, store.id)
    deepEqual(pristine.receipts, [])
    deepEqual(pristine.movements, [])
    deepEqual(pristine.balances, [])
    equal(pristine.authorities, 0)

    app = buildApp()
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const url = `${origin}/api/v1/retail/locations/${store.id}/inventory/opening`
    const request = { clientOperationId: 'opening-acceptance-X', worksheetReference: 'WORKSHEET-X', lines: [{ productId: p1.id, quantity: 12 }, { productId: p2.id, quantity: 7 }] }
    const post = (payload: unknown, secret?: string, requestOrigin = origin) => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin, ...(secret ? { cookie: `madina-session=${secret}` } : {}) },
      body: JSON.stringify(payload),
    })

    equal((await post(request)).status, 401)
    equal((await post(request, adminSecret)).status, 403)
    await access.grant(managerId, store.id, context)
    equal((await post(request, managerSecret)).status, 403)
    await access.grant(adminId, store.id, context)
    equal(await access.hasActiveGrant(adminId, store.id), true)
    equal((await post(request, adminSecret, 'https://untrusted.example')).status, 403)
    deepEqual(openingSnapshot(database, store.id), pristine)

    const first = await post(request, adminSecret)
    equal(first.status, 201)
    const r1 = await first.json() as OpeningResponse
    deepEqual(Object.keys(r1).sort(), ['actorUserId', 'clientOperationId', 'initializedAt', 'lines', 'locationId', 'worksheetReference'])
    equal(r1.clientOperationId, request.clientOperationId)
    equal(r1.locationId, store.id)
    equal(r1.worksheetReference, request.worksheetReference)
    equal(r1.actorUserId, adminId)
    ok(!Number.isNaN(Date.parse(r1.initializedAt)))
    equal(r1.lines.length, 2)
    const afterFirst = openingSnapshot(database, store.id)
    equal(afterFirst.receipts.length, 1)
    const receipt = afterFirst.receipts[0] as { client_operation_id: string; location_id: string; actor_user_id: string; worksheet_reference: string; initialized_at: string }
    equal(receipt.client_operation_id, request.clientOperationId)
    equal(receipt.location_id, store.id)
    equal(receipt.actor_user_id, adminId)
    equal(receipt.worksheet_reference, request.worksheetReference)
    equal(receipt.initialized_at, r1.initializedAt)
    equal(afterFirst.movements.length, 2)
    equal(afterFirst.balances.length, 2)
    equal(afterFirst.movementAudits.length, 2)
    equal(afterFirst.commandAudits.length, 1)
    for (const { productId, quantity } of request.lines) {
      const line = r1.lines.find(value => value.productId === productId)
      ok(line)
      equal(line.quantity, quantity)
      const movement = afterFirst.movements.find(row => row.product_id === productId) as { id: string; product_id: string; location_id: string; quantity_delta: number; movement_type: string; source_type: string; source_id: string; source_line_id: string } | undefined
      ok(movement)
      equal(line.movementId, movement.id)
      equal(movement.location_id, store.id)
      equal(movement.quantity_delta, quantity)
      equal(movement.movement_type, 'opening')
      equal(movement.source_type, 'retail_store_opening')
      equal(movement.source_id, request.clientOperationId)
      equal(movement.source_line_id, productId)
      const balance = afterFirst.balances.find(row => row.product_id === productId) as { location_id: string; on_hand_quantity: number } | undefined
      ok(balance)
      equal(balance.location_id, store.id)
      equal(balance.on_hand_quantity, quantity)
      const audit = afterFirst.movementAudits.find(row => row.entity_id === movement.id) as { actor_user_id: string } | undefined
      ok(audit)
      equal(audit.actor_user_id, adminId)
    }
    equal((afterFirst.commandAudits[0] as { entity_id: string; actor_user_id: string }).entity_id, request.clientOperationId)
    equal((afterFirst.commandAudits[0] as { actor_user_id: string }).actor_user_id, adminId)
    deepEqual([afterFirst.sales, afterFirst.transfers, afterFirst.goodsReceipts, afterFirst.authorities], [0, 0, 0, 0])

    const replay = await post(request, adminSecret)
    equal(replay.status, 200)
    const r2 = await replay.json() as OpeningResponse
    deepEqual(r2, r1)
    deepEqual(openingSnapshot(database, store.id), afterFirst)

    const second = await post({ ...request, clientOperationId: 'opening-acceptance-Y', worksheetReference: 'WORKSHEET-Y' }, adminSecret)
    equal(second.status, 409)
    equal((await second.json() as { message: string }).message, 'OPENING_ALREADY_INITIALIZED')
    deepEqual(openingSnapshot(database, store.id), afterFirst)

    const changed = await post({ ...request, lines: [{ productId: p1.id, quantity: 13 }, request.lines[1]!] }, adminSecret)
    equal(changed.status, 409)
    equal((await changed.json() as { message: string }).message, 'IDEMPOTENCY_CONFLICT')
    deepEqual(openingSnapshot(database, store.id), afterFirst)
    notEqual(r1.lines[0]?.movementId, r1.lines[1]?.movementId)
  } finally {
    await app?.close()
    database?.close()
    catalog?.close()
    access?.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('madina-store-opening-acceptance-')) throw new Error('Unsafe Store opening acceptance cleanup target.')
    rmSync(target, { recursive: true, force: true })
  }
})
