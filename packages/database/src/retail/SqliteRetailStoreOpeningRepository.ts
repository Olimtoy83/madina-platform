import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { recordRetailInventoryMovement } from './SqliteRetailInventoryRepository.js'

export type StoreOpeningErrorCode =
  | 'INVALID_COMMAND'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_INACTIVE'
  | 'LOCATION_NOT_STORE'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'OPENING_ALREADY_INITIALIZED'
  | 'OPENING_HISTORY_NOT_PRISTINE'
  | 'OPENING_EVIDENCE_INVALID'

export class StoreOpeningError extends Error {
  constructor(readonly code: StoreOpeningErrorCode) {
    super(code)
    this.name = 'StoreOpeningError'
  }
}

export interface InitializeStoreOpeningStockInput {
  clientOperationId: string
  locationId: string
  actorUserId: string
  worksheetReference: string
  lines: readonly { productId: string; quantity: number }[]
}

export interface StoreOpeningResult {
  clientOperationId: string
  locationId: string
  actorUserId: string
  worksheetReference: string
  initializedAt: Date
  lines: { productId: string; quantity: number; movementId: string }[]
  replayed: boolean
}

type ReceiptRow = {
  client_operation_id: string
  location_id: string
  actor_user_id: string
  worksheet_reference: string
  payload_hash: string
  initialized_at: string
}
type MovementRow = {
  id: string
  product_id: string
  location_id: string
  quantity_delta: number
  movement_type: string
  source_line_id: string
}

const sourceType = 'retail_store_opening'

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new StoreOpeningError('INVALID_COMMAND')
  return value
}

function normalized(input: InitializeStoreOpeningStockInput, context: CommandContext) {
  const clientOperationId = required(input?.clientOperationId)
  const locationId = required(input.locationId)
  const actorUserId = required(input.actorUserId)
  const worksheetReference = required(input.worksheetReference)
  if (context.actorType !== 'user' || context.actorUserId !== actorUserId || !Array.isArray(input.lines) || input.lines.length === 0) throw new StoreOpeningError('INVALID_COMMAND')
  const lines = input.lines.map(line => {
    if (!line || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new StoreOpeningError('INVALID_COMMAND')
    return { productId: required(line.productId), quantity: line.quantity }
  }).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)
  if (new Set(lines.map(line => line.productId)).size !== lines.length) throw new StoreOpeningError('INVALID_COMMAND')
  const payloadHash = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1, commandType: sourceType, locationId, actorUserId, worksheetReference, lines,
  })).digest('hex')
  return { clientOperationId, locationId, actorUserId, worksheetReference, lines, payloadHash }
}

export class SqliteRetailStoreOpeningRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async initializeStoreOpeningStock(input: InitializeStoreOpeningStockInput, context: CommandContext): Promise<StoreOpeningResult> {
    const command = normalized(input, context)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const receipt = this.database.prepare('SELECT client_operation_id,location_id,actor_user_id,worksheet_reference,payload_hash,initialized_at FROM retail_store_opening_receipts WHERE client_operation_id=?').get(command.clientOperationId) as ReceiptRow | undefined
      if (receipt) {
        if (receipt.payload_hash !== command.payloadHash || receipt.location_id !== command.locationId || receipt.actor_user_id !== command.actorUserId || receipt.worksheet_reference !== command.worksheetReference) throw new StoreOpeningError('IDEMPOTENCY_CONFLICT')
        const result = this.result(receipt, command.lines, true)
        this.database.exec('COMMIT')
        return result
      }

      const prior = this.database.prepare('SELECT 1 FROM retail_store_opening_receipts WHERE location_id=?').get(command.locationId)
      if (prior) throw new StoreOpeningError('OPENING_ALREADY_INITIALIZED')
      if (!this.pristine(command.locationId)) throw new StoreOpeningError('OPENING_HISTORY_NOT_PRISTINE')

      const location = this.database.prepare('SELECT type,status FROM retail_locations WHERE id=?').get(command.locationId) as { type: string; status: string } | undefined
      if (!location) throw new StoreOpeningError('LOCATION_NOT_FOUND')
      if (location.status !== 'active') throw new StoreOpeningError('LOCATION_INACTIVE')
      if (location.type !== 'store') throw new StoreOpeningError('LOCATION_NOT_STORE')
      const actor = this.database.prepare('SELECT status FROM users WHERE id=?').get(command.actorUserId) as { status: string } | undefined
      if (!actor || actor.status !== 'active') throw new StoreOpeningError('INVALID_COMMAND')
      for (const line of command.lines) {
        const product = this.database.prepare('SELECT status,base_unit FROM retail_products WHERE id=?').get(line.productId) as { status: string; base_unit: string } | undefined
        if (!product) throw new StoreOpeningError('PRODUCT_NOT_FOUND')
        if (product.status !== 'active' || product.base_unit !== 'piece') throw new StoreOpeningError('PRODUCT_INACTIVE')
      }

