import type { DatabaseSync } from 'node:sqlite'
import type {
  CommerceRepository,
  CommerceSnapshot,
  ClientSalesHistory,
  ClientSalesHistoryQuery,
  ClientSalesReadMetric,
  SalesHistory,
  SalesHistoryQuery,
  StockMovementHistory,
  StockMovementHistoryQuery,
  CommerceUnitOfWork,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'
import {
  STOCK_INTEGRITY_EPSILON,
  normalizeClientName,
  type StockIntegrityDiscrepancy,
} from '@madina/core'
import type { AuditEvent } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface ProductRow {
  id: string
  created_at: string
  updated_at: string
  name: string
  category: Product['category']
  quantity: number
  unit: Product['unit']
  cost_price: number
  sale_price: number
  status: Product['status']
}

interface PurchaseRow {
  id: string
  created_at: string
  updated_at: string
  purchase_number: string
  purchase_date: string
  supplier_name: string
  total_amount: number
  payment_method: Purchase['paymentMethod']
  status: Purchase['status']
  note: string | null
}

interface PurchaseItemRow {
  product_id: string
  quantity: number
  unit: Purchase['items'][number]['unit']
  unit_cost: number
  total_cost: number
}

interface SaleRow {
  id: string
  created_at: string
  updated_at: string
  sale_number: string
  sale_date: string
  client_id: string | null
  client_name: string
  total_amount: number
  payment_method: Sale['paymentMethod']
  status: Sale['status']
  note: string | null
}

interface SaleItemRow {
  product_id: string
  quantity: number
  unit: Sale['items'][number]['unit']
  unit_price: number
  total_amount: number
}

interface TransactionRow {
  id: string
  created_at: string
  updated_at: string
  type: Transaction['type']
  category: Transaction['category']
  amount: number
  payment_method: Transaction['paymentMethod']
  transaction_date: string
  reference_id: string | null
  description: string | null
  status: Transaction['status']
}

interface StockMovementRow {
  id: string
  created_at: string
  updated_at: string
  product_id: string
  type: StockMovement['type']
  quantity: number
  unit: StockMovement['unit']
  reference_id: string | null
  note: string | null
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    name: row.name,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit,
    costPrice: row.cost_price,
    salePrice: row.sale_price,
    status: row.status,
  }
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    type: row.type,
    category: row.category,
    amount: row.amount,
    paymentMethod: row.payment_method,
    transactionDate: new Date(row.transaction_date),
    referenceId: row.reference_id ?? undefined,
    description: row.description ?? undefined,
    status: row.status,
  }
}

function toStockMovement(
  row: StockMovementRow,
): StockMovement {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    productId: row.product_id,
    type: row.type,
    quantity: row.quantity,
    unit: row.unit,
    referenceId: row.reference_id ?? undefined,
    note: row.note ?? undefined,
  }
}

function toSaleListItem(row: SaleRow) {
  return {
    id: row.id,
    saleNumber: row.sale_number,
    saleDate: new Date(row.sale_date),
    clientId: row.client_id ?? undefined,
    clientName: row.client_name,
    totalAmount: row.total_amount,
    paymentMethod: row.payment_method,
    status: row.status,
  }
}

interface ClientOwnershipLookup {
  hasClient(clientId: string): boolean
  ownsSale(sale: SaleRow, clientId: string): boolean
}

function createClientOwnershipLookup(
  database: DatabaseSync,
): ClientOwnershipLookup {
  const clients = database.prepare('SELECT id, name FROM clients').all() as Array<{
    id: string
    name: string
  }>
  const names = new Map<string, string[]>()
  const ids = new Set<string>()
  for (const client of clients) {
    ids.add(client.id)
    const normalized = normalizeClientName(client.name)
    names.set(normalized, [...(names.get(normalized) ?? []), client.id])
  }
  return {
    hasClient: (clientId) => ids.has(clientId),
    ownsSale: (sale, clientId) => sale.client_id
      ? sale.client_id === clientId
      : names.get(normalizeClientName(sale.client_name))?.[0] === clientId &&
        names.get(normalizeClientName(sale.client_name))?.length === 1,
  }
}

