import { describe, expect, it, vi } from 'vitest'
import { createPendingCommandGuard } from '../../shared/usePendingCommand'
import type { PosCheckoutAttempt } from './retailPosCheckout'
import { summarizePosPayments, type PosPaymentAllocation } from './retailPosPayments'
import type { PendingPosSaleSubmission, PosCompletionPayload } from './retailPosSubmissionRecovery'
import {
  retryPendingPosSale,
  submitPosSale,
  type PosPendingSaleRetryDependencies,
  type PosSaleSubmissionDependencies,
} from './retailPosSubmissionOrchestration'

function completionResult(status: 200 | 201) {
  return { status, body: { sale: {}, items: [], allocations: [] } }
}

const checkoutAttempt: PosCheckoutAttempt = {
  locationId: 'location-1',
  saleId: 'sale-1',
  clientOperationId: 'operation-1',
  lines: [{ id: 'line-1', productId: 'product-1', quantity: 1 }],
}
const paymentAllocations: PosPaymentAllocation[] = [
  { id: 'payment-1', method: 'cash', amountText: '10.00' },
]
const payload: PosCompletionPayload = {
  clientOperationId: 'operation-1',
  saleId: 'sale-1',
  lines: [{ id: 'line-1', productId: 'product-1', quantity: 1 }],
  allocations: [{ id: 'payment-1', method: 'cash', amountMinor: 1000, ordinal: 0 }],
}

function createSnapshot(): PendingPosSaleSubmission {
  return Object.freeze({
    schemaVersion: 1 as const,
    ownerUserId: 'user-1',
    locationId: 'location-1',
    payload: Object.freeze({
      ...payload,
      lines: Object.freeze(payload.lines.map((line) => Object.freeze({ ...line }))),
      allocations: Object.freeze(payload.allocations.map((allocation) => Object.freeze({ ...allocation }))),
    }),
  })
}

function createDependencies(
  overrides: Partial<PosSaleSubmissionDependencies> = {},
): PosSaleSubmissionDependencies {
  const snapshot = createSnapshot()
  return {
    createPayload: vi.fn(() => structuredClone(payload)),
    saveSnapshot: vi.fn(() => ({ status: 'saved' as const, snapshot })),
    complete: vi.fn(async () => completionResult(201)),
    clearSnapshot: vi.fn(() => ({ status: 'cleared' as const })),
    isCurrent: vi.fn(() => true),
    ...overrides,
  }
}

function submit(dependencies: PosSaleSubmissionDependencies) {
  return submitPosSale({
    ownerUserId: 'user-1',
    checkoutAttempt,
    paymentAllocations,
    paymentSummary: summarizePosPayments(paymentAllocations, 1000, 2),
    currencyExponent: 2,
  }, dependencies)
}

function createRetryDependencies(
  overrides: Partial<PosPendingSaleRetryDependencies> = {},
): PosPendingSaleRetryDependencies {
  return {
    complete: vi.fn(async () => completionResult(201)),
    clearSnapshot: vi.fn(() => ({ status: 'cleared' as const })),
    isCurrent: vi.fn(() => true),
    ...overrides,
  }
}

function retry(
  dependencies: PosPendingSaleRetryDependencies,
  snapshot = createSnapshot(),
) {
  return retryPendingPosSale(snapshot, dependencies)
}

