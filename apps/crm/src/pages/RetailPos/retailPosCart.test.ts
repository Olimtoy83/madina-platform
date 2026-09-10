import { describe, expect, it } from 'vitest'
import {
  addPosCartLine,
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
})
