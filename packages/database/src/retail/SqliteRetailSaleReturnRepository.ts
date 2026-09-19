import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'
import { recordRetailInventoryMovement } from './SqliteRetailInventoryRepository.js'

export interface RetailSaleReturnInput {
  clientOperationId: string
  originalSaleId: string
  items: readonly { saleItemId: string; quantity: number }[]
}

export interface RetailSaleReturnResult {
  saleReturn: unknown
  items: unknown[]
  refundAllocations: unknown[]
  movements: unknown[]
  replayed: boolean
}

export interface RetailCompletedSaleRead {
  sale: unknown
  items: unknown[]
  paymentAllocations: unknown[]
}

interface SaleRow { id: string; location_id: string; status: string; currency_code: string; currency_exponent: number; payable_total_minor: number }
interface SaleItemRow { id: string; sale_id: string; product_id: string; quantity: number; line_total_minor: number; discount_amount_minor: number | null }
interface PaymentRow { id: string; sale_id: string; method: string; amount_minor: number; ordinal: number }

const requiredText = (value: string, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Retail Sale Return ${field} is required.`)
  return value
}

const positiveInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Retail Sale Return ${field} is invalid.`)
  return value
}

const add = (left: number, right: number): number => {
  const value = left + right
  if (!Number.isSafeInteger(value)) throw new Error('Retail Sale Return money overflow.')
  return value
}

const multiply = (left: number, right: number): number => {
  const value = left * right
  if (!Number.isSafeInteger(value)) throw new Error('Retail Sale Return money overflow.')
  return value
}

export class SqliteRetailSaleReturnRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async findCompletedSale(locationId: string, saleId: string): Promise<RetailCompletedSaleRead | undefined> {
    const sale = this.database.prepare(`
      SELECT id, location_id, status, currency_code, currency_exponent, payable_total_minor, completed_at
      FROM retail_sales WHERE id = ? AND location_id = ? AND status = 'completed'
    `).get(saleId, locationId)
    if (!sale) return undefined
    const items = this.database.prepare(`
      SELECT sale_item.id AS sale_item_id, sale_item.product_id, product.source_id, product.name,
             sale_item.quantity, sale_item.unit_price_minor, sale_item.line_total_minor,
             COALESCE(discount.amount_minor, 0) AS discount_amount_minor,
             COALESCE((SELECT SUM(return_item.quantity) FROM retail_sale_return_items return_item
               JOIN retail_sale_returns sale_return ON sale_return.id = return_item.return_id
               WHERE return_item.original_sale_item_id = sale_item.id AND sale_return.original_sale_id = ?), 0) AS already_returned_quantity,
             COALESCE((SELECT SUM(return_item.refunded_amount_minor) FROM retail_sale_return_items return_item
               JOIN retail_sale_returns sale_return ON sale_return.id = return_item.return_id
               WHERE return_item.original_sale_item_id = sale_item.id AND sale_return.original_sale_id = ?), 0) AS already_refunded_amount_minor
      FROM retail_sale_items sale_item
      JOIN retail_products product ON product.id = sale_item.product_id
      LEFT JOIN retail_sale_item_discounts discount ON discount.sale_item_id = sale_item.id
      WHERE sale_item.sale_id = ? ORDER BY sale_item.id
    `).all(saleId, saleId, saleId) as unknown[]
    const paymentAllocations = this.database.prepare(`
      SELECT payment.id, payment.method, payment.amount_minor, payment.ordinal,
             COALESCE((SELECT SUM(refund.amount_minor) FROM retail_sale_return_refund_allocations refund
               JOIN retail_sale_returns sale_return ON sale_return.id = refund.return_id
               WHERE refund.original_payment_allocation_id = payment.id AND sale_return.original_sale_id = ?), 0) AS already_refunded_amount_minor
      FROM retail_payment_allocations payment
      WHERE payment.sale_id = ? ORDER BY payment.ordinal, payment.id
    `).all(saleId, saleId) as unknown[]
    return { sale, items, paymentAllocations }
  }

  async complete(locationId: string, input: RetailSaleReturnInput, context: CommandContext): Promise<RetailSaleReturnResult> {
    return this.transaction(async () => {
      requiredText(locationId, 'locationId')
      requiredText(input.clientOperationId, 'clientOperationId')
      requiredText(input.originalSaleId, 'originalSaleId')
      if (context.actorType !== 'user' || !context.actorUserId) throw new Error('Retail Sale Return requires an authorized user.')
      if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('Retail Sale Return items are required.')

      const normalizedItems = input.items.map((item) => ({
        saleItemId: requiredText(item.saleItemId, 'saleItemId'),
        quantity: positiveInteger(item.quantity, 'quantity'),
      })).sort((left, right) => left.saleItemId.localeCompare(right.saleItemId))
      if (new Set(normalizedItems.map((item) => item.saleItemId)).size !== normalizedItems.length) throw new Error('Retail Sale Return duplicate SaleItem.')

      const payloadHash = createHash('sha256').update(JSON.stringify({
        locationId,
        originalSaleId: input.originalSaleId,
        clientOperationId: input.clientOperationId,
        items: normalizedItems,
      })).digest('hex')
      const receipt = this.database.prepare('SELECT payload_hash, return_id FROM retail_sale_return_operation_receipts WHERE client_operation_id = ?').get(input.clientOperationId) as { payload_hash: string; return_id: string } | undefined
      if (receipt) {
        if (receipt.payload_hash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT')
        return { ...this.load(receipt.return_id), replayed: true }
      }

      const sale = this.database.prepare('SELECT id, location_id, status, currency_code, currency_exponent, payable_total_minor FROM retail_sales WHERE id = ?').get(input.originalSaleId) as SaleRow | undefined
      if (!sale || sale.status !== 'completed') throw new Error('Retail Sale Return original Sale is invalid.')
      if (sale.location_id !== locationId) throw new Error('Retail Sale Return Location mismatch.')

      const returnId = randomUUID()
      const items = normalizedItems.map((requestItem) => {
        const original = this.database.prepare(`
          SELECT sale_item.id, sale_item.sale_id, sale_item.product_id, sale_item.quantity,
                 sale_item.line_total_minor, discount.amount_minor AS discount_amount_minor
          FROM retail_sale_items sale_item
          LEFT JOIN retail_sale_item_discounts discount ON discount.sale_item_id = sale_item.id
          WHERE sale_item.id = ?
        `).get(requestItem.saleItemId) as SaleItemRow | undefined
        if (!original || original.sale_id !== sale.id) throw new Error('Retail Sale Return SaleItem is invalid.')
        const prior = this.database.prepare(`
          SELECT COALESCE(SUM(return_item.quantity), 0) AS quantity
          FROM retail_sale_return_items return_item
          JOIN retail_sale_returns sale_return ON sale_return.id = return_item.return_id
          WHERE return_item.original_sale_item_id = ?
            AND sale_return.original_sale_id = ?
        `).get(original.id, sale.id) as { quantity: number }
        const returnedQuantity = prior.quantity
        if (returnedQuantity + requestItem.quantity > original.quantity) throw new Error('Retail Sale Return quantity exceeds original SaleItem quantity.')
        const discount = original.discount_amount_minor ?? 0
        const payable = original.line_total_minor - discount
        if (!Number.isSafeInteger(payable) || payable <= 0) throw new Error('Retail Sale Return original monetary evidence is invalid.')
        const base = Math.floor(payable / original.quantity)
        const remainder = payable % original.quantity
        const bonusPositions = Math.max(0, Math.min(returnedQuantity + requestItem.quantity, remainder) - returnedQuantity)
        const refundedAmountMinor = add(multiply(base, requestItem.quantity), bonusPositions)
        return { id: randomUUID(), original, quantity: requestItem.quantity, refundedAmountMinor }
      })
      const refundTotal = items.reduce((total, item) => add(total, item.refundedAmountMinor), 0)

      const payments = this.database.prepare('SELECT id, sale_id, method, amount_minor, ordinal FROM retail_payment_allocations WHERE sale_id = ? ORDER BY ordinal, id').all(sale.id) as unknown as PaymentRow[]
      let remainingToAllocate = refundTotal
      const refunds: { id: string; originalPaymentAllocationId: string; amountMinor: number }[] = []
      for (const payment of payments) {
        const prior = this.database.prepare(`
          SELECT COALESCE(SUM(refund.amount_minor), 0) AS amount
          FROM retail_sale_return_refund_allocations refund
          JOIN retail_sale_returns sale_return ON sale_return.id = refund.return_id
          WHERE refund.original_payment_allocation_id = ?
            AND sale_return.original_sale_id = ?
        `).get(payment.id, sale.id) as { amount: number }
        const capacity = payment.amount_minor - prior.amount
        if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error('Retail Sale Return payment evidence is invalid.')
        const amountMinor = Math.min(remainingToAllocate, capacity)
        if (amountMinor > 0) {
          refunds.push({ id: randomUUID(), originalPaymentAllocationId: payment.id, amountMinor })
          remainingToAllocate -= amountMinor
        }
      }
      if (remainingToAllocate !== 0) throw new Error('Retail Sale Return refund capacity exceeded.')

      const now = new Date()
      this.database.prepare('INSERT INTO retail_sale_returns(id, original_sale_id, location_id, currency_code, currency_exponent, completed_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(returnId, sale.id, locationId, sale.currency_code, sale.currency_exponent, now.toISOString(), context.actorUserId)
      for (const item of items) this.database.prepare('INSERT INTO retail_sale_return_items(id, return_id, original_sale_item_id, quantity, refunded_amount_minor) VALUES (?, ?, ?, ?, ?)').run(item.id, returnId, item.original.id, item.quantity, item.refundedAmountMinor)
      for (const refund of refunds) this.database.prepare('INSERT INTO retail_sale_return_refund_allocations(id, return_id, original_payment_allocation_id, amount_minor) VALUES (?, ?, ?, ?)').run(refund.id, returnId, refund.originalPaymentAllocationId, refund.amountMinor)
      for (const item of items) recordRetailInventoryMovement(this.database, { productId: item.original.product_id, locationId, quantityDelta: item.quantity, type: 'return', sourceType: 'retail_sale_return', sourceId: returnId, sourceLineId: item.id }, context)
      this.database.prepare('INSERT INTO retail_sale_return_operation_receipts(client_operation_id, schema_version, payload_hash, return_id, accepted_at) VALUES (?, 1, ?, ?, ?)').run(input.clientOperationId, payloadHash, returnId, now.toISOString())
      appendAuditEvent(this.database, { id: randomUUID(), occurredAt: now, actorType: context.actorType, actorUserId: context.actorUserId, requestId: context.requestId, domain: 'retail', entityType: 'retail_sale_return', entityId: returnId, action: 'retail.sale_return_completed', metadata: { originalSaleId: sale.id, locationId, refundTotalMinor: refundTotal } })
      return { ...this.load(returnId), replayed: false }
    })
  }

  private load(returnId: string): Omit<RetailSaleReturnResult, 'replayed'> {
    const saleReturn = this.database.prepare('SELECT * FROM retail_sale_returns WHERE id = ?').get(returnId)
    const items = this.database.prepare('SELECT * FROM retail_sale_return_items WHERE return_id = ? ORDER BY id').all(returnId) as unknown[]
    const refundAllocations = this.database.prepare(`
      SELECT refund.*, payment.method, payment.ordinal
      FROM retail_sale_return_refund_allocations refund
      JOIN retail_payment_allocations payment ON payment.id = refund.original_payment_allocation_id
      WHERE refund.return_id = ?
      ORDER BY payment.ordinal, payment.id
    `).all(returnId) as unknown[]
    const movements = this.database.prepare("SELECT * FROM retail_inventory_movements WHERE source_type = 'retail_sale_return' AND source_id = ? ORDER BY source_line_id").all(returnId) as unknown[]
    return { saleReturn, items, refundAllocations, movements }
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')
    try { const value = await operation(); this.database.exec('COMMIT'); return value } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }

  close(): void { this.database.close() }
}
