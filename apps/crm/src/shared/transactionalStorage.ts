import type {
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'

const SNAPSHOT_KEY = 'madina-crm:v2:transactional-state'
const SCHEMA_VERSION = 3
const LEGACY_TRANSACTIONAL_SCHEMA_VERSION = 2
const BALANCE_EPSILON = 1e-9

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

export type TransactionalSnapshotSource =
  | 'v1'
  | 'v2'
  | 'v3'

export interface LoadedTransactionalSnapshot {
  snapshot: TransactionalSnapshot
  source: TransactionalSnapshotSource
}

type StoredProduct = Omit<
  Product,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

type StoredSale = Omit<
  Sale,
  'createdAt' | 'updatedAt' | 'saleDate'
> & {
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

function restoreProduct(
  product: StoredProduct,
): Product {
  return {
    ...product,
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
  }
}

function restoreSale(
  sale: StoredSale,
): Sale {
  return {
    ...sale,
    createdAt: new Date(sale.createdAt),
    updatedAt: new Date(sale.updatedAt),
    saleDate: new Date(sale.saleDate),
  }
}

function restorePurchase(
  purchase: StoredPurchase,
): Purchase {
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
    transactionDate: new Date(
      transaction.transactionDate,
    ),
  }
}

function isStoredSnapshotEnvelope(
  value: unknown,
): value is StoredSnapshot {
  if (!value || typeof value !== 'object') {
    return false
  }

  const snapshot =
    value as Partial<StoredSnapshot>

  return (
    (
      snapshot.schemaVersion ===
        LEGACY_TRANSACTIONAL_SCHEMA_VERSION ||
      snapshot.schemaVersion ===
        SCHEMA_VERSION
    ) &&
    typeof snapshot.revision === 'number' &&
    Number.isInteger(snapshot.revision) &&
    snapshot.revision >= 0 &&
    Array.isArray(snapshot.products) &&
    Array.isArray(snapshot.sales) &&
    Array.isArray(snapshot.purchases) &&
    Array.isArray(snapshot.stockMovements) &&
    Array.isArray(snapshot.transactions)
  )
}

function restoreSnapshot(
  snapshot: StoredSnapshot,
): TransactionalSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: snapshot.revision,
    products: snapshot.products.map(restoreProduct),
    sales: snapshot.sales.map(restoreSale),
    purchases: snapshot.purchases.map(restorePurchase),
    stockMovements:
      snapshot.stockMovements.map(restoreMovement),
    transactions:
      snapshot.transactions.map(restoreTransaction),
  }
}

function migrateLegacyBalances(
  snapshot: TransactionalSnapshot,
): TransactionalSnapshot {
  const movements = [
    ...snapshot.stockMovements,
  ]

  for (const product of snapshot.products) {
    const movementQuantity = movements
      .filter(
        (movement) =>
          movement.productId === product.id,
      )
      .reduce(
        (total, movement) =>
          total + movement.quantity,
        0,
      )

    const balanceDifference =
      product.quantity - movementQuantity

    if (
      Math.abs(balanceDifference) <=
      BALANCE_EPSILON
    ) {
      continue
    }

    const migrationReferenceId =
      `legacy-balance:${product.id}`

    const alreadyMigrated =
      movements.some(
        (movement) =>
          movement.referenceId ===
          migrationReferenceId,
      )

    if (alreadyMigrated) {
      continue
    }

    movements.push({
      id: `legacy-balance-${product.id}`,
      productId: product.id,
      type: 'adjustment',
      quantity: balanceDifference,
      unit: product.unit,
      referenceId: migrationReferenceId,
      note: 'Миграция начального остатка',
      createdAt: product.createdAt,
      updatedAt: product.createdAt,
    })
  }

  return {
    ...snapshot,
    schemaVersion: SCHEMA_VERSION,
    stockMovements: movements,
  }
}

function loadLegacySlice<T>(
  key: string,
): T[] {
  try {
    const value = localStorage.getItem(
      `madina-crm:v1:${key}`,
    )

    return value
      ? JSON.parse(value) as T[]
      : []
  } catch {
    return []
  }
}

function loadLegacySnapshot():
  TransactionalSnapshot {
  const snapshot: TransactionalSnapshot = {
    schemaVersion:
      LEGACY_TRANSACTIONAL_SCHEMA_VERSION,
    revision: 0,
    products:
      loadLegacySlice<StoredProduct>(
        'products',
      ).map(restoreProduct),
    sales:
      loadLegacySlice<StoredSale>(
        'sales',
      ).map(restoreSale),
    purchases:
      loadLegacySlice<StoredPurchase>(
        'purchases',
      ).map(restorePurchase),
    stockMovements:
      loadLegacySlice<StoredStockMovement>(
        'stock-movements',
      ).map(restoreMovement),
    transactions:
      loadLegacySlice<StoredTransaction>(
        'transactions',
      ).map(restoreTransaction),
  }

  return migrateLegacyBalances(snapshot)
}

export function loadTransactionalSnapshot():
  LoadedTransactionalSnapshot {
  let rawSnapshot: string | null

  try {
    rawSnapshot =
      localStorage.getItem(
        SNAPSHOT_KEY,
      )
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
    const storedSnapshot =
      JSON.parse(rawSnapshot) as unknown

    if (
      !isStoredSnapshotEnvelope(
        storedSnapshot,
      )
    ) {
      throw new Error(
        'Invalid transactional snapshot envelope.',
      )
    }

    const restoredSnapshot =
      restoreSnapshot(storedSnapshot)

    if (
      restoredSnapshot.schemaVersion ===
      LEGACY_TRANSACTIONAL_SCHEMA_VERSION
    ) {
      return {
        snapshot:
          migrateLegacyBalances(
            restoredSnapshot,
          ),
        source: 'v2',
      }
    }

    return {
      snapshot: restoredSnapshot,
      source: 'v3',
    }
  } catch (error) {
    throw new TransactionalPersistenceError(
      'Authoritative transactional snapshot повреждён и не может быть восстановлен.',
      { cause: error },
    )
  }
}
