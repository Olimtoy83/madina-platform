import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../shared/api/httpClient'
import type { PendingPosReturnSubmission } from './retailPosReturnRecovery'
import { createPosReturnIntent, retryPendingPosReturn, submitPosReturn } from './retailPosReturnSubmission'

function snapshot(): PendingPosReturnSubmission { return { schemaVersion: 1, ownerUserId: 'user-1', locationId: 'location-1', payload: { clientOperationId: 'operation-1', saleId: 'sale-1', items: [{ saleItemId: 'item-1', quantity: 1 }] } } }
function dependencies() { return { saveSnapshot: vi.fn(() => ({ status: 'saved' as const, snapshot: Object.freeze(snapshot()) })), complete: vi.fn(async () => ({ status: 201 as const, body: { saleReturn: { id: 'return-1', original_sale_id: 'sale-1', completed_at: 'now' }, items: [], refundAllocations: [], movements: [] } })), clearSnapshot: vi.fn(() => ({ status: 'cleared' as const })), isCurrent: vi.fn(() => true) } }

describe('retail POS Return submission', () => {
  it('creates a new normalized intent when Sale, Location, or items change', () => {
    expect(createPosReturnIntent({ locationId: 'location-1', saleId: 'sale-1', items: [{ saleItemId: 'b', quantity: 1 }, { saleItemId: 'a', quantity: 2 }], createId: () => 'operation-a' })).toEqual({ clientOperationId: 'operation-a', saleId: 'sale-1', items: [{ saleItemId: 'a', quantity: 2 }, { saleItemId: 'b', quantity: 1 }] })
    expect(createPosReturnIntent({ locationId: 'location-2', saleId: 'sale-2', items: [{ saleItemId: 'a', quantity: 1 }], createId: () => 'operation-b' }).clientOperationId).toBe('operation-b')
  })

  it('sends the exact frozen snapshot, accepts 200 replay, and clears only after success', async () => {
    const value = dependencies()
    value.complete.mockResolvedValueOnce({ status: 200, body: { saleReturn: { id: 'return-1', original_sale_id: 'sale-1', completed_at: 'now' }, items: [], refundAllocations: [], movements: [] } } as never)
    await expect(submitPosReturn({ ownerUserId: 'user-1', locationId: 'location-1', payload: snapshot().payload }, value)).resolves.toMatchObject({ status: 'succeeded', completion: { status: 200 } })
    expect(value.complete).toHaveBeenCalledWith('location-1', 'sale-1', snapshot().payload)
    expect(value.clearSnapshot).toHaveBeenCalledWith('user-1', 'operation-1')
  })

  it('keeps an unknown result pending but clears a definitive rejection', async () => {
    const unknown = dependencies(); unknown.complete.mockRejectedValueOnce(new TypeError('network'))
    await expect(submitPosReturn({ ownerUserId: 'user-1', locationId: 'location-1', payload: snapshot().payload }, unknown)).resolves.toEqual({ status: 'blocked', reason: 'unknown-result' })
    expect(unknown.clearSnapshot).not.toHaveBeenCalled()
    const rejected = dependencies(); rejected.complete.mockRejectedValueOnce(new HttpError(409, 'conflict'))
    await expect(retryPendingPosReturn(Object.freeze(snapshot()), rejected)).resolves.toEqual({ status: 'rejected' })
    expect(rejected.clearSnapshot).toHaveBeenCalledWith('user-1', 'operation-1')
  })
})
