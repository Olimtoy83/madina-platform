import { describe, expect, it } from 'vitest'
import {
  addPosCartLine,
  calculatePosCartTotals,
  clearPosCart,
  decrementPosCartLine,
  incrementPosCartLine,
  removePosCartLine,
  type PosCartLine,
  type PosCartLineSnapshot,
} from './retailPosCart'

const plate: PosCartLineSnapshot = {
  productId: 'product-1',
  sourceId: 'PLATE-1',
  name: 'Plate',
  baseUnit: 'piece',
  unitPriceMinor: 1250,
  currencyCode: 'SAR',
  currencyExponent: 2,
}

const cup: PosCartLineSnapshot = {
  ...plate,
  productId: 'product-2',
  sourceId: 'CUP-1',
  name: 'Cup',
}

describe('retail POS cart', () => {
  it('creates one line with quantity one on the first add', () => {
    const result = addPosCartLine([], plate)

    expect(result).toEqual({
      lines: [{ ...plate, quantity: 1 }],
    })
  })

  it('merges repeated Products and refreshes their price and currency snapshot', () => {
    const first = addPosCartLine([], plate).lines
    const result = addPosCartLine(first, {
      ...plate,
      unitPriceMinor: 1500,
      currencyCode: 'USD',
      currencyExponent: 0,
    })

    expect(result).toEqual({
      lines: [{
        ...plate,
        quantity: 2,
        unitPriceMinor: 1500,
        currencyCode: 'USD',
        currencyExponent: 0,
      }],
    })
    expect(new Set(result.lines.map((line) => line.productId)).size).toBe(
      result.lines.length,
    )
  })

  it('increments and decrements a line without allowing quantity zero', () => {
    const lines = [{ ...plate, quantity: 2 }]

    expect(incrementPosCartLine(lines, plate.productId).lines).toEqual([
      { ...plate, quantity: 3 },
    ])
    expect(decrementPosCartLine(lines, plate.productId).lines).toEqual([
      { ...plate, quantity: 1 },
    ])
    expect(decrementPosCartLine([{ ...plate, quantity: 1 }], plate.productId).lines).toEqual([
      { ...plate, quantity: 1 },
    ])
  })

  it('removes only the selected Product line and clears the cart', () => {
    const lines = [
      { ...plate, quantity: 1 },
      { ...cup, quantity: 2 },
    ]

    expect(removePosCartLine(lines, plate.productId)).toEqual([
      { ...cup, quantity: 2 },
    ])
    expect(clearPosCart()).toEqual([])
  })

  it('rejects an overflowing increment without changing the cart', () => {
    const lines: PosCartLine[] = [{
      ...plate,
      quantity: Number.MAX_SAFE_INTEGER,
    }]

    expect(incrementPosCartLine(lines, plate.productId)).toEqual({
      lines,
      error: 'quantity-overflow',
    })
  })

  it('contains no Sale-specific identifiers or payload fields', () => {
    const line = addPosCartLine([], plate).lines[0]!

    expect(Object.keys(line).sort()).toEqual([
      'baseUnit',
      'currencyCode',
      'currencyExponent',
      'name',
      'productId',
      'quantity',
      'sourceId',
      'unitPriceMinor',
    ])
  })

  it('calculates an exact one-line total and subtotal', () => {
    expect(calculatePosCartTotals([{ ...plate, quantity: 2 }])).toEqual({
      status: 'ready',
      currencyCode: 'SAR',
      currencyExponent: 2,
      lineTotals: [{ productId: plate.productId, lineTotalMinor: 2500 }],
      subtotalMinor: 2500,
    })
  })

  it('calculates exact totals for multiple lines', () => {
    expect(calculatePosCartTotals([
      { ...plate, quantity: 2 },
      { ...cup, quantity: 3, unitPriceMinor: 275 },
    ])).toEqual({
      status: 'ready',
      currencyCode: 'SAR',
      currencyExponent: 2,
      lineTotals: [
        { productId: plate.productId, lineTotalMinor: 2500 },
        { productId: cup.productId, lineTotalMinor: 825 },
      ],
      subtotalMinor: 3325,
    })
  })

  it('returns empty totals for an empty cart', () => {
    expect(calculatePosCartTotals([])).toEqual({ status: 'empty' })
  })

  it('rejects invalid unit prices and quantities without partial totals', () => {
    for (const unitPriceMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(calculatePosCartTotals([
        { ...plate, quantity: 1, unitPriceMinor },
      ])).toEqual({ status: 'invalid-line' })
    }
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(calculatePosCartTotals([
        { ...plate, quantity },
      ])).toEqual({ status: 'invalid-line' })
    }
  })

  it('rejects multiplication and subtotal overflow without partial totals', () => {
    expect(calculatePosCartTotals([
      { ...plate, quantity: 2, unitPriceMinor: Number.MAX_SAFE_INTEGER },
    ])).toEqual({ status: 'money-overflow' })
    expect(calculatePosCartTotals([
      { ...plate, quantity: 1, unitPriceMinor: Number.MAX_SAFE_INTEGER },
      { ...cup, quantity: 1, unitPriceMinor: 1 },
    ])).toEqual({ status: 'money-overflow' })
  })

  it('rejects currency code and exponent mismatches without partial totals', () => {
    expect(calculatePosCartTotals([
      { ...plate, quantity: 1 },
      { ...cup, quantity: 1, currencyCode: 'USD' },
    ])).toEqual({ status: 'currency-mismatch' })
    expect(calculatePosCartTotals([
      { ...plate, quantity: 1 },
      { ...cup, quantity: 1, currencyExponent: 0 },
    ])).toEqual({ status: 'currency-mismatch' })
  })
})
