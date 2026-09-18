import { describe, expect, it } from 'vitest'
import type { PosCheckoutAttempt } from './retailPosCheckout'
import {
  summarizePosPayments,
  type PosPaymentAllocation,
} from './retailPosPayments'
import {
  loadPendingPosSaleSubmission,
  savePendingPosSaleSubmission,
  type PosSubmissionRecoveryStorage,
} from './retailPosSubmissionRecovery'
import { createPosCompletionPayload } from './retailPosCompletionPayload'

const checkoutAttempt: PosCheckoutAttempt = {
  locationId: 'location-1',
  saleId: 'sale-1',
  clientOperationId: 'operation-1',
  lines: [
    { id: 'line-1', productId: 'product-1', quantity: 2 },
    { id: 'line-2', productId: 'product-2', quantity: 3 },
  ],
}

class StorageDouble implements PosSubmissionRecoveryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function exactSummary(
  allocations: readonly PosPaymentAllocation[],
  targetMinor = 2500,
) {
  return summarizePosPayments(allocations, targetMinor, 2)
}

describe('retail POS completion payload', () => {
  it('assembles the exact prepared identity and split payment payload', () => {
    const allocations = [
      { id: 'payment-cash', method: 'cash' as const, amountText: '20.00' },
      { id: 'payment-card', method: 'card' as const, amountText: '5.00' },
    ]
    const payload = createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: allocations,
      paymentSummary: exactSummary(allocations),
      currencyExponent: 2,
    })

    expect(payload).toEqual({
      clientOperationId: 'operation-1',
      saleId: 'sale-1',
      lines: [
        { id: 'line-1', productId: 'product-1', quantity: 2 },
        { id: 'line-2', productId: 'product-2', quantity: 3 },
      ],
      allocations: [
        { id: 'payment-cash', method: 'cash', amountMinor: 2000, ordinal: 0 },
        { id: 'payment-card', method: 'card', amountMinor: 500, ordinal: 1 },
      ],
    })
  })

  it('allows valid split allocations with duplicate payment methods', () => {
    const allocations = [
      { id: 'payment-cash-1', method: 'cash' as const, amountText: '10.00' },
      { id: 'payment-cash-2', method: 'cash' as const, amountText: '15.00' },
    ]
    const payload = createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: allocations,
      paymentSummary: exactSummary(allocations),
      currencyExponent: 2,
    })

    expect(payload.allocations).toEqual([
      { id: 'payment-cash-1', method: 'cash', amountMinor: 1000, ordinal: 0 },
      { id: 'payment-cash-2', method: 'cash', amountMinor: 1500, ordinal: 1 },
    ])
  })

  it.each([
    { allocations: [{ id: 'payment-1', method: 'cash' as const, amountText: '' }], target: 2500 },
    { allocations: [{ id: 'payment-1', method: 'cash' as const, amountText: '20.00' }], target: 2500 },
    { allocations: [{ id: 'payment-1', method: 'cash' as const, amountText: 'invalid' }], target: 2500 },
    { allocations: [{ id: 'payment-1', method: 'cash' as const, amountText: '999999999999999999999999999' }], target: 2500 },
    { allocations: [{ id: 'payment-1', method: 'cash' as const, amountText: '30.00' }], target: 2500 },
  ])('rejects a payment state that is not exact', ({ allocations, target }) => {
    expect(() => createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: allocations,
      paymentSummary: exactSummary(allocations, target),
      currencyExponent: 2,
    })).toThrow('Exact payment allocations are required.')
  })

  it('rejects invalid prepared or allocation identity at the assembly boundary', () => {
    const allocations = [{ id: 'payment-1', method: 'cash' as const, amountText: '25.00' }]
    const paymentSummary = exactSummary(allocations)

    expect(() => createPosCompletionPayload({
      checkoutAttempt: { ...checkoutAttempt, lines: [{ id: 'line-1', productId: 'product-1', quantity: 0 }] },
      paymentAllocations: allocations,
      paymentSummary,
      currencyExponent: 2,
    })).toThrow('Prepared checkout lines are invalid.')
    expect(() => createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: [{ ...allocations[0]!, id: '' }],
      paymentSummary,
      currencyExponent: 2,
    })).toThrow('Payment allocations are invalid.')
    expect(() => createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: [allocations[0]!, { ...allocations[0]! }],
      paymentSummary: exactSummary([allocations[0]!, { ...allocations[0]! }], 5000),
      currencyExponent: 2,
    })).toThrow('Payment allocations are invalid.')
  })

  it('does not mutate supplied checkout or payment state', () => {
    const attempt = structuredClone(checkoutAttempt)
    const allocations = [{ id: 'payment-1', method: 'transfer' as const, amountText: '25.00' }]
    const originalAttempt = structuredClone(attempt)
    const originalAllocations = structuredClone(allocations)

    createPosCompletionPayload({
      checkoutAttempt: attempt,
      paymentAllocations: allocations,
      paymentSummary: exactSummary(allocations),
      currencyExponent: 2,
    })

    expect(attempt).toEqual(originalAttempt)
    expect(allocations).toEqual(originalAllocations)
  })

  it('is directly accepted as the existing recovery payload without storage side effects outside the test double', () => {
    const allocations = [{ id: 'payment-1', method: 'other' as const, amountText: '25.00' }]
    const payload = createPosCompletionPayload({
      checkoutAttempt,
      paymentAllocations: allocations,
      paymentSummary: exactSummary(allocations),
      currencyExponent: 2,
    })
    const storage = new StorageDouble()

    expect(savePendingPosSaleSubmission({
      schemaVersion: 1,
      ownerUserId: 'user-1',
      locationId: checkoutAttempt.locationId,
      payload,
    }, storage).status).toBe('saved')
    expect(loadPendingPosSaleSubmission('user-1', storage)).toMatchObject({
      status: 'pending',
      snapshot: { payload },
    })
  })

  describe('authorized item discount payload', () => {
    it('copies the exact prepared item discount without adding client price fields', () => {
      const discountedAttempt: PosCheckoutAttempt = {
        ...checkoutAttempt,
        lines: [
          { ...checkoutAttempt.lines[0]!, discountAmountMinor: 300 },
          { ...checkoutAttempt.lines[1]! },
        ],
      }
      const allocations = [
        { id: 'payment-1', method: 'cash' as const, amountText: '22.00' },
      ]

      const payload = createPosCompletionPayload({
        checkoutAttempt: discountedAttempt,
        paymentAllocations: allocations,
        paymentSummary: exactSummary(allocations, 2200),
        currencyExponent: 2,
      })

      expect(payload.lines).toEqual([
        {
          id: 'line-1',
          productId: 'product-1',
          quantity: 2,
          discountAmountMinor: 300,
        },
        {
          id: 'line-2',
          productId: 'product-2',
          quantity: 3,
        },
      ])
      expect(Object.keys(payload.lines[0]!).sort()).toEqual([
        'discountAmountMinor',
        'id',
        'productId',
        'quantity',
      ])
      expect(Object.prototype.hasOwnProperty.call(
        payload.lines[1],
        'discountAmountMinor',
      )).toBe(false)
    })

    it('round-trips the exact item discount through version 1 recovery', () => {
      const discountedAttempt: PosCheckoutAttempt = {
        ...checkoutAttempt,
        lines: [
          { ...checkoutAttempt.lines[0]!, discountAmountMinor: 300 },
          { ...checkoutAttempt.lines[1]! },
        ],
      }
      const allocations = [
        { id: 'payment-1', method: 'cash' as const, amountText: '22.00' },
      ]
      const payload = createPosCompletionPayload({
        checkoutAttempt: discountedAttempt,
        paymentAllocations: allocations,
        paymentSummary: exactSummary(allocations, 2200),
        currencyExponent: 2,
      })
      const storage = new StorageDouble()

      expect(savePendingPosSaleSubmission({
        schemaVersion: 1,
        ownerUserId: 'user-1',
        locationId: discountedAttempt.locationId,
        payload,
      }, storage).status).toBe('saved')

      const loaded = loadPendingPosSaleSubmission('user-1', storage)
      expect(loaded.status).toBe('pending')
      if (loaded.status !== 'pending') return

      expect(loaded.snapshot.schemaVersion).toBe(1)
      expect(loaded.snapshot.payload).toEqual(payload)
      expect(loaded.snapshot.payload.lines[0]!.discountAmountMinor).toBe(300)
      expect(Object.isFrozen(loaded.snapshot.payload.lines[0]!)).toBe(true)
    })

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid prepared item discount %s',
      (discountAmountMinor) => {
        const allocations = [
          { id: 'payment-1', method: 'cash' as const, amountText: '25.00' },
        ]

        expect(() => createPosCompletionPayload({
          checkoutAttempt: {
            ...checkoutAttempt,
            lines: [{
              ...checkoutAttempt.lines[0]!,
              discountAmountMinor,
            }],
          },
          paymentAllocations: allocations,
          paymentSummary: exactSummary(allocations),
          currencyExponent: 2,
        })).toThrow('Prepared checkout lines are invalid.')
      },
    )
  })
})