describe('retail POS submission orchestration', () => {
  it('persists before POST and dispatches exactly the frozen saved snapshot', async () => {
    const events: string[] = []
    const snapshot = createSnapshot()
    const dependencies = createDependencies({
      createPayload: vi.fn(() => ({ ...payload, saleId: 'mutable-payload' })),
      saveSnapshot: vi.fn(() => {
        events.push('save')
        return { status: 'saved' as const, snapshot }
      }),
      complete: vi.fn(async (locationId, savedPayload) => {
        events.push('post')
        expect(locationId).toBe(snapshot.locationId)
        expect(savedPayload).toBe(snapshot.payload)
        expect(savedPayload).not.toEqual({ ...payload, saleId: 'mutable-payload' })
        return completionResult(201)
      }),
      clearSnapshot: vi.fn(() => {
        events.push('clear')
        return { status: 'cleared' as const }
      }),
    })

    await expect(submit(dependencies)).resolves.toEqual({ status: 'succeeded', completionStatus: 201 })
    expect(events).toEqual(['save', 'post', 'clear'])
    expect(dependencies.saveSnapshot).toHaveBeenCalledTimes(1)
    expect(dependencies.clearSnapshot).toHaveBeenCalledWith('user-1', 'operation-1')
  })

  it('accepts an exact replay 200 and clears the matching snapshot', async () => {
    const dependencies = createDependencies({
      complete: vi.fn(async () => completionResult(200)),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'succeeded', completionStatus: 200 })
    expect(dependencies.clearSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not save or POST when payload assembly rejects', async () => {
    const dependencies = createDependencies({
      createPayload: vi.fn(() => { throw new Error('invalid') }),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'assembly-error' })
    expect(dependencies.saveSnapshot).not.toHaveBeenCalled()
    expect(dependencies.complete).not.toHaveBeenCalled()
  })

  it.each([
    ['already-pending', 'save-already-pending'],
    ['invalid', 'save-invalid'],
    ['storage-error', 'save-storage-error'],
  ] as const)('does not POST after save %s', async (saveStatus, reason) => {
    const dependencies = createDependencies({
      saveSnapshot: vi.fn(() => ({ status: saveStatus })),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason })
    expect(dependencies.complete).not.toHaveBeenCalled()
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it.each([400, 401, 403, 404, 409, 500])(
    'retains the snapshot and does not clear on HTTP %i',
    async (status) => {
      const dependencies = createDependencies({
        complete: vi.fn(async () => { throw new Error(`HTTP ${status}`) }),
      })
      await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'request-failed' })
      expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
    },
  )

  it('retains the snapshot without clearing after a network error', async () => {
    const dependencies = createDependencies({
      complete: vi.fn(async () => { throw new TypeError('network error') }),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'request-failed' })
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('does not clear or POST again when cleanup fails after server success', async () => {
    const dependencies = createDependencies({
      clearSnapshot: vi.fn(() => ({ status: 'storage-error' as const })),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'clear-failed' })
    expect(dependencies.complete).toHaveBeenCalledTimes(1)
    expect(dependencies.clearSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch after the owner/logout generation is no longer current', async () => {
    const dependencies = createDependencies({ isCurrent: vi.fn(() => false) })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'stale' })
    expect(dependencies.complete).not.toHaveBeenCalled()
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('does not clear a late completion after owner change or unmount', async () => {
    let current = true
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
    const dependencies = createDependencies({
      isCurrent: vi.fn(() => current),
      complete: vi.fn(async () => {
        await completion
        return completionResult(201)
      }),
    })
    const result = submit(dependencies)
    current = false
    resolveCompletion()
    await expect(result).resolves.toEqual({ status: 'blocked', reason: 'stale' })
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('does not mutate the prepared checkout or payment input', async () => {
    const attempt = structuredClone(checkoutAttempt)
    const allocations = structuredClone(paymentAllocations)
    const originalAttempt = structuredClone(attempt)
    const originalAllocations = structuredClone(allocations)
    const dependencies = createDependencies()
    await submitPosSale({
      ownerUserId: 'user-1',
      checkoutAttempt: attempt,
      paymentAllocations: allocations,
      paymentSummary: summarizePosPayments(allocations, 1000, 2),
      currencyExponent: 2,
    }, dependencies)
    expect(attempt).toEqual(originalAttempt)
    expect(allocations).toEqual(originalAllocations)
  })

  it('prevents a second submit interaction while the shared command guard is pending', async () => {
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
    const dependencies = createDependencies({
      complete: vi.fn(async () => {
        await completion
        return completionResult(201)
      }),
    })
    const guard = createPendingCommandGuard()
    const key = 'retail-pos-submission:operation-1'
    const first = guard.begin(key) ? submit(dependencies).finally(() => guard.finish(key)) : undefined
    const second = guard.begin(key) ? submit(dependencies).finally(() => guard.finish(key)) : undefined

    expect(second).toBeUndefined()
    resolveCompletion()
    await first
    expect(dependencies.complete).toHaveBeenCalledTimes(1)
  })

  it('does not clear a response that is not a new-sale 201 or exact-replay 200', async () => {
    const dependencies = createDependencies({
      complete: vi.fn(async () => ({
        status: 202,
        body: { sale: {}, items: [], allocations: [] },
      }) as never),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'request-failed' })
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('blocks safely if the snapshot save unexpectedly throws', async () => {
    const dependencies = createDependencies({
      saveSnapshot: vi.fn(() => { throw new Error('storage error') }),
    })
    await expect(submit(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'save-storage-error' })
    expect(dependencies.complete).not.toHaveBeenCalled()
  })

  it('retries an existing snapshot directly with its exact location and payload', async () => {
    const snapshot = createSnapshot()
    const dependencies = createRetryDependencies({
      complete: vi.fn(async (locationId, savedPayload) => {
        expect(locationId).toBe(snapshot.locationId)
        expect(savedPayload).toBe(snapshot.payload)
        return completionResult(201)
      }),
    })
    await expect(retry(dependencies, snapshot)).resolves.toEqual({ status: 'succeeded', completionStatus: 201 })
    expect(dependencies.clearSnapshot).toHaveBeenCalledWith(
      snapshot.ownerUserId,
      snapshot.payload.clientOperationId,
    )
  })

  it('accepts an exact replay 200 when retrying an existing snapshot', async () => {
    const dependencies = createRetryDependencies({
      complete: vi.fn(async () => completionResult(200)),
    })
    await expect(retry(dependencies)).resolves.toEqual({ status: 'succeeded', completionStatus: 200 })
    expect(dependencies.clearSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not POST a retry when the owner or lifecycle is stale before transport', async () => {
    const dependencies = createRetryDependencies({ isCurrent: vi.fn(() => false) })
    await expect(retry(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'stale' })
    expect(dependencies.complete).not.toHaveBeenCalled()
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it.each(['network', 'HTTP 400', 'HTTP 401', 'HTTP 403', 'HTTP 404', 'HTTP 409', 'HTTP 500'])('does not clear an unresolved retry result: %s', async (message) => {
    const dependencies = createRetryDependencies({
      complete: vi.fn(async () => { throw new Error(message) }),
    })
    await expect(retry(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'request-failed' })
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('does not clear a retry completion after owner change or unmount', async () => {
    let current = true
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
    const dependencies = createRetryDependencies({
      isCurrent: vi.fn(() => current),
      complete: vi.fn(async () => {
        await completion
        return completionResult(201)
      }),
    })
    const result = retry(dependencies)
    current = false
    resolveCompletion()
    await expect(result).resolves.toEqual({ status: 'blocked', reason: 'stale' })
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })

  it('retains the snapshot after cleanup failure and does not issue a second retry POST', async () => {
    const dependencies = createRetryDependencies({
      clearSnapshot: vi.fn(() => ({ status: 'storage-error' as const })),
    })
    await expect(retry(dependencies)).resolves.toEqual({ status: 'blocked', reason: 'clear-failed' })
    expect(dependencies.complete).toHaveBeenCalledTimes(1)
    expect(dependencies.clearSnapshot).toHaveBeenCalledTimes(1)
  })

  it('prevents a second explicit retry while the shared command guard is pending', async () => {
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
    const dependencies = createRetryDependencies({
      complete: vi.fn(async () => {
        await completion
        return completionResult(201)
      }),
    })
    const guard = createPendingCommandGuard()
    const key = 'retail-pos-recovery:operation-1'
    const first = guard.begin(key) ? retry(dependencies).finally(() => guard.finish(key)) : undefined
    const second = guard.begin(key) ? retry(dependencies).finally(() => guard.finish(key)) : undefined

    expect(second).toBeUndefined()
    resolveCompletion()
    await first
    expect(dependencies.complete).toHaveBeenCalledTimes(1)
  })

  it('does not perform recovery transport until the retry function is explicitly invoked', () => {
    const dependencies = createRetryDependencies()
    expect(dependencies.complete).not.toHaveBeenCalled()
    expect(dependencies.clearSnapshot).not.toHaveBeenCalled()
  })
})