      const lines = command.lines.map(line => {
        const movement = recordRetailInventoryMovement(this.database, {
          productId: line.productId, locationId: command.locationId, quantityDelta: line.quantity,
          type: 'opening', sourceType, sourceId: command.clientOperationId, sourceLineId: line.productId,
        }, context)
        if (movement.type !== 'opening' || movement.locationId !== command.locationId ||
          movement.productId !== line.productId || movement.quantityDelta !== line.quantity ||
          movement.sourceType !== sourceType || movement.sourceId !== command.clientOperationId ||
          movement.sourceLineId !== line.productId) throw new StoreOpeningError('OPENING_EVIDENCE_INVALID')
        return { ...line, movementId: movement.id }
      })
      const initializedAt = new Date()
      this.database.prepare('INSERT INTO retail_store_opening_receipts(client_operation_id,location_id,actor_user_id,worksheet_reference,payload_hash,initialized_at) VALUES(?,?,?,?,?,?)')
        .run(command.clientOperationId, command.locationId, command.actorUserId, command.worksheetReference, command.payloadHash, initializedAt.toISOString())
      appendAuditEvent(this.database, {
        id: randomUUID(), occurredAt: initializedAt, actorType: 'user', actorUserId: command.actorUserId,
        requestId: context.requestId, domain: 'retail', entityType: 'retail_store_opening', entityId: command.clientOperationId,
        action: 'retail.store_opening_initialized',
        metadata: { locationId: command.locationId, worksheetReference: command.worksheetReference, lines },
      })
      this.database.exec('COMMIT')
      return { clientOperationId: command.clientOperationId, locationId: command.locationId, actorUserId: command.actorUserId, worksheetReference: command.worksheetReference, initializedAt, lines, replayed: false }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private result(receipt: ReceiptRow, expected: readonly { productId: string; quantity: number }[], replayed: boolean): StoreOpeningResult {
    const rows = this.database.prepare("SELECT id,product_id,location_id,quantity_delta,movement_type,source_line_id FROM retail_inventory_movements WHERE source_type='retail_store_opening' AND source_id=? AND location_id=? ORDER BY product_id")
      .all(receipt.client_operation_id, receipt.location_id) as unknown as MovementRow[]
    if (rows.length !== expected.length || rows.some((row, index) => row.location_id !== receipt.location_id || row.product_id !== expected[index]?.productId || row.source_line_id !== row.product_id || row.movement_type !== 'opening' || row.quantity_delta !== expected[index]?.quantity)) throw new StoreOpeningError('OPENING_EVIDENCE_INVALID')
    return {
      clientOperationId: receipt.client_operation_id, locationId: receipt.location_id, actorUserId: receipt.actor_user_id,
      worksheetReference: receipt.worksheet_reference, initializedAt: new Date(receipt.initialized_at),
      lines: rows.map(row => ({ productId: row.product_id, quantity: row.quantity_delta, movementId: row.id })), replayed,
    }
  }

  private pristine(locationId: string): boolean {
    const queries = [
      'SELECT 1 FROM retail_inventory_movements WHERE location_id=?',
      'SELECT 1 FROM retail_inventory_balances WHERE location_id=?',
      'SELECT 1 FROM retail_sales WHERE location_id=?',
      'SELECT 1 FROM retail_sale_returns WHERE location_id=?',
      'SELECT 1 FROM retail_inventory_reconciliations WHERE location_id=?',
      'SELECT 1 FROM retail_transfers WHERE source_location_id=? OR destination_location_id=?',
      'SELECT 1 FROM retail_goods_receipts WHERE location_id=?',
      'SELECT 1 FROM retail_offline_sale_evidence WHERE location_id=?',
      'SELECT 1 FROM retail_offline_stock_conflict_verifications WHERE location_id=?',
      'SELECT 1 FROM retail_offline_stock_conflict_incidents WHERE location_id=?',
      'SELECT 1 FROM retail_offline_authorities WHERE location_id=?',
    ]
    return queries.every(query => this.database.prepare(query).get(...(query.includes(' OR ') ? [locationId, locationId] : [locationId])) === undefined)
  }

  close(): void { this.database.close() }
}
