import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { bootstrapCommerceToServer } from './commerceServerBootstrap'

class StorageDouble {
  values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const snapshotStorageKey =
  'madina-crm:v2:transactional-state'
const migrationMarkerKey =
  'madina-crm:migration:commerce-to-server:v1'
const originalStorage = globalThis.localStorage

function installStorage(storage: StorageDouble) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

function installFetch(responseBody: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function createSnapshot() {
  const timestamp = '2026-08-27T00:00:00.000Z'

  return {
    schemaVersion: 3,
    revision: 12,
    products: [{
      id: 'product-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      name: 'Финики',
      category: 'dates',
      quantity: 5,
      unit: 'kg',
      costPrice: 10,
      salePrice: 15,
      status: 'active',
    }],
    purchases: [{
      id: 'purchase-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      purchaseNumber: 'PUR-0001',
      purchaseDate: timestamp,
      supplierName: 'Поставщик',
      items: [{
        productId: 'product-1',
        quantity: 5,
        unit: 'kg',
        unitCost: 10,
        totalCost: 50,
      }],
      totalAmount: 50,
      paymentMethod: 'cash',
      status: 'completed',
    }],
    sales: [],
    stockMovements: [{
      id: 'movement-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      productId: 'product-1',
      type: 'purchase',
      quantity: 5,
      unit: 'kg',
      referenceId: 'purchase-1',
    }],
    transactions: [{
      id: 'transaction-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      type: 'expense',
      category: 'purchase',
      amount: 50,
      paymentMethod: 'cash',
      transactionDate: timestamp,
      referenceId: 'purchase-1',
      description: 'Поступление PUR-0001',
      status: 'completed',
    }],
  }
}

function storeSnapshot(
  storage: StorageDouble,
  snapshot = createSnapshot(),
) {
  storage.setItem(
    snapshotStorageKey,
    JSON.stringify(snapshot),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalStorage,
  })
})

describe('commerceServerBootstrap', () => {
  it('imports the authoritative snapshot and writes its marker after success', async () => {
    const storage = new StorageDouble()
    storeSnapshot(storage)
    installStorage(storage)
    const fetchMock = installFetch({
      imported: true,
      idempotent: false,
    })

    const result = await bootstrapCommerceToServer()

    expect(result).toEqual({
      skipped: false,
      imported: true,
      idempotent: false,
    })
    expect(storage.getItem(migrationMarkerKey)).toBe('done')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/commerce/import')
    expect(options?.method).toBe('POST')

    expect(JSON.parse(options?.body as string)).toEqual({
      products: createSnapshot().products,
      stockMovements: createSnapshot().stockMovements,
      purchases: createSnapshot().purchases,
      sales: createSnapshot().sales,
      transactions: createSnapshot().transactions,
    })
  })

  it('does not write a marker when the import fails', async () => {
    const storage = new StorageDouble()
    storeSnapshot(storage)
    installStorage(storage)
    installFetch({ message: 'Import failed' }, 500)

    await expect(bootstrapCommerceToServer()).rejects.toMatchObject({
      status: 500,
      message: 'Import failed',
    })

    expect(storage.getItem(migrationMarkerKey)).toBeNull()
    expect(storage.getItem(snapshotStorageKey)).not.toBeNull()
  })

  it('is safe to run again after a successful bootstrap', async () => {
    const storage = new StorageDouble()
    storeSnapshot(storage)
    installStorage(storage)
    const fetchMock = installFetch({
      imported: false,
      idempotent: true,
    })

    const first = await bootstrapCommerceToServer()
    const repeated = await bootstrapCommerceToServer()

    expect(first).toEqual({
      skipped: false,
      imported: false,
      idempotent: true,
    })
    expect(repeated).toEqual({
      skipped: true,
      imported: false,
      idempotent: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('imports an empty authoritative snapshot before marking it migrated', async () => {
    const storage = new StorageDouble()
    storeSnapshot(storage, {
      schemaVersion: 3,
      revision: 0,
      products: [],
      purchases: [],
      sales: [],
      stockMovements: [],
      transactions: [],
    })
    installStorage(storage)
    const fetchMock = installFetch({
      imported: true,
      idempotent: false,
    })

    const result = await bootstrapCommerceToServer()

    expect(result).toEqual({
      skipped: false,
      imported: true,
      idempotent: false,
    })
    expect(storage.getItem(migrationMarkerKey)).toBe('done')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      products: [],
      stockMovements: [],
      purchases: [],
      sales: [],
      transactions: [],
    })
  })

  it('keeps the authoritative local snapshot after importing it', async () => {
    const storage = new StorageDouble()
    const snapshot = createSnapshot()
    const rawSnapshot = JSON.stringify(snapshot)
    storage.setItem(snapshotStorageKey, rawSnapshot)
    installStorage(storage)
    installFetch({ imported: true, idempotent: false })

    await bootstrapCommerceToServer()

    expect(storage.getItem(snapshotStorageKey)).toBe(rawSnapshot)
  })
})
