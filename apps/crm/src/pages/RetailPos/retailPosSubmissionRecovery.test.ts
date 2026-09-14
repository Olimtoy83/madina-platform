import { describe, expect, it, vi } from 'vitest'
import {
  clearPendingPosSaleSubmission,
  loadPendingPosSaleSubmission,
  POS_PENDING_SALE_STORAGE_KEY,
  savePendingPosSaleSubmission,
  type PendingPosSaleSubmission,
  type PosSubmissionRecoveryStorage,
} from './retailPosSubmissionRecovery'

class StorageDouble implements PosSubmissionRecoveryStorage {
  readonly values = new Map<string, string>()
  readError = false
  writeError = false
  removeError = false

  getItem(key: string): string | null {
    if (this.readError) throw new Error('read failed')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.writeError) throw new Error('write failed')
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.removeError) throw new Error('remove failed')
    this.values.delete(key)
  }
}

function createSnapshot(): PendingPosSaleSubmission {
  return {
    schemaVersion: 1,
    ownerUserId: 'user-1',
    locationId: 'location-1',
    payload: {
      clientOperationId: 'operation-1',
      saleId: 'sale-1',
      lines: [{ id: 'line-1', productId: 'product-1', quantity: 2 }],
      allocations: [{
        id: 'allocation-1', method: 'cash', amountMinor: 12345, ordinal: 0,
      }],
    },
  }
}

function storeRaw(storage: StorageDouble, value: unknown): void {
  storage.values.set(POS_PENDING_SALE_STORAGE_KEY, JSON.stringify(value))
}

