import type {
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'

const SNAPSHOT_KEY = 'madina-crm:v2:transactional-state'
const SCHEMA_VERSION = 2

export class TransactionalPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransactionalPersistenceError'
  }
}

export interface TransactionalSnapshot {
  schemaVersion: number
  revision: number
  products: Product[]
  sales: Sale[]
  purchases: Purchase[]
  stockMovements: StockMovement[]
  transactions: Transaction[]
}

export type TransactionalSnapshotSource = 'v1' | 'v2'

export interface LoadedTransactionalSnapshot {
  snapshot: TransactionalSnapshot
  source: TransactionalSnapshotSource
}

type StoredProduct = Omit<Product, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}

type StoredSale = Omit<Sale, 'createdAt' | 'updatedAt' | 'saleDate'> & {
  createdAt: string
  updatedAt: string
  saleDate: string
}

type StoredPurchase = Omit<
  Purchase,
  'createdAt' | 'updatedAt' | 'purchaseDate'
> & {
  createdAt: string
  updatedAt: string
  purchaseDate: string
}

type StoredStockMovement = Omit<
  StockMovement,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

type StoredTransaction = Omit<
  Transaction,
  'createdAt' | 'updatedAt' | 'transactionDate'
> & {
  createdAt: string
  updatedAt: string
  transactionDate: string
}

type StoredSnapshot = Omit<
  TransactionalSnapshot,
  | 'products'
  | 'sales'
  | 'purchases'
  | 'stockMovements'
  | 'transactions'
> & {
  products: StoredProduct[]
  sales: StoredSale[]
  purchases: StoredPurchase[]
  stockMovements: StoredStockMovement[]
  transactions: StoredTransaction[]
}

function restoreProduct(product: StoredProduct): Product {
  return {
    ...product,
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
  }
}

function restoreSale(sale: StoredSale): Sale {
  return {
    ...sale,
    createdAt: new Date(sale.createdAt),
    updatedAt: new Date(sale.updatedAt),
    saleDate: new Date(sale.saleDate),
  }
}

function restorePurchase(purchase: StoredPurchase): Purchase {
  return {
    ...purchase,
    createdAt: new Date(purchase.createdAt),
    updatedAt: new Date(purchase.updatedAt),
    purchaseDate: new Date(purchase.purchaseDate),
  }
}

function restoreMovement(
  movement: StoredStockMovement,
): StockMovement {
  return {
    ...movement,
    createdAt: new Date(movement.createdAt),
    updatedAt: new Date(movement.updatedAt),
  }
}

function restoreTransaction(
  transaction: StoredTransaction,
): Transaction {
  return {
    ...transaction,
    createdAt: new Date(transaction.createdAt),
    updatedAt: new Date(transaction.updatedAt),
    transactionDate: new Date(transaction.transactionDate),
  }
}

function isStoredSnapshot(value: unknown): value is StoredSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }

  const snapshot = value as Partial<StoredSnapshot>

  return snapshot.schemaVersion === SCHEMA_VERSION &&
    typeof snapshot.revision === 'number' &&
    Number.isInteger(snapshot.revision) &&
    snapshot.revision >= 0 &&
    Array.isArray(snapshot.products) &&
    Array.isArray(snapshot.sales) &&
    Array.isArray(snapshot.purchases) &&
    Array.isArray(snapshot.stockMovements) &&
    Array.isArray(snapshot.transactions)
}

function restoreSnapshot(snapshot: StoredSnapshot): TransactionalSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: snapshot.revision,
    products: snapshot.products.map(restoreProduct),
    sales: snapshot.sales.map(restoreSale),
    purchases: snapshot.purchases.map(restorePurchase),
    stockMovements: snapshot.stockMovements.map(restoreMovement),
    transactions: snapshot.transactions.map(restoreTransaction),
  }
}

function loadLegacySlice<T>(key: string): T[] {
  try {
    const value = localStorage.getItem(`madina-crm:v1:${key}`)
    return value ? JSON.parse(value) as T[] : []
  } catch {
    return []
  }
}

function loadLegacySnapshot(): TransactionalSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    products: loadLegacySlice<StoredProduct>('products').map(restoreProduct),
    sales: loadLegacySlice<StoredSale>('sales').map(restoreSale),
    purchases: loadLegacySlice<StoredPurchase>('purchases').map(restorePurchase),
    stockMovements: loadLegacySlice<StoredStockMovement>('stock-movements').map(restoreMovement),
    transactions: loadLegacySlice<StoredTransaction>('transactions').map(restoreTransaction),
  }
}

export function loadTransactionalSnapshot(): LoadedTransactionalSnapshot {
  let rawSnapshot: string | null

  try {
    rawSnapshot = localStorage.getItem(SNAPSHOT_KEY)
  } catch (error) {
    throw new TransactionalPersistenceError(
      'Не удалось прочитать transactional snapshot.',
      { cause: error },
    )
  }

  if (!rawSnapshot) {
    return {
      snapshot: loadLegacySnapshot(),
      source: 'v1',
    }
  }

  try {
    const storedSnapshot = JSON.parse(rawSnapshot) as unknown

    if (!isStoredSnapshot(storedSnapshot)) {
      throw new Error('Invalid transactional snapshot envelope.')
    }

    return {
      snapshot: restoreSnapshot(storedSnapshot),
      source: 'v2',
    }
  } catch (error) {
    throw new TransactionalPersistenceError(
      'Authoritative transactional snapshot повреждён и не может быть восстановлен.',
      { cause: error },
    )
  }
}

export function commitTransactionalSnapshot(
  snapshot: TransactionalSnapshot,
): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch (error) {
    throw new TransactionalPersistenceError(
      'Не удалось сохранить transactional snapshot.',
      { cause: error },
    )
  }
}

export function getNextSnapshot(
  snapshot: TransactionalSnapshot,
  updates: Partial<Omit<TransactionalSnapshot, 'schemaVersion' | 'revision'>>,
): TransactionalSnapshot {
  return {
    ...snapshot,
    ...updates,
    schemaVersion: SCHEMA_VERSION,
    revision: snapshot.revision + 1,
  }
}
