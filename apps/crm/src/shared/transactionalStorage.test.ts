import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import type { TransactionalSnapshot } from './transactionalStorage'
import {
  loadTransactionalSnapshot,
  TransactionalPersistenceError,
} from './transactionalStorage'

class StorageDouble {
  values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }
}

const snapshotKey = 'madina-crm:v2:transactional-state'
const originalStorage = globalThis.localStorage

function makeSnapshot(): TransactionalSnapshot {
  const now = new Date('2026-08-19T00:00:00.000Z')

  return {
    schemaVersion: 3,
    revision: 0,
    products: [{
      id: 'product-1', createdAt: now, updatedAt: now,
      name: 'Dates', category: 'dates', quantity: 10, unit: 'piece',
      costPrice: 5, salePrice: 10, status: 'active',
    }],
    sales: [{
      id: 'sale-1', createdAt: now, updatedAt: now, saleNumber: 'SAL-1',
      saleDate: now, clientName: 'Client',
      items: [{ productId: 'product-1', quantity: 2, unit: 'piece', unitPrice: 10, totalAmount: 20 }],
      totalAmount: 20, paymentMethod: 'cash', status: 'draft',
    }],
    purchases: [{
      id: 'purchase-1', createdAt: now, updatedAt: now, purchaseNumber: 'PUR-1',
      purchaseDate: now, supplierName: 'Supplier',
      items: [{ productId: 'product-1', quantity: 2, unit: 'piece', unitCost: 5, totalCost: 10 }],
      totalAmount: 10, paymentMethod: 'cash', status: 'draft',
    }],
    stockMovements: [],
    transactions: [],
  }
}

function installStorage(storage: StorageDouble) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalStorage,
  })
})

describe('transactional snapshot compatibility reader', () => {
  it('restores v3 snapshot dates for commerce bootstrap', () => {
    const storage = new StorageDouble()
    storage.values.set(snapshotKey, JSON.stringify(makeSnapshot()))
    installStorage(storage)

    const loaded = loadTransactionalSnapshot()

    expect(loaded.source).toBe('v3')
    expect(loaded.snapshot.products[0]?.createdAt).toBeInstanceOf(Date)
    expect(loaded.snapshot.sales[0]?.saleDate).toBeInstanceOf(Date)
    expect(loaded.snapshot.purchases[0]?.purchaseDate).toBeInstanceOf(Date)
  })

  it('rejects a corrupted snapshot without falling back to v1', () => {
    const storage = new StorageDouble()
    storage.values.set(snapshotKey, '{bad json')
    storage.values.set('madina-crm:v1:products', JSON.stringify([]))
    installStorage(storage)

    expect(() => loadTransactionalSnapshot()).toThrow(TransactionalPersistenceError)
  })

  it('migrates v2 stock balance without duplicate movement', () => {
    const storage = new StorageDouble()
    const snapshot = makeSnapshot()
    storage.values.set(snapshotKey, JSON.stringify({
      ...snapshot,
      schemaVersion: 2,
      products: [{ ...snapshot.products[0]!, quantity: 12 }],
      stockMovements: [{
        id: 'movement-1', createdAt: snapshot.products[0]!.createdAt,
        updatedAt: snapshot.products[0]!.updatedAt, productId: 'product-1',
        type: 'adjustment', quantity: 7, unit: 'piece',
      }],
    }))
    installStorage(storage)

    const loaded = loadTransactionalSnapshot()
    const migrationMovements = loaded.snapshot.stockMovements.filter(
      (movement) => movement.referenceId === 'legacy-balance:product-1',
    )

    expect(loaded.source).toBe('v2')
    expect(migrationMovements).toHaveLength(1)
    expect(migrationMovements[0]?.quantity).toBe(5)
  })

  it('reads raw v1 slices when no transactional snapshot exists', () => {
    const storage = new StorageDouble()
    const snapshot = makeSnapshot()
    storage.values.set('madina-crm:v1:products', JSON.stringify(snapshot.products))
    storage.values.set('madina-crm:v1:sales', JSON.stringify(snapshot.sales))
    storage.values.set('madina-crm:v1:purchases', JSON.stringify(snapshot.purchases))
    storage.values.set('madina-crm:v1:stock-movements', '[]')
    storage.values.set('madina-crm:v1:transactions', '[]')
    installStorage(storage)

    const loaded = loadTransactionalSnapshot()

    expect(loaded.source).toBe('v1')
    expect(loaded.snapshot.products).toHaveLength(1)
    expect(loaded.snapshot.sales[0]?.saleDate).toBeInstanceOf(Date)
  })
})
