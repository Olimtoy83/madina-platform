import { describe, expect, it } from 'vitest'
import {
  addPosCartLine,
  calculatePosCartTotals,
  clearPosCart,
  decrementPosCartLine,
  incrementPosCartLine,
  removePosCartLine,
  setPosCartLineDiscount,
  setPosCartLinePercentDiscount,
  parsePosCartDiscountPercentBasisPoints,
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
      discountTotalMinor: 0,
      payableTotalMinor: 2500,
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
      discountTotalMinor: 0,
      payableTotalMinor: 3325,
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

  describe('authorized item discount totals', () => {
    it('keeps gross subtotal and calculates discount and payable totals', () => {
      expect(calculatePosCartTotals([
        { ...plate, quantity: 2, discountAmountMinor: 300 },
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
        discountTotalMinor: 300,
        payableTotalMinor: 3025,
      })
    })

    it('reports zero discount while preserving undiscounted cart lines', () => {
      const lines = [{ ...plate, quantity: 2 }]

      expect(calculatePosCartTotals(lines)).toMatchObject({
        status: 'ready',
        subtotalMinor: 2500,
        discountTotalMinor: 0,
        payableTotalMinor: 2500,
      })
      expect(Object.prototype.hasOwnProperty.call(lines[0], 'discountAmountMinor')).toBe(false)
    })

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid discount amount %s',
      (discountAmountMinor) => {
        expect(calculatePosCartTotals([
          { ...plate, quantity: 2, discountAmountMinor },
        ])).toEqual({ status: 'invalid-line' })
      },
    )

    it('rejects a discount equal to or greater than the gross line total', () => {
      expect(calculatePosCartTotals([
        { ...plate, quantity: 2, discountAmountMinor: 2500 },
      ])).toEqual({ status: 'invalid-line' })

      expect(calculatePosCartTotals([
        { ...plate, quantity: 2, discountAmountMinor: 2501 },
      ])).toEqual({ status: 'invalid-line' })
    })

    it('preserves an existing discount when the same Product is added again', () => {
      const discounted: PosCartLine[] = [{
        ...plate,
        quantity: 1,
        discountAmountMinor: 100,
      }]

      expect(addPosCartLine(discounted, {
        ...plate,
        unitPriceMinor: 1500,
      }).lines).toEqual([{
        ...plate,
        quantity: 2,
        unitPriceMinor: 1500,
        discountAmountMinor: 100,
      }])
    })

    it('preserves an existing discount when quantity is incremented or decremented', () => {
      const discounted: PosCartLine[] = [{
        ...plate,
        quantity: 2,
        discountAmountMinor: 100,
      }]

      expect(incrementPosCartLine(discounted, plate.productId).lines[0]?.discountAmountMinor)
        .toBe(100)
      expect(decrementPosCartLine(discounted, plate.productId).lines[0]?.discountAmountMinor)
        .toBe(100)
    })
    it('sets, changes, and explicitly removes an item discount', () => {
      const lines: PosCartLine[] = [{
        ...plate,
        quantity: 2,
      }]

      const applied = setPosCartLineDiscount(
        lines,
        plate.productId,
        300,
      )

      expect(applied).toEqual({
        lines: [{
          ...plate,
          quantity: 2,
          discountAmountMinor: 300,
        }],
      })

      expect(Object.prototype.hasOwnProperty.call(
        lines[0],
        'discountAmountMinor',
      )).toBe(false)

      const changed = setPosCartLineDiscount(
        applied.lines,
        plate.productId,
        500,
      )

      expect(changed.lines[0]?.discountAmountMinor).toBe(500)

      const removed = setPosCartLineDiscount(
        changed.lines,
        plate.productId,
        undefined,
      )

      expect(removed).toEqual({
        lines: [{
          ...plate,
          quantity: 2,
        }],
      })

      expect(Object.prototype.hasOwnProperty.call(
        removed.lines[0],
        'discountAmountMinor',
      )).toBe(false)
    })

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects explicit invalid discount mutation %s',
      (discountAmountMinor) => {
        const lines: PosCartLine[] = [{
          ...plate,
          quantity: 2,
        }]

        expect(setPosCartLineDiscount(
          lines,
          plate.productId,
          discountAmountMinor,
        )).toEqual({
          lines,
          error: 'invalid-discount',
        })
      },
    )

    it('rejects discount mutation equal to or greater than the gross line total', () => {
      const lines: PosCartLine[] = [{
        ...plate,
        quantity: 2,
      }]

      expect(setPosCartLineDiscount(
        lines,
        plate.productId,
        2500,
      )).toEqual({
        lines,
        error: 'discount-too-large',
      })

      expect(setPosCartLineDiscount(
        lines,
        plate.productId,
        2501,
      )).toEqual({
        lines,
        error: 'discount-too-large',
      })
    })

    it('rejects discount mutation for an unknown Product', () => {
      const lines: PosCartLine[] = [{
        ...plate,
        quantity: 2,
      }]

      expect(setPosCartLineDiscount(
        lines,
        'missing-product',
        100,
      )).toEqual({
        lines,
        error: 'line-not-found',
      })
    })

    it('fails closed when gross line total overflows during discount mutation', () => {
      const lines: PosCartLine[] = [{
        ...plate,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
        quantity: 2,
      }]

      expect(setPosCartLineDiscount(
        lines,
        plate.productId,
        100,
      )).toEqual({
        lines,
        error: 'money-overflow',
      })
    })

    it('applies and changes a percent discount using integer basis points', () => {
      const lines: PosCartLine[] = [{ ...plate, quantity: 1, unitPriceMinor: 12345 }]
      const applied = setPosCartLinePercentDiscount(lines, plate.productId, 1000)
      expect(applied.lines[0]).toMatchObject({
        discountPercentBasisPoints: 1000,
        discountAmountMinor: 1235,
      })

      const changed = setPosCartLinePercentDiscount(applied.lines, plate.productId, 1050)
      expect(changed.lines[0]).toMatchObject({
        discountPercentBasisPoints: 1050,
        discountAmountMinor: 1296,
      })
    })

    it('rounds a ten percent discount to the nearest minor unit', () => {
      expect(setPosCartLinePercentDiscount(
        [{ ...plate, quantity: 1, unitPriceMinor: 12345 }],
        plate.productId,
        1000,
      ).lines[0]?.discountAmountMinor).toBe(1235)
    })

    it('parses fractional percentages as basis points without floating point money', () => {
      expect(parsePosCartDiscountPercentBasisPoints('10.5')).toEqual({
        status: 'ready', basisPoints: 1050,
      })
      expect(parsePosCartDiscountPercentBasisPoints('0,01')).toEqual({
        status: 'ready', basisPoints: 1,
      })
    })

    it.each(['0', '100', '100.01', '-1', '0.001', 'invalid'])(
      'rejects invalid percentage input %s',
      (value) => {
        expect(parsePosCartDiscountPercentBasisPoints(value)).toEqual({ status: 'invalid' })
      },
    )

    it.each([0, 10000, 10001, 1.5, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid percentage basis points %s',
      (basisPoints) => {
        const lines: PosCartLine[] = [{ ...plate, quantity: 1 }]
        expect(setPosCartLinePercentDiscount(lines, plate.productId, basisPoints)).toEqual({
          lines,
          error: 'invalid-percent',
        })
      },
    )

    it('rejects a percentage discount that rounds to zero', () => {
      const lines: PosCartLine[] = [{ ...plate, quantity: 1, unitPriceMinor: 1 }]
      expect(setPosCartLinePercentDiscount(lines, plate.productId, 1)).toEqual({
        lines,
        error: 'discount-rounds-to-zero',
      })
    })

    it('recalculates a percentage discount as quantity changes or the Product is added again', () => {
      const discounted = setPosCartLinePercentDiscount(
        [{ ...plate, quantity: 1, unitPriceMinor: 12345 }],
        plate.productId,
        1000,
      ).lines

      expect(incrementPosCartLine(discounted, plate.productId).lines[0]).toMatchObject({
        quantity: 2,
        discountPercentBasisPoints: 1000,
        discountAmountMinor: 2469,
      })
      expect(decrementPosCartLine(
        incrementPosCartLine(discounted, plate.productId).lines,
        plate.productId,
      ).lines[0]).toMatchObject({
        quantity: 1,
        discountAmountMinor: 1235,
      })
      expect(addPosCartLine(discounted, { ...plate, unitPriceMinor: 12345 }).lines[0]).toMatchObject({
        quantity: 2,
        discountPercentBasisPoints: 1000,
        discountAmountMinor: 2469,
      })
    })

    it('keeps a fixed amount discount fixed when quantity changes or the Product is added again', () => {
      const fixed: PosCartLine[] = [{ ...plate, quantity: 1, discountAmountMinor: 100 }]
      expect(incrementPosCartLine(fixed, plate.productId).lines[0]?.discountAmountMinor).toBe(100)
      expect(decrementPosCartLine(fixed, plate.productId).lines[0]?.discountAmountMinor).toBe(100)
      expect(addPosCartLine(fixed, plate).lines[0]?.discountAmountMinor).toBe(100)
    })

    it('switches between fixed and percent discounts, and removal clears both fields', () => {
      const fixed = setPosCartLineDiscount(
        [{ ...plate, quantity: 1, unitPriceMinor: 12345 }], plate.productId, 100,
      )
      const percent = setPosCartLinePercentDiscount(fixed.lines, plate.productId, 1000)
      expect(percent.lines[0]).toMatchObject({
        discountAmountMinor: 1235,
        discountPercentBasisPoints: 1000,
      })

      const fixedAgain = setPosCartLineDiscount(percent.lines, plate.productId, 200)
      expect(fixedAgain.lines[0]).toMatchObject({ discountAmountMinor: 200 })
      expect(Object.prototype.hasOwnProperty.call(
        fixedAgain.lines[0], 'discountPercentBasisPoints',
      )).toBe(false)

      const removed = setPosCartLineDiscount(fixedAgain.lines, plate.productId, undefined)
      expect(Object.prototype.hasOwnProperty.call(removed.lines[0], 'discountAmountMinor')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(removed.lines[0], 'discountPercentBasisPoints')).toBe(false)
    })

    it('uses the recalculated percentage amount in cart totals', () => {
      expect(calculatePosCartTotals([{
        ...plate,
        quantity: 2,
        unitPriceMinor: 12345,
        discountPercentBasisPoints: 1000,
        discountAmountMinor: 2469,
      }])).toMatchObject({
        status: 'ready',
        subtotalMinor: 24690,
        discountTotalMinor: 2469,
        payableTotalMinor: 22221,
      })
    })

    it('fails closed for percentage calculation overflow and stale percentage amounts', () => {
      const overflow: PosCartLine[] = [{
        ...plate,
        quantity: 2,
        unitPriceMinor: Number.MAX_SAFE_INTEGER,
      }]
      expect(setPosCartLinePercentDiscount(overflow, plate.productId, 1000)).toEqual({
        lines: overflow,
        error: 'money-overflow',
      })
      expect(calculatePosCartTotals([{
        ...plate,
        quantity: 1,
        discountPercentBasisPoints: 1000,
        discountAmountMinor: 1,
      }])).toEqual({ status: 'invalid-line' })
    })
  })
})