describe('retail POS submission recovery', () => {
  it('saves and loads an exact logical snapshot without calling network code', () => {
    const storage = new StorageDouble()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(savePendingPosSaleSubmission(createSnapshot(), storage).status).toBe('saved')
    expect(loadPendingPosSaleSubmission('user-1', storage)).toEqual({
      status: 'pending',
      snapshot: createSnapshot(),
    })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('does not mutate input and returns a deeply frozen loaded snapshot', () => {
    const storage = new StorageDouble()
    const input = createSnapshot()
    expect(savePendingPosSaleSubmission(input, storage).status).toBe('saved')
    input.payload.lines[0]!.quantity = 9

    const loaded = loadPendingPosSaleSubmission('user-1', storage)
    expect(loaded.status).toBe('pending')
    if (loaded.status !== 'pending') return
    expect(loaded.snapshot.payload.lines[0]?.quantity).toBe(2)
    expect(Object.isFrozen(loaded.snapshot)).toBe(true)
    expect(Object.isFrozen(loaded.snapshot.payload)).toBe(true)
    expect(Object.isFrozen(loaded.snapshot.payload.lines)).toBe(true)
    expect(Object.isFrozen(loaded.snapshot.payload.lines[0]!)).toBe(true)
  })

  it('persists only the approved recovery schema', () => {
    const storage = new StorageDouble()
    expect(savePendingPosSaleSubmission(createSnapshot(), storage).status).toBe('saved')
    const raw = storage.values.get(POS_PENDING_SALE_STORAGE_KEY)!
    expect(raw).not.toContain('amountText')
    expect(raw).not.toContain('totalMinor')
    expect(raw).not.toContain('productName')
    expect(raw).not.toContain('priceSnapshot')
  })

  it.each([
    ['malformed JSON', '{invalid json'],
    ['unsupported version', { ...createSnapshot(), schemaVersion: 2 }],
    ['missing owner', { ...createSnapshot(), ownerUserId: '' }],
    ['unsafe quantity', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, lines: [{ id: 'line-1', productId: 'product-1', quantity: Number.MAX_SAFE_INTEGER + 1 }] },
    }],
    ['unsafe amount', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'cash', amountMinor: Number.MAX_SAFE_INTEGER + 1, ordinal: 0 }] },
    }],
    ['negative ordinal', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'cash', amountMinor: 1, ordinal: -1 }] },
    }],
    ['duplicate line IDs', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, lines: [{ id: 'line-1', productId: 'product-1', quantity: 1 }, { id: 'line-1', productId: 'product-2', quantity: 1 }] },
    }],
    ['duplicate Product IDs', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, lines: [{ id: 'line-1', productId: 'product-1', quantity: 1 }, { id: 'line-2', productId: 'product-1', quantity: 1 }] },
    }],
    ['duplicate allocation IDs', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'cash', amountMinor: 1, ordinal: 0 }, { id: 'allocation-1', method: 'card', amountMinor: 1, ordinal: 1 }] },
    }],
    ['duplicate ordinals', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'cash', amountMinor: 1, ordinal: 0 }, { id: 'allocation-2', method: 'card', amountMinor: 1, ordinal: 0 }] },
    }],
    ['out of order ordinals', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'cash', amountMinor: 1, ordinal: 1 }] },
    }],
    ['unsupported method', {
      ...createSnapshot(),
      payload: { ...createSnapshot().payload, allocations: [{ id: 'allocation-1', method: 'voucher', amountMinor: 1, ordinal: 0 }] },
    }],
  ])('loads %s as invalid', (_name, invalid) => {
    const storage = new StorageDouble()
    if (typeof invalid === 'string') {
      storage.values.set(POS_PENDING_SALE_STORAGE_KEY, invalid)
    } else {
      storeRaw(storage, invalid)
    }

    expect(loadPendingPosSaleSubmission('user-1', storage)).toEqual({ status: 'invalid' })
    expect(savePendingPosSaleSubmission(createSnapshot(), storage)).toEqual({ status: 'invalid' })
  })

  it('reports a valid snapshot of another user as foreign and never overwrites it', () => {
    const storage = new StorageDouble()
    const foreign = { ...createSnapshot(), ownerUserId: 'user-2' }
    expect(savePendingPosSaleSubmission(foreign, storage).status).toBe('saved')

    expect(loadPendingPosSaleSubmission('user-1', storage)).toEqual({ status: 'foreign-owner' })
    expect(savePendingPosSaleSubmission(createSnapshot(), storage)).toEqual({ status: 'already-pending' })
    expect(loadPendingPosSaleSubmission('user-2', storage).status).toBe('pending')
  })

  it('reports missing storage as none and keeps a pending record indefinitely', () => {
    const storage = new StorageDouble()
    expect(loadPendingPosSaleSubmission('user-1', storage)).toEqual({ status: 'none' })
    expect(savePendingPosSaleSubmission(createSnapshot(), storage).status).toBe('saved')
    expect(loadPendingPosSaleSubmission('user-1', storage).status).toBe('pending')
  })

  it('returns explicit storage errors for read, write, and remove failures', () => {
    const readFailure = new StorageDouble()
    readFailure.readError = true
    expect(loadPendingPosSaleSubmission('user-1', readFailure)).toEqual({ status: 'storage-error' })

    const writeFailure = new StorageDouble()
    writeFailure.writeError = true
    expect(savePendingPosSaleSubmission(createSnapshot(), writeFailure)).toEqual({ status: 'storage-error' })

    const removeFailure = new StorageDouble()
    expect(savePendingPosSaleSubmission(createSnapshot(), removeFailure).status).toBe('saved')
    removeFailure.removeError = true
    expect(clearPendingPosSaleSubmission('user-1', 'operation-1', removeFailure))
      .toEqual({ status: 'storage-error' })
  })

  it('clears only the matching owner and client operation from a valid record', () => {
    const storage = new StorageDouble()
    expect(savePendingPosSaleSubmission(createSnapshot(), storage).status).toBe('saved')

    expect(clearPendingPosSaleSubmission('user-2', 'operation-1', storage))
      .toEqual({ status: 'foreign-owner' })
    expect(clearPendingPosSaleSubmission('user-1', 'different-operation', storage))
      .toEqual({ status: 'different-attempt' })
    expect(clearPendingPosSaleSubmission('user-1', 'operation-1', storage))
      .toEqual({ status: 'cleared' })
    expect(clearPendingPosSaleSubmission('user-1', 'operation-1', storage))
      .toEqual({ status: 'none' })
  })

  it('refuses to clear a corrupt record', () => {
    const storage = new StorageDouble()
    storage.values.set(POS_PENDING_SALE_STORAGE_KEY, '{corrupt')

    expect(clearPendingPosSaleSubmission('user-1', 'operation-1', storage))
      .toEqual({ status: 'invalid' })
    expect(storage.values.has(POS_PENDING_SALE_STORAGE_KEY)).toBe(true)
  })
})
