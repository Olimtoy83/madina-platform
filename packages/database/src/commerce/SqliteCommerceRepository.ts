import { DatabaseSync } from 'node:sqlite'
import type {
  CommerceRepository,
  CommerceUnitOfWork,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'

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

class SqliteCommerceUnitOfWork implements CommerceUnitOfWork {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
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

  async updatePurchase(purchase: Purchase): Promise<void> {
    this.database.prepare(`
      UPDATE purchases SET updated_at = ?, status = ? WHERE id = ?
    `).run(
      purchase.updatedAt.toISOString(), purchase.status, purchase.id,
    )
  }

  async updateSale(sale: Sale): Promise<void> {
    this.database.prepare(`
      UPDATE sales SET updated_at = ?, status = ? WHERE id = ?
    `).run(sale.updatedAt.toISOString(), sale.status, sale.id)
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
}

export class SqliteCommerceRepository implements CommerceRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = new DatabaseSync(filename)
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('dry-fruits', 'dates', 'perfume', 'carpets')),
        quantity REAL NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
        cost_price REAL NOT NULL, sale_price REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        purchase_number TEXT NOT NULL UNIQUE, purchase_date TEXT NOT NULL,
        supplier_name TEXT NOT NULL, total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'cancelled')),
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS purchase_items (
        purchase_id TEXT NOT NULL REFERENCES purchases(id),
        product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL,
        unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
        unit_cost REAL NOT NULL, total_cost REAL NOT NULL,
        PRIMARY KEY (purchase_id, product_id)
      );
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        sale_number TEXT NOT NULL UNIQUE, sale_date TEXT NOT NULL, client_id TEXT,
        client_name TEXT NOT NULL, total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
        status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'cancelled')),
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        sale_id TEXT NOT NULL REFERENCES sales(id),
        product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL,
        unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
        unit_price REAL NOT NULL, total_amount REAL NOT NULL,
        PRIMARY KEY (sale_id, product_id)
      );
      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'adjustment')),
        quantity REAL NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
        reference_id TEXT, note TEXT,
        UNIQUE (type, product_id, reference_id)
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        category TEXT NOT NULL CHECK (category IN ('sale', 'purchase', 'other')),
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
        transaction_date TEXT NOT NULL, reference_id TEXT, description TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
        UNIQUE (category, reference_id)
      );
    `)
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
