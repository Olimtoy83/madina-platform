import { afterEach, describe, expect, it } from 'vitest'
import type { TransactionalSnapshot } from './transactionalStorage'
import {
  commitTransactionalSnapshot,
  getNextSnapshot,
  loadTransactionalSnapshot,
  TransactionalPersistenceError,
} from './transactionalStorage'
import {
  completePurchaseSnapshot,
  completeSaleSnapshot,
  createCompletionGuard,
} from './transactionalCompletion'

class StorageDouble {
  values = new Map<string, string>()
  failWrites = false

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('full')
    this.values.set(key, value)
  }
}

const snapshotKey = 'madina-crm:v2:transactional-state'
const originalStorage = globalThis.localStorage

function makeSnapshot(): TransactionalSnapshot {
  const now = new Date('2026-08-19T00:00:00.000Z')
  return {
    schemaVersion: 2,
    revision: 0,
    products: [{
      id: 'product-1', createdAt: now, updatedAt: now,
      name: 'Dates', category: 'dates', quantity: 10, unit: 'piece',
      costPrice: 5, salePrice: 10, status: 'active',
    }],
    sales: [{
      id: 'sale-1', createdAt: now, updatedAt: now, saleNumber: 'SAL-1',
      saleDate: now, clientName: 'Client', items: [{
        productId: 'product-1', quantity: 2, unit: 'piece', unitPrice: 10, totalAmount: 20,
      }], totalAmount: 20, paymentMethod: 'cash', status: 'draft',
    }],
    purchases: [{
      id: 'purchase-1', createdAt: now, updatedAt: now, purchaseNumber: 'PUR-1',
      purchaseDate: now, supplierName: 'Supplier', items: [{
        productId: 'product-1', quantity: 2, unit: 'piece', unitCost: 5, totalCost: 10,
      }], totalAmount: 10, paymentMethod: 'cash', status: 'draft',
    }],
    stockMovements: [],
    transactions: [],
  }
}

function installStorage(storage: StorageDouble) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
})

describe('transactional snapshot storage', () => {
  it('commits and restores every transactional slice with dates', () => {
    const storage = new StorageDouble()
    installStorage(storage)
    const snapshot = getNextSnapshot(makeSnapshot(), {})
    commitTransactionalSnapshot(snapshot)

    expect(JSON.parse(storage.getItem(snapshotKey)!)).toMatchObject({ schemaVersion: 2, revision: 1 })
    const loaded = loadTransactionalSnapshot()
    expect(loaded.source).toBe('v2')
    expect(loaded.snapshot).toMatchObject({ revision: 1 })
    expect(loaded.snapshot.sales[0].saleDate).toBeInstanceOf(Date)
    expect(loaded.snapshot.purchases[0].purchaseDate).toBeInstanceOf(Date)
    expect(loaded.snapshot.products).toHaveLength(1)
  })

  it('keeps the previous commit when a write fails', () => {
    const storage = new StorageDouble()
    installStorage(storage)
    const initial = makeSnapshot()
    commitTransactionalSnapshot(initial)
    storage.failWrites = true

    expect(() => commitTransactionalSnapshot(getNextSnapshot(initial, {}))).toThrow(TransactionalPersistenceError)
    expect(loadTransactionalSnapshot().snapshot.revision).toBe(0)
  })

  it('rejects corrupted v2 without falling back to v1', () => {
    const storage = new StorageDouble()
    storage.values.set(snapshotKey, '{bad json')
    storage.values.set('madina-crm:v1:products', JSON.stringify([]))
    installStorage(storage)
    expect(() => loadTransactionalSnapshot()).toThrow(TransactionalPersistenceError)
  })

  it('bootstraps raw v1 data only while v2 is absent and then prefers v2', () => {
    const storage = new StorageDouble()
    const legacy = makeSnapshot()
    storage.values.set('madina-crm:v1:products', JSON.stringify(legacy.products))
    storage.values.set('madina-crm:v1:sales', JSON.stringify(legacy.sales))
    storage.values.set('madina-crm:v1:purchases', JSON.stringify(legacy.purchases))
    storage.values.set('madina-crm:v1:stock-movements', '[]')
    storage.values.set('madina-crm:v1:transactions', '[]')
    installStorage(storage)
    expect(loadTransactionalSnapshot().source).toBe('v1')
    commitTransactionalSnapshot(getNextSnapshot(legacy, { products: [] }))
    expect(loadTransactionalSnapshot().snapshot.products).toEqual([])
  })

  it('calculates coherent sale and purchase completion snapshots', () => {
    const snapshot = makeSnapshot()
    const sale = completeSaleSnapshot(snapshot, 'sale-1')
    const purchase = completePurchaseSnapshot(snapshot, 'purchase-1')
    expect(sale.snapshot).toMatchObject({ revision: 1 })
    expect(sale.snapshot?.sales[0].status).toBe('completed')
    expect(sale.snapshot?.products[0].quantity).toBe(8)
    expect(sale.snapshot?.stockMovements).toHaveLength(1)
    expect(sale.snapshot?.transactions).toHaveLength(1)
    expect(purchase.snapshot?.purchases[0].status).toBe('completed')
    expect(purchase.snapshot?.products[0].quantity).toBe(12)
  })

  it('does not publish a Sale or Purchase completion when persistence fails', () => {
    const storage = new StorageDouble()
    installStorage(storage)
    const snapshot = makeSnapshot()
    commitTransactionalSnapshot(snapshot)
    storage.failWrites = true

    const sale = completeSaleSnapshot(snapshot, 'sale-1')
    const purchase = completePurchaseSnapshot(snapshot, 'purchase-1')

    expect(() => commitTransactionalSnapshot(sale.snapshot!)).toThrow(TransactionalPersistenceError)
    expect(() => commitTransactionalSnapshot(purchase.snapshot!)).toThrow(TransactionalPersistenceError)
    expect(snapshot.sales[0].status).toBe('draft')
    expect(snapshot.purchases[0].status).toBe('draft')
    expect(loadTransactionalSnapshot().snapshot).toMatchObject({ revision: 0 })
  })

  it('prevents an in-flight duplicate completion until it finishes', () => {
    const guard = createCompletionGuard()
    expect(guard.begin('sale-1')).toBe(true)
    expect(guard.begin('sale-1')).toBe(false)
    guard.finish('sale-1')
    expect(guard.begin('sale-1')).toBe(true)
  })
})
