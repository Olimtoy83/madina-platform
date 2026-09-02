import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  RetailInventoryBalance,
  RetailInventoryMovement,
  RetailInventoryMovementType,
} from '@madina/retail'
import type { AuditEvent, CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface BalanceRow { product_id: string; location_id: string; on_hand_quantity: number; updated_at: string }
interface MovementRow { id: string; product_id: string; location_id: string; quantity_delta: number; movement_type: RetailInventoryMovementType; source_type: string; source_id: string; source_line_id: string; created_at: string }

export interface RecordRetailInventoryMovementInput {
  productId: string
  locationId: string
  quantityDelta: number
  type: RetailInventoryMovementType
  sourceType: string
  sourceId: string
  sourceLineId: string
}

const movementTypes: readonly RetailInventoryMovementType[] = [
  'opening', 'goods_receipt', 'transfer', 'sale', 'return', 'reconciliation_adjustment',
]
const toBalance = (row: BalanceRow): RetailInventoryBalance => ({ productId: row.product_id, locationId: row.location_id, onHandQuantity: row.on_hand_quantity, updatedAt: new Date(row.updated_at) })
const toMovement = (row: MovementRow): RetailInventoryMovement => ({ id: row.id, productId: row.product_id, locationId: row.location_id, quantityDelta: row.quantity_delta, type: row.movement_type, sourceType: row.source_type, sourceId: row.source_id, sourceLineId: row.source_line_id, createdAt: new Date(row.created_at) })

function requiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Retail Inventory ${field} is required.`)
  return normalized
}

export class SqliteRetailInventoryRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async findBalance(productId: string, locationId: string): Promise<RetailInventoryBalance | undefined> {
    const row = this.database.prepare('SELECT product_id, location_id, on_hand_quantity, updated_at FROM retail_inventory_balances WHERE product_id = ? AND location_id = ?').get(productId, locationId) as BalanceRow | undefined
    return row ? toBalance(row) : undefined
  }

  async listBalances(locationId: string): Promise<RetailInventoryBalance[]> {
    return (this.database.prepare('SELECT product_id, location_id, on_hand_quantity, updated_at FROM retail_inventory_balances WHERE location_id = ? ORDER BY product_id').all(locationId) as unknown as BalanceRow[]).map(toBalance)
  }

  async listMovements(productId: string, locationId: string): Promise<RetailInventoryMovement[]> {
    return (this.database.prepare('SELECT id, product_id, location_id, quantity_delta, movement_type, source_type, source_id, source_line_id, created_at FROM retail_inventory_movements WHERE product_id = ? AND location_id = ? ORDER BY created_at, id').all(productId, locationId) as unknown as MovementRow[]).map(toMovement)
  }

  async recordMovement(input: RecordRetailInventoryMovementInput, context: CommandContext): Promise<RetailInventoryMovement> {
    return this.transaction(async () => {
      return recordRetailInventoryMovement(this.database, input, context)
    })
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')
    try { const value = await operation(); this.database.exec('COMMIT'); return value } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  close(): void { this.database.close() }
}

/** The Stage 4 mutation primitive. Callers that compose it must own the SQLite transaction. */
export function recordRetailInventoryMovement(database: DatabaseSync, input: RecordRetailInventoryMovementInput, context: CommandContext): RetailInventoryMovement {
  if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) throw new Error('Retail Inventory quantityDelta must be a non-zero safe integer.')
  if (!movementTypes.includes(input.type)) throw new Error('Retail Inventory movement type is invalid.')
  const movement: RetailInventoryMovement = { id: randomUUID(), productId: requiredText(input.productId, 'productId'), locationId: requiredText(input.locationId, 'locationId'), quantityDelta: input.quantityDelta, type: input.type, sourceType: requiredText(input.sourceType, 'sourceType'), sourceId: requiredText(input.sourceId, 'sourceId'), sourceLineId: requiredText(input.sourceLineId, 'sourceLineId'), createdAt: new Date() }
  const existing = database.prepare('SELECT id, product_id, location_id, quantity_delta, movement_type, source_type, source_id, source_line_id, created_at FROM retail_inventory_movements WHERE source_type = ? AND source_id = ? AND source_line_id = ?').get(movement.sourceType, movement.sourceId, movement.sourceLineId) as MovementRow | undefined
  if (existing) return toMovement(existing)
  const product = database.prepare('SELECT status FROM retail_products WHERE id = ?').get(movement.productId) as { status: string } | undefined
  if (!product) throw new Error('Retail Product not found.')
  if (product.status !== 'active') throw new Error('Retail Product is inactive.')
  const location = database.prepare('SELECT status FROM retail_locations WHERE id = ?').get(movement.locationId) as { status: string } | undefined
  if (!location) throw new Error('Retail Location not found.')
  if (location.status !== 'active') throw new Error('Retail Location is inactive.')
  const balance = database.prepare('SELECT on_hand_quantity FROM retail_inventory_balances WHERE product_id = ? AND location_id = ?').get(movement.productId, movement.locationId) as { on_hand_quantity: number } | undefined
  const next = (balance?.on_hand_quantity ?? 0) + movement.quantityDelta
  if (next < 0) throw new Error('Retail Inventory movement would produce negative on-hand quantity.')
  database.prepare('INSERT INTO retail_inventory_movements (id, product_id, location_id, quantity_delta, movement_type, source_type, source_id, source_line_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(movement.id, movement.productId, movement.locationId, movement.quantityDelta, movement.type, movement.sourceType, movement.sourceId, movement.sourceLineId, movement.createdAt.toISOString())
  database.prepare('INSERT INTO retail_inventory_balances (product_id, location_id, on_hand_quantity, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(product_id, location_id) DO UPDATE SET on_hand_quantity = excluded.on_hand_quantity, updated_at = excluded.updated_at').run(movement.productId, movement.locationId, next, movement.createdAt.toISOString())
  appendAuditEvent(database, { id: randomUUID(), occurredAt: new Date(), actorType: context.actorType, actorUserId: context.actorUserId, requestId: context.requestId, domain: 'retail', entityType: 'retail_inventory_movement', entityId: movement.id, action: 'retail.inventory_movement_recorded', metadata: { productId: movement.productId, locationId: movement.locationId, quantityDelta: movement.quantityDelta, type: movement.type, sourceType: movement.sourceType, sourceId: movement.sourceId, sourceLineId: movement.sourceLineId } })
  return movement
}
