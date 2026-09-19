import { describe, expect, it } from 'vitest'
import { clearPendingPosReturnSubmission, loadPendingPosReturnSubmission, POS_PENDING_RETURN_STORAGE_KEY, savePendingPosReturnSubmission, type PosReturnRecoveryStorage } from './retailPosReturnRecovery'

class StorageDouble implements PosReturnRecoveryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function snapshot() { return { schemaVersion: 1 as const, ownerUserId: 'user-1', locationId: 'location-1', payload: { clientOperationId: 'operation-1', saleId: 'sale-1', items: [{ saleItemId: 'item-1', quantity: 2 }] } } }

describe('retail POS Return recovery', () => {
  it('persists only immutable Return intent without monetary or refund data', () => {
    const storage = new StorageDouble()
    expect(savePendingPosReturnSubmission(snapshot(), storage).status).toBe('saved')
    const raw = storage.values.get(POS_PENDING_RETURN_STORAGE_KEY)!
    expect(raw).not.toContain('amount')
    expect(raw).not.toContain('method')
    expect(loadPendingPosReturnSubmission('user-1', storage)).toEqual({ status: 'pending', snapshot: snapshot() })
  })

  it('fails closed for foreign, malformed, and unrelated clear attempts', () => {
    const storage = new StorageDouble()
    expect(savePendingPosReturnSubmission(snapshot(), storage).status).toBe('saved')
    expect(loadPendingPosReturnSubmission('user-2', storage)).toEqual({ status: 'foreign-owner' })
    expect(clearPendingPosReturnSubmission('user-1', 'other', storage)).toEqual({ status: 'different-attempt' })
    expect(storage.values.has(POS_PENDING_RETURN_STORAGE_KEY)).toBe(true)
    storage.values.set(POS_PENDING_RETURN_STORAGE_KEY, '{bad')
    expect(loadPendingPosReturnSubmission('user-1', storage)).toEqual({ status: 'invalid' })
  })

  it('rejects duplicate or unsafe items and clears only the exact matching snapshot', () => {
    const storage = new StorageDouble()
    expect(savePendingPosReturnSubmission({ ...snapshot(), payload: { ...snapshot().payload, items: [{ saleItemId: 'item-1', quantity: 1 }, { saleItemId: 'item-1', quantity: 1 }] } }, storage)).toEqual({ status: 'invalid' })
    expect(savePendingPosReturnSubmission(snapshot(), storage).status).toBe('saved')
    expect(clearPendingPosReturnSubmission('user-1', 'operation-1', storage)).toEqual({ status: 'cleared' })
  })
})