function salesPredicates(
  query: SalesHistoryQuery,
): { predicates: string[]; parameters: Array<string | number> } {
  const predicates = ['created_at <= ?']
  const parameters: Array<string | number> = [
    query.throughCreatedAt.toISOString(),
  ]

  if (query.status) {
    predicates.push('status = ?')
    parameters.push(query.status)
  }

  if (query.clientId) {
    const client = query.clientId
    predicates.push(`(
      client_id = ? OR (
        client_id IS NULL AND lower(trim(client_name)) = (
          SELECT lower(trim(name)) FROM clients WHERE id = ?
        ) AND 1 = (
          SELECT COUNT(*) FROM clients
          WHERE lower(trim(name)) = (
            SELECT lower(trim(name)) FROM clients WHERE id = ?
          )
        )
      )
    )`)
    parameters.push(client, client, client)
  }

  if (query.cursor) {
    predicates.push(`(
      sale_date < ? OR (sale_date = ? AND id < ?)
    )`)
    const saleDate = query.cursor.saleDate.toISOString()
    parameters.push(saleDate, saleDate, query.cursor.id)
  }

  return { predicates, parameters }
}

function readSalesHistory(
  database: DatabaseSync,
  query: SalesHistoryQuery,
): SalesHistory {
  const { predicates, parameters } = salesPredicates(query)
  const summary = database.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0)
        AS draft_count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)
        AS completed_count,
      COALESCE(SUM(total_amount), 0) AS total_amount
    FROM sales
    WHERE created_at <= ?
  `).get(query.throughCreatedAt.toISOString()) as {
    total_count: number
    draft_count: number
    completed_count: number
    total_amount: number
  }
  const rows = database.prepare(`
    SELECT id, created_at, updated_at, sale_number, sale_date, client_id,
      client_name, total_amount, payment_method, status, note
    FROM sales
    WHERE ${predicates.join(' AND ')}
    ORDER BY sale_date DESC, id DESC
    LIMIT ?
  `).all(...parameters, query.limit) as unknown as SaleRow[]

  return {
    summary: {
      totalCount: summary.total_count,
      draftCount: summary.draft_count,
      completedCount: summary.completed_count,
      totalAmount: summary.total_amount,
    },
    sales: rows.map(toSaleListItem),
  }
}

function readClientSalesHistory(
  database: DatabaseSync,
  clientId: string,
  query: ClientSalesHistoryQuery,
): ClientSalesHistory {
  const ownership = createClientOwnershipLookup(database)
  if (!ownership.hasClient(clientId)) {
    return { summary: { completedCount: 0, completedTotalAmount: 0 }, sales: [] }
  }
  const predicates = ["status = 'completed'", 'created_at <= ?', '(client_id = ? OR client_id IS NULL)']
  const parameters: string[] = [query.throughCreatedAt.toISOString(), clientId]
  const selectSales = (where: readonly string[], values: readonly string[]) => database.prepare(`
    SELECT id, created_at, updated_at, sale_number, sale_date, client_id,
      client_name, total_amount, payment_method, status, note
    FROM sales WHERE ${where.join(' AND ')}
    ORDER BY sale_date DESC, id DESC
  `).all(...values) as unknown as SaleRow[]
  const allMatching = selectSales(predicates, parameters)
  const ownedBy = (sales: SaleRow[]) => sales.filter((sale) =>
    ownership.ownsSale(sale, clientId),
  )
  const owned = ownedBy(allMatching)
  const pagePredicates = [...predicates]
  const pageParameters = [...parameters]
  if (query.cursor) {
    pagePredicates.push('(sale_date < ? OR (sale_date = ? AND id < ?))')
    const saleDate = query.cursor.saleDate.toISOString()
    pageParameters.push(saleDate, saleDate, query.cursor.id)
  }
  const page = ownedBy(selectSales(pagePredicates, pageParameters))

  return {
    summary: {
      completedCount: owned.length,
      completedTotalAmount: owned.reduce((sum, row) => sum + row.total_amount, 0),
      lastSaleDate: owned[0] ? new Date(owned[0].sale_date) : undefined,
    },
    sales: page.slice(0, query.limit).map(toSaleListItem),
  }
}

function readClientSalesMetrics(
  database: DatabaseSync,
  clientIds: string[],
): ClientSalesReadMetric[] {
  if (clientIds.length === 0) return []
  const placeholders = clientIds.map(() => '?').join(', ')
  const clients = database.prepare(`SELECT id, name FROM clients WHERE id IN (${placeholders})`)
    .all(...clientIds) as Array<{ id: string; name: string }>
  const ownership = createClientOwnershipLookup(database)
  const sales = database.prepare(`
    SELECT id, created_at, updated_at, sale_number, sale_date, client_id,
      client_name, total_amount, payment_method, status, note
    FROM sales WHERE status = 'completed' AND (client_id IN (${placeholders}) OR client_id IS NULL)
  `).all(...clientIds) as unknown as SaleRow[]
  return clients.map((client) => {
    const completed = sales.filter((sale) => ownership.ownsSale(sale, client.id))
      .sort((a, b) => b.sale_date.localeCompare(a.sale_date) || b.id.localeCompare(a.id))
    return {
      clientId: client.id,
      completedCount: completed.length,
      completedTotalAmount: completed.reduce((sum, sale) => sum + sale.total_amount, 0),
      lastSaleDate: completed[0] ? new Date(completed[0].sale_date) : undefined,
    }
  }).sort((a, b) => a.clientId.localeCompare(b.clientId))
}

function readStockMovementHistory(
  database: DatabaseSync,
  query: StockMovementHistoryQuery,
): StockMovementHistory {
  const predicates = ['created_at <= ?']
  const parameters: Array<string | number> = [
    query.throughCreatedAt.toISOString(),
  ]

  if (query.productId) {
    predicates.push('product_id = ?')
    parameters.push(query.productId)
  }

  if (query.type) {
    predicates.push('type = ?')
    parameters.push(query.type)
  }

  if (query.fromCreatedAt) {
    predicates.push('created_at >= ?')
    parameters.push(query.fromCreatedAt.toISOString())
  }

  if (query.toCreatedAtExclusive) {
    predicates.push('created_at < ?')
    parameters.push(query.toCreatedAtExclusive.toISOString())
  }

  if (query.cursor) {
    predicates.push(`(
      created_at < ? OR (created_at = ? AND id < ?)
    )`)
    const cursorCreatedAt = query.cursor.createdAt.toISOString()
    parameters.push(cursorCreatedAt, cursorCreatedAt, query.cursor.id)
  }

  const summary = database.prepare(`
    SELECT
      COUNT(*) AS total_movements,
      COALESCE(SUM(CASE WHEN type = 'purchase' THEN quantity ELSE 0 END), 0)
        AS total_purchases,
      ABS(COALESCE(SUM(CASE WHEN type = 'sale' THEN quantity ELSE 0 END), 0))
        AS total_sales
    FROM stock_movements
    WHERE created_at <= ?
  `).get(query.throughCreatedAt.toISOString()) as {
    total_movements: number
    total_purchases: number
    total_sales: number
  }

  const rows = database.prepare(`
    SELECT id, created_at, updated_at, product_id, type, quantity, unit,
      reference_id, note
    FROM stock_movements
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...parameters, query.limit) as unknown as StockMovementRow[]

  return {
    summary: {
      totalMovements: summary.total_movements,
      totalPurchases: summary.total_purchases,
      totalSales: summary.total_sales,
    },
    movements: rows.map(toStockMovement),
  }
}

