import { describe, expect, it } from 'vitest'
import type { PosCartLine } from './retailPosCart'
import { createPosCheckoutAttempt } from './retailPosCheckout'

const cartLines: PosCartLine[] = [
  {
    productId: 'product-1',
    sourceId: 'PLATE-1',
    name: 'Plate',
    baseUnit: 'piece',
    quantity: 2,
    unitPriceMinor: 1250,
    currencyCode: 'SAR',
    currencyExponent: 2,
  },
  {
    productId: 'product-2',
    sourceId: 'CUP-1',
    name: 'Cup',
    baseUnit: 'piece',
    quantity: 3,
    unitPriceMinor: 275,
    currencyCode: 'SAR',
    currencyExponent: 2,
  },
]

const readyCartTotals = {
  status: 'ready' as const,
  currencyCode: 'SAR',
  currencyExponent: 2,
  lineTotals: [],
  subtotalMinor: 3325,
}

function sequentialIds(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++]!
}

describe('retail POS checkout attempt', () => {
  it('creates a checkout attempt from a valid non-empty cart in cart order', () => {
    const attempt = createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines,
      cartTotals: readyCartTotals,
      createId: sequentialIds('sale-1', 'operation-1', 'line-1', 'line-2'),
    })

    expect(attempt).toEqual({
      locationId: 'location-1',
      saleId: 'sale-1',
      clientOperationId: 'operation-1',
      lines: [
        { id: 'line-1', productId: 'product-1', quantity: 2 },
        { id: 'line-2', productId: 'product-2', quantity: 3 },
      ],
    })
    expect(new Set(attempt.lines.map((line) => line.id)).size).toBe(attempt.lines.length)
  })

  it('maps no cart display, price, or currency snapshots into sale lines', () => {
    const attempt = createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines,
      cartTotals: readyCartTotals,
      createId: sequentialIds('sale-1', 'operation-1', 'line-1', 'line-2'),
    })

    expect(Object.keys(attempt.lines[0]!).sort()).toEqual([
      'id',
      'productId',
      'quantity',
    ])
  })

  it('keeps its own structural snapshot when the source cart is later changed', () => {
    const sourceLines = cartLines.map((line) => ({ ...line }))
    const attempt = createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines: sourceLines,
      cartTotals: readyCartTotals,
      createId: sequentialIds('sale-1', 'operation-1', 'line-1', 'line-2'),
    })

    sourceLines[0]!.quantity = 9

    expect(attempt.lines[0]).toEqual({
      id: 'line-1',
      productId: 'product-1',
      quantity: 2,
    })
  })

  it.each([
    { cartLines: [], cartTotals: { status: 'empty' as const } },
    { cartLines, cartTotals: { status: 'invalid-line' as const } },
    { cartLines, cartTotals: { status: 'currency-mismatch' as const } },
    { cartLines, cartTotals: { status: 'money-overflow' as const } },
  ])('rejects cart input that is not ready', ({ cartLines: inputLines, cartTotals }) => {
    expect(() => createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines: inputLines,
      cartTotals,
      createId: sequentialIds('sale-1'),
    })).toThrow()
  })

  it('rejects an invalid cart line even when supplied totals claim readiness', () => {
    expect(() => createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines: [{ ...cartLines[0]!, quantity: 0 }],
      cartTotals: readyCartTotals,
      createId: sequentialIds('sale-1'),
    })).toThrow('Cart lines must contain a Product and a positive quantity.')
  })

  it('rejects duplicate IDs from an invalid ID factory', () => {
    expect(() => createPosCheckoutAttempt({
      locationId: 'location-1',
      cartLines,
      cartTotals: readyCartTotals,
      createId: () => 'duplicate-id',
    })).toThrow('Checkout attempt ID must be unique.')
  })
})
