import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  RetailProduct,
  RetailProductBarcode,
  RetailProductImportOutcome,
  RetailProductImportOutcomeKind,
  RetailProductImportResult,
  RetailProductImportRow,
  RetailProductStatus,
} from '@madina/retail'
import type { AuditEvent, CommandContext } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface ProductRow { id: string; source_id: string; name: string; status: RetailProductStatus; base_unit: 'piece'; created_at: string; updated_at: string }
interface BarcodeRow { id: string; product_id: string; value: string; created_at: string; updated_at: string }

const outcomeKinds: readonly RetailProductImportOutcomeKind[] = ['created', 'updated', 'no_op', 'conflict', 'quarantine']
const toProduct = (row: ProductRow): RetailProduct => ({ id: row.id, sourceId: row.source_id, name: row.name, status: row.status, baseUnit: row.base_unit, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) })
const toBarcode = (row: BarcodeRow): RetailProductBarcode => ({ id: row.id, productId: row.product_id, value: row.value, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at) })

export function normalizeRetailBarcode(value: string): string | undefined {
  const normalized = value.trim()
  return normalized && /^\S+$/.test(normalized) ? normalized : undefined
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Retail Product ${field} is required.`)
  return normalized
}

export class SqliteRetailCatalogRepository {
  private readonly database: DatabaseSync
  constructor(filename: string) { this.database = openDatabaseConnection(filename) }

  async listProducts(search?: string): Promise<RetailProduct[]> {
    const term = search?.trim()
    const rows = term
      ? this.database.prepare(`SELECT id, source_id, name, status, base_unit, created_at, updated_at FROM retail_products WHERE name LIKE ? OR source_id LIKE ? ORDER BY name, id`).all(`%${term}%`, `%${term}%`)
      : this.database.prepare('SELECT id, source_id, name, status, base_unit, created_at, updated_at FROM retail_products ORDER BY name, id').all()
    return (rows as unknown as ProductRow[]).map(toProduct)
  }

  async findProduct(id: string): Promise<RetailProduct | undefined> {
    const row = this.database.prepare('SELECT id, source_id, name, status, base_unit, created_at, updated_at FROM retail_products WHERE id = ?').get(id) as ProductRow | undefined
    return row ? toProduct(row) : undefined
  }

  async findProductByBarcode(value: string): Promise<RetailProduct | undefined> {
    const normalized = normalizeRetailBarcode(value)
    if (!normalized) return undefined
    const rows = this.database.prepare(`SELECT p.id, p.source_id, p.name, p.status, p.base_unit, p.created_at, p.updated_at FROM retail_product_barcodes b JOIN retail_products p ON p.id = b.product_id WHERE b.value = ?`).all(normalized) as unknown as ProductRow[]
    return rows.length === 1 ? toProduct(rows[0]!) : undefined
  }

  async listBarcodes(productId: string): Promise<RetailProductBarcode[]> {
    return (this.database.prepare('SELECT id, product_id, value, created_at, updated_at FROM retail_product_barcodes WHERE product_id = ? ORDER BY value, id').all(productId) as unknown as BarcodeRow[]).map(toBarcode)
  }

  async createProduct(input: { sourceId: string; name: string; status?: RetailProductStatus }, context: CommandContext): Promise<RetailProduct> {
    const product = this.makeProduct(input)
    await this.transaction(async () => {
      this.insertProduct(product)
      this.audit(context, product.id, 'retail.product_created', { sourceId: product.sourceId })
    })
    return product
  }

  async updateProduct(id: string, input: { name: string; status: RetailProductStatus }, context: CommandContext): Promise<RetailProduct> {
    const existing = await this.findProduct(id)
    if (!existing) throw new Error('Retail Product not found.')
    const name = requiredText(input.name, 'name')
    if (input.status !== 'active' && input.status !== 'inactive') throw new Error('Retail Product status is invalid.')
    const updated: RetailProduct = { ...existing, name, status: input.status, updatedAt: new Date() }
    await this.transaction(async () => {
      this.database.prepare('UPDATE retail_products SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(updated.name, updated.status, updated.updatedAt.toISOString(), updated.id)
      this.audit(context, updated.id, 'retail.product_updated')
    })
    return updated
  }

  async addBarcode(productId: string, value: string, context: CommandContext): Promise<RetailProductBarcode> {
    const barcode = normalizeRetailBarcode(value)
    if (!barcode) throw new Error('Retail Product barcode is invalid.')
    if (!await this.findProduct(productId)) throw new Error('Retail Product not found.')
    const now = new Date()
    const record: RetailProductBarcode = { id: randomUUID(), productId, value: barcode, createdAt: now, updatedAt: now }
    await this.transaction(async () => {
      const matches = this.barcodeProductIds(barcode)
      if (matches.some((id) => id !== productId)) throw new Error('Retail Product barcode conflicts with another Product.')
      if (matches.includes(productId)) throw new Error('Retail Product barcode already exists.')
      this.database.prepare('INSERT INTO retail_product_barcodes (id, product_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(record.id, record.productId, record.value, now.toISOString(), now.toISOString())
      this.audit(context, productId, 'retail.product_barcode_added', { barcode })
    })
    return record
  }

  async importProducts(rows: readonly RetailProductImportRow[], dryRun: boolean, context: CommandContext): Promise<RetailProductImportResult> {
    const outcomes: RetailProductImportOutcome[] = []
    const products = new Map((await this.listProducts()).map((product) => [product.sourceId, product]))
    const barcodeOwners = new Map<string, string>()
    for (const product of products.values()) for (const barcode of await this.listBarcodes(product.id)) barcodeOwners.set(barcode.value, product.id)
    const mutations: Array<() => void> = []
    for (const row of rows) {
      const sourceRef = row.sourceRef || ''
      const sourceId = row.sourceId?.trim()
      const name = row.name?.trim()
      const barcode = row.barcode === undefined ? undefined : normalizeRetailBarcode(row.barcode)
      if (!sourceId || !name || (row.barcode !== undefined && !barcode)) {
        outcomes.push({ sourceRef, sourceId, barcode: row.barcode, kind: 'quarantine', reason: !sourceId ? 'missing_source_id' : !name ? 'missing_name' : 'invalid_barcode' })
        continue
      }
      const status: RetailProductStatus = row.status === 'inactive' ? 'inactive' : 'active'
      let product = products.get(sourceId)
      if (barcode && barcodeOwners.has(barcode) && barcodeOwners.get(barcode) !== product?.id) {
        outcomes.push({ sourceRef, sourceId, barcode, kind: 'conflict', reason: 'barcode_associated_with_another_product' })
        continue
      }
      if (!product) {
        product = this.makeProduct({ sourceId, name, status })
        products.set(sourceId, product)
        const created = product
        mutations.push(() => this.insertProduct(created))
        outcomes.push({ sourceRef, sourceId, barcode, kind: 'created' })
      } else if (product.name !== name || product.status !== status) {
        const updated = { ...product, name, status, updatedAt: new Date() }
        products.set(sourceId, updated)
        product = updated
        mutations.push(() => this.database.prepare('UPDATE retail_products SET name = ?, status = ?, updated_at = ? WHERE id = ?').run(updated.name, updated.status, updated.updatedAt.toISOString(), updated.id))
        outcomes.push({ sourceRef, sourceId, barcode, kind: 'updated' })
      } else outcomes.push({ sourceRef, sourceId, barcode, kind: 'no_op' })
      if (barcode && !barcodeOwners.has(barcode) && product) {
        barcodeOwners.set(barcode, product.id)
        const now = new Date()
        mutations.push(() => this.database.prepare('INSERT INTO retail_product_barcodes (id, product_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), product.id, barcode, now.toISOString(), now.toISOString()))
      }
    }
    if (!dryRun && mutations.length) await this.transaction(async () => {
      mutations.forEach((mutation) => mutation())
      this.audit(context, 'retail-product-import', 'retail.products_imported', { rows: rows.length, applied: outcomes.filter((outcome) => outcome.kind === 'created' || outcome.kind === 'updated').length })
    })
    const summary = Object.fromEntries(outcomeKinds.map((kind) => [kind, outcomes.filter((outcome) => outcome.kind === kind).length])) as Record<RetailProductImportOutcomeKind, number>
    return { dryRun, outcomes, summary }
  }

  private makeProduct(input: { sourceId: string; name: string; status?: RetailProductStatus }): RetailProduct {
    const status = input.status ?? 'active'
    if (status !== 'active' && status !== 'inactive') throw new Error('Retail Product status is invalid.')
    const now = new Date()
    return { id: randomUUID(), sourceId: requiredText(input.sourceId, 'sourceId'), name: requiredText(input.name, 'name'), status, baseUnit: 'piece', createdAt: now, updatedAt: now }
  }
  private insertProduct(product: RetailProduct): void { this.database.prepare('INSERT INTO retail_products (id, source_id, name, status, base_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(product.id, product.sourceId, product.name, product.status, product.baseUnit, product.createdAt.toISOString(), product.updatedAt.toISOString()) }
  private barcodeProductIds(value: string): string[] { return (this.database.prepare('SELECT product_id FROM retail_product_barcodes WHERE value = ?').all(value) as Array<{ product_id: string }>).map((row) => row.product_id) }
  private audit(context: CommandContext, entityId: string, action: AuditEvent['action'], metadata?: AuditEvent['metadata']): void { appendAuditEvent(this.database, { id: randomUUID(), occurredAt: new Date(), actorType: context.actorType, actorUserId: context.actorUserId, requestId: context.requestId, domain: 'retail', entityType: 'retail_product', entityId, action, metadata }) }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> { this.database.exec('BEGIN IMMEDIATE'); try { const value = await operation(); this.database.exec('COMMIT'); return value } catch (error) { this.database.exec('ROLLBACK'); throw error } }
  close(): void { this.database.close() }
}