function readStockIntegrityDiscrepancies(
  database: DatabaseSync,
): StockIntegrityDiscrepancy[] {
  const rows = database.prepare(`
    SELECT
      products.id AS product_id,
      products.name AS product_name,
      products.quantity AS actual_quantity,
      COALESCE(SUM(stock_movements.quantity), 0) AS calculated_quantity
    FROM products
    LEFT JOIN stock_movements
      ON stock_movements.product_id = products.id
    GROUP BY products.id
    HAVING ABS(
      products.quantity - COALESCE(SUM(stock_movements.quantity), 0)
    ) > ?
    ORDER BY products.name COLLATE NOCASE, products.id
  `).all(STOCK_INTEGRITY_EPSILON) as Array<{
    product_id: string
    product_name: string
    actual_quantity: number
    calculated_quantity: number
  }>

  return rows.map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    actualQuantity: row.actual_quantity,
    calculatedQuantity: row.calculated_quantity,
    difference: row.actual_quantity - row.calculated_quantity,
  }))
}

class SqliteCommerceUnitOfWork implements CommerceUnitOfWork {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    appendAuditEvent(this.database, event)
  }

  async findProductsByIds(productIds: string[]): Promise<Product[]> {
    if (productIds.length === 0) return []

    const placeholders = productIds.map(() => '?').join(', ')
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, name, category, quantity,
        unit, cost_price, sale_price, status
      FROM products WHERE id IN (${placeholders})
    `).all(...productIds) as unknown as ProductRow[]

    return rows.map(toProduct)
  }

  async findPurchaseById(purchaseId: string): Promise<Purchase | undefined> {
    const row = this.database.prepare(`
      SELECT id, created_at, updated_at, purchase_number, purchase_date,
        supplier_name, total_amount, payment_method, status, note
      FROM purchases WHERE id = ?
    `).get(purchaseId) as PurchaseRow | undefined

    if (!row) return undefined

    const items = this.database.prepare(`
      SELECT product_id, quantity, unit, unit_cost, total_cost
      FROM purchase_items WHERE purchase_id = ? ORDER BY rowid
    `).all(purchaseId) as unknown as PurchaseItemRow[]

    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      purchaseNumber: row.purchase_number,
      purchaseDate: new Date(row.purchase_date),
      supplierName: row.supplier_name,
      items: items.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unit_cost,
        totalCost: item.total_cost,
      })),
      totalAmount: row.total_amount,
      paymentMethod: row.payment_method,
      status: row.status,
      note: row.note ?? undefined,
    }
  }

  async findSaleById(saleId: string): Promise<Sale | undefined> {
    const row = this.database.prepare(`
      SELECT id, created_at, updated_at, sale_number, sale_date, client_id,
        client_name, total_amount, payment_method, status, note
      FROM sales WHERE id = ?
    `).get(saleId) as SaleRow | undefined

    if (!row) return undefined

    const items = this.database.prepare(`
      SELECT product_id, quantity, unit, unit_price, total_amount
      FROM sale_items WHERE sale_id = ? ORDER BY rowid
    `).all(saleId) as unknown as SaleItemRow[]

    return {
      id: row.id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      saleNumber: row.sale_number,
      saleDate: new Date(row.sale_date),
      clientId: row.client_id ?? undefined,
      clientName: row.client_name,
      items: items.map((item) => ({
        productId: item.product_id,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unit_price,
        totalAmount: item.total_amount,
      })),
      totalAmount: row.total_amount,
      paymentMethod: row.payment_method,
      status: row.status,
      note: row.note ?? undefined,
    }
  }

  async findTransactionByReference(
    category: Transaction['category'],
    referenceId: string,
  ): Promise<Transaction | undefined> {
    const row = this.database.prepare(`
      SELECT id, created_at, updated_at, type, category, amount,
        payment_method, transaction_date, reference_id, description, status
      FROM transactions WHERE category = ? AND reference_id = ?
    `).get(category, referenceId) as TransactionRow | undefined

    return row ? toTransaction(row) : undefined
  }

  async findStockMovementsByReference(
    referenceId: string,
  ): Promise<StockMovement[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, product_id, type, quantity, unit,
        reference_id, note
      FROM stock_movements WHERE reference_id = ? ORDER BY rowid
    `).all(referenceId) as unknown as StockMovementRow[]

    return rows.map(toStockMovement)
  }

  async findAllProducts(): Promise<Product[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, name, category, quantity,
        unit, cost_price, sale_price, status
      FROM products ORDER BY name COLLATE NOCASE, id
    `).all() as unknown as ProductRow[]

    return rows.map(toProduct)
  }

  async findAllStockMovements(): Promise<StockMovement[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, product_id, type, quantity, unit,
        reference_id, note
      FROM stock_movements ORDER BY created_at DESC, id DESC
    `).all() as unknown as StockMovementRow[]

    return rows.map(toStockMovement)
  }

  async findAllPurchases(): Promise<Purchase[]> {
    const rows = this.database.prepare(`
      SELECT id FROM purchases ORDER BY purchase_date DESC, id DESC
    `).all() as unknown as Array<{ id: string }>
    const purchases = await Promise.all(rows.map((row) =>
      this.findPurchaseById(row.id),
    ))

    return purchases.filter((purchase): purchase is Purchase =>
      purchase !== undefined,
    )
  }

  async findAllSales(): Promise<Sale[]> {
    const rows = this.database.prepare(`
      SELECT id FROM sales ORDER BY sale_date DESC, id DESC
    `).all() as unknown as Array<{ id: string }>
    const sales = await Promise.all(rows.map((row) =>
      this.findSaleById(row.id),
    ))

    return sales.filter((sale): sale is Sale => sale !== undefined)
  }

  async findAllTransactions(): Promise<Transaction[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, type, category, amount,
        payment_method, transaction_date, reference_id, description, status
      FROM transactions ORDER BY transaction_date DESC, id DESC
    `).all() as unknown as TransactionRow[]

    return rows.map(toTransaction)
  }

  async getStockMovementHistory(
    query: StockMovementHistoryQuery,
  ): Promise<StockMovementHistory> {
    return readStockMovementHistory(this.database, query)
  }

  async getStockIntegrityDiscrepancies(): Promise<
    StockIntegrityDiscrepancy[]
  > {
    return readStockIntegrityDiscrepancies(this.database)
  }

  async getSalesHistory(query: SalesHistoryQuery): Promise<SalesHistory> {
    return readSalesHistory(this.database, query)
  }

  async getClientSalesHistory(
    clientId: string,
    query: ClientSalesHistoryQuery,
  ): Promise<ClientSalesHistory> {
    return readClientSalesHistory(this.database, clientId, query)
  }

  async getClientSalesMetrics(
    clientIds: string[],
  ): Promise<ClientSalesReadMetric[]> {
    return readClientSalesMetrics(this.database, clientIds)
  }

  async getNextSaleNumber(): Promise<string> {
    const row = this.database.prepare(
      'SELECT COUNT(*) AS count FROM sales',
    ).get() as { count: number }
    return `SAL-${String(row.count + 1).padStart(4, '0')}`
  }

  async saveProducts(products: Product[]): Promise<void> {
    const statement = this.database.prepare(`
      UPDATE products SET updated_at = ?, name = ?, category = ?, quantity = ?,
        unit = ?, cost_price = ?, sale_price = ?, status = ?
      WHERE id = ?
    `)

    for (const product of products) {
      statement.run(
        product.updatedAt.toISOString(), product.name, product.category,
        product.quantity, product.unit, product.costPrice, product.salePrice,
        product.status, product.id,
      )
    }
  }

  async insertProduct(product: Product): Promise<void> {
    this.database.prepare(`
      INSERT INTO products (
        id, created_at, updated_at, name, category, quantity, unit,
        cost_price, sale_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.id, product.createdAt.toISOString(),
      product.updatedAt.toISOString(), product.name, product.category,
      product.quantity, product.unit, product.costPrice, product.salePrice,
      product.status,
    )
  }

  async insertPurchase(purchase: Purchase): Promise<void> {
    this.database.prepare(`
      INSERT INTO purchases (
        id, created_at, updated_at, purchase_number, purchase_date,
        supplier_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      purchase.id, purchase.createdAt.toISOString(),
      purchase.updatedAt.toISOString(), purchase.purchaseNumber,
      purchase.purchaseDate.toISOString(), purchase.supplierName,
      purchase.totalAmount, purchase.paymentMethod, purchase.status,
      purchase.note ?? null,
    )

    const statement = this.database.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, quantity, unit, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const item of purchase.items) {
      statement.run(
        purchase.id, item.productId, item.quantity, item.unit,
        item.unitCost, item.totalCost,
      )
    }
  }

  async insertSale(sale: Sale): Promise<void> {
    this.database.prepare(`
      INSERT INTO sales (
        id, created_at, updated_at, sale_number, sale_date, client_id,
        client_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sale.id, sale.createdAt.toISOString(), sale.updatedAt.toISOString(),
      sale.saleNumber, sale.saleDate.toISOString(), sale.clientId ?? null,
      sale.clientName, sale.totalAmount, sale.paymentMethod, sale.status,
      sale.note ?? null,
    )

    const statement = this.database.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, quantity, unit, unit_price, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const item of sale.items) {
      statement.run(
        sale.id, item.productId, item.quantity, item.unit,
        item.unitPrice, item.totalAmount,
      )
    }
  }

  async updatePurchase(purchase: Purchase): Promise<void> {
    this.database.prepare(`
      UPDATE purchases SET updated_at = ?, purchase_date = ?,
        supplier_name = ?, total_amount = ?, payment_method = ?, status = ?,
        note = ? WHERE id = ?
    `).run(
      purchase.updatedAt.toISOString(), purchase.purchaseDate.toISOString(),
      purchase.supplierName, purchase.totalAmount, purchase.paymentMethod,
      purchase.status, purchase.note ?? null, purchase.id,
    )

    this.database.prepare(
      'DELETE FROM purchase_items WHERE purchase_id = ?',
    ).run(purchase.id)

    const statement = this.database.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, quantity, unit, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const item of purchase.items) {
      statement.run(
        purchase.id, item.productId, item.quantity, item.unit,
        item.unitCost, item.totalCost,
      )
    }
  }

  async updateSale(sale: Sale): Promise<void> {
    this.database.prepare(`
      UPDATE sales SET updated_at = ?, sale_date = ?, client_id = ?,
        client_name = ?, total_amount = ?, payment_method = ?, status = ?,
        note = ? WHERE id = ?
    `).run(
      sale.updatedAt.toISOString(), sale.saleDate.toISOString(),
      sale.clientId ?? null, sale.clientName, sale.totalAmount,
      sale.paymentMethod, sale.status, sale.note ?? null, sale.id,
    )

    this.database.prepare(
      'DELETE FROM sale_items WHERE sale_id = ?',
    ).run(sale.id)

    const statement = this.database.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, quantity, unit, unit_price, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const item of sale.items) {
      statement.run(
        sale.id, item.productId, item.quantity, item.unit,
        item.unitPrice, item.totalAmount,
      )
    }
  }

  async saveStockMovements(movements: StockMovement[]): Promise<void> {
    const statement = this.database.prepare(`
      INSERT INTO stock_movements (
        id, created_at, updated_at, product_id, type, quantity, unit,
        reference_id, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const movement of movements) {
      statement.run(
        movement.id, movement.createdAt.toISOString(),
        movement.updatedAt.toISOString(), movement.productId, movement.type,
        movement.quantity, movement.unit, movement.referenceId ?? null,
        movement.note ?? null,
      )
    }
  }

  async saveTransaction(transaction: Transaction): Promise<void> {
    this.database.prepare(`
      INSERT INTO transactions (
        id, created_at, updated_at, type, category, amount, payment_method,
        transaction_date, reference_id, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transaction.id, transaction.createdAt.toISOString(),
      transaction.updatedAt.toISOString(), transaction.type,
      transaction.category, transaction.amount, transaction.paymentMethod,
      transaction.transactionDate.toISOString(), transaction.referenceId ?? null,
      transaction.description ?? null, transaction.status,
    )
  }

  async insertSnapshot(snapshot: CommerceSnapshot): Promise<void> {
    const productStatement = this.database.prepare(`
      INSERT INTO products (
        id, created_at, updated_at, name, category, quantity, unit,
        cost_price, sale_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const product of snapshot.products) {
      productStatement.run(
        product.id, product.createdAt.toISOString(),
        product.updatedAt.toISOString(), product.name, product.category,
        product.quantity, product.unit, product.costPrice, product.salePrice,
        product.status,
      )
    }

    const purchaseStatement = this.database.prepare(`
      INSERT INTO purchases (
        id, created_at, updated_at, purchase_number, purchase_date,
        supplier_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const purchaseItemStatement = this.database.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, quantity, unit, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const purchase of snapshot.purchases) {
      purchaseStatement.run(
        purchase.id, purchase.createdAt.toISOString(),
        purchase.updatedAt.toISOString(), purchase.purchaseNumber,
        purchase.purchaseDate.toISOString(), purchase.supplierName,
        purchase.totalAmount, purchase.paymentMethod, purchase.status,
        purchase.note ?? null,
      )

      for (const item of purchase.items) {
        purchaseItemStatement.run(
          purchase.id, item.productId, item.quantity, item.unit,
          item.unitCost, item.totalCost,
        )
      }
    }

    const saleStatement = this.database.prepare(`
      INSERT INTO sales (
        id, created_at, updated_at, sale_number, sale_date, client_id,
        client_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const saleItemStatement = this.database.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, quantity, unit, unit_price, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const sale of snapshot.sales) {
      saleStatement.run(
        sale.id, sale.createdAt.toISOString(), sale.updatedAt.toISOString(),
        sale.saleNumber, sale.saleDate.toISOString(), sale.clientId ?? null,
        sale.clientName, sale.totalAmount, sale.paymentMethod, sale.status,
        sale.note ?? null,
      )

      for (const item of sale.items) {
        saleItemStatement.run(
          sale.id, item.productId, item.quantity, item.unit,
          item.unitPrice, item.totalAmount,
        )
      }
    }

    const movementStatement = this.database.prepare(`
      INSERT INTO stock_movements (
        id, created_at, updated_at, product_id, type, quantity, unit,
        reference_id, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const movement of snapshot.stockMovements) {
      movementStatement.run(
        movement.id, movement.createdAt.toISOString(),
        movement.updatedAt.toISOString(), movement.productId, movement.type,
        movement.quantity, movement.unit, movement.referenceId ?? null,
        movement.note ?? null,
      )
    }

    const transactionStatement = this.database.prepare(`
      INSERT INTO transactions (
        id, created_at, updated_at, type, category, amount, payment_method,
        transaction_date, reference_id, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const transaction of snapshot.transactions) {
      transactionStatement.run(
        transaction.id, transaction.createdAt.toISOString(),
        transaction.updatedAt.toISOString(), transaction.type,
        transaction.category, transaction.amount, transaction.paymentMethod,
        transaction.transactionDate.toISOString(),
        transaction.referenceId ?? null, transaction.description ?? null,
        transaction.status,
      )
    }
  }
}

export class SqliteCommerceRepository implements CommerceRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async withTransaction<T>(
    operation: (unitOfWork: CommerceUnitOfWork) => Promise<T>,
  ): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')

    try {
      const result = await operation(
        new SqliteCommerceUnitOfWork(this.database),
      )
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async findAllProducts(): Promise<Product[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, name, category, quantity,
        unit, cost_price, sale_price, status
      FROM products ORDER BY name COLLATE NOCASE, id
    `).all() as unknown as ProductRow[]

    return rows.map(toProduct)
  }

  async findAllStockMovements(): Promise<StockMovement[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, product_id, type, quantity, unit,
        reference_id, note
      FROM stock_movements ORDER BY created_at DESC, id DESC
    `).all() as unknown as StockMovementRow[]

    return rows.map(toStockMovement)
  }

  async findAllPurchases(): Promise<Purchase[]> {
    const rows = this.database.prepare(`
      SELECT id FROM purchases ORDER BY purchase_date DESC, id DESC
    `).all() as unknown as Array<{ id: string }>
    const unitOfWork = new SqliteCommerceUnitOfWork(this.database)
    const purchases = await Promise.all(rows.map((row) =>
      unitOfWork.findPurchaseById(row.id),
    ))

    return purchases.filter((purchase): purchase is Purchase =>
      purchase !== undefined,
    )
  }

  async findAllSales(): Promise<Sale[]> {
    const rows = this.database.prepare(`
      SELECT id FROM sales ORDER BY sale_date DESC, id DESC
    `).all() as unknown as Array<{ id: string }>
    const unitOfWork = new SqliteCommerceUnitOfWork(this.database)
    const sales = await Promise.all(rows.map((row) =>
      unitOfWork.findSaleById(row.id),
    ))

    return sales.filter((sale): sale is Sale => sale !== undefined)
  }

  async findSaleById(saleId: string): Promise<Sale | undefined> {
    return new SqliteCommerceUnitOfWork(this.database).findSaleById(saleId)
  }

  async findAllTransactions(): Promise<Transaction[]> {
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, type, category, amount,
        payment_method, transaction_date, reference_id, description, status
      FROM transactions ORDER BY transaction_date DESC, id DESC
    `).all() as unknown as TransactionRow[]

    return rows.map(toTransaction)
  }

  async getStockMovementHistory(
    query: StockMovementHistoryQuery,
  ): Promise<StockMovementHistory> {
    this.database.exec('BEGIN DEFERRED')

    try {
      const history = readStockMovementHistory(this.database, query)
      this.database.exec('COMMIT')
      return history
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getStockIntegrityDiscrepancies(): Promise<
    StockIntegrityDiscrepancy[]
  > {
    this.database.exec('BEGIN DEFERRED')

    try {
      const discrepancies = readStockIntegrityDiscrepancies(this.database)
      this.database.exec('COMMIT')
      return discrepancies
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getSalesHistory(query: SalesHistoryQuery): Promise<SalesHistory> {
    this.database.exec('BEGIN DEFERRED')
    try {
      const result = readSalesHistory(this.database, query)
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getClientSalesHistory(
    clientId: string,
    query: ClientSalesHistoryQuery,
  ): Promise<ClientSalesHistory> {
    this.database.exec('BEGIN DEFERRED')
    try {
      const result = readClientSalesHistory(this.database, clientId, query)
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getClientSalesMetrics(
    clientIds: string[],
  ): Promise<ClientSalesReadMetric[]> {
    this.database.exec('BEGIN DEFERRED')
    try {
      const result = readClientSalesMetrics(this.database, clientIds)
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getNextSaleNumber(): Promise<string> {
    const row = this.database.prepare(
      'SELECT COUNT(*) AS count FROM sales',
    ).get() as { count: number }
    return `SAL-${String(row.count + 1).padStart(4, '0')}`
  }

  async saveProduct(product: Product): Promise<void> {
    this.database.prepare(`
      INSERT INTO products (
        id, created_at, updated_at, name, category, quantity, unit,
        cost_price, sale_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.id, product.createdAt.toISOString(),
      product.updatedAt.toISOString(), product.name, product.category,
      product.quantity, product.unit, product.costPrice, product.salePrice,
      product.status,
    )
  }

  async savePurchase(purchase: Purchase): Promise<void> {
    this.database.prepare(`
      INSERT INTO purchases (
        id, created_at, updated_at, purchase_number, purchase_date,
        supplier_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      purchase.id, purchase.createdAt.toISOString(),
      purchase.updatedAt.toISOString(), purchase.purchaseNumber,
      purchase.purchaseDate.toISOString(), purchase.supplierName,
      purchase.totalAmount, purchase.paymentMethod, purchase.status,
      purchase.note ?? null,
    )

    const statement = this.database.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, quantity, unit, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const item of purchase.items) {
      statement.run(purchase.id, item.productId, item.quantity, item.unit,
        item.unitCost, item.totalCost)
    }
  }

  async saveSale(sale: Sale): Promise<void> {
    this.database.prepare(`
      INSERT INTO sales (
        id, created_at, updated_at, sale_number, sale_date, client_id,
        client_name, total_amount, payment_method, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sale.id, sale.createdAt.toISOString(), sale.updatedAt.toISOString(),
      sale.saleNumber, sale.saleDate.toISOString(), sale.clientId ?? null,
      sale.clientName, sale.totalAmount, sale.paymentMethod, sale.status,
      sale.note ?? null,
    )

    const statement = this.database.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, quantity, unit, unit_price, total_amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const item of sale.items) {
      statement.run(sale.id, item.productId, item.quantity, item.unit,
        item.unitPrice, item.totalAmount)
    }
  }

  close(): void {
    this.database.close()
  }
}
