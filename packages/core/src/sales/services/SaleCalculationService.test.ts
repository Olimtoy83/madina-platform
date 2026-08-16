import { describe, expect, it } from 'vitest'
import type { SaleItem } from '../types/sale'
import {
  getSaleItemTotal,
  getSaleItemsTotal,
} from './SaleCalculationService'

function createItem(
  quantity: number,
  unitPrice: number,
): SaleItem {
  return {
    productId: 'product-001',
    quantity,
    unit: 'kg',
    unitPrice,
    totalAmount: quantity * unitPrice,
  }
}

describe('getSaleItemTotal', () => {
  it('calculates total for one sale item', () => {
    expect(
      getSaleItemTotal(5, 100),
    ).toBe(500)
  })

  it('returns zero when quantity is zero', () => {
    expect(
      getSaleItemTotal(0, 100),
    ).toBe(0)
  })

  it('returns zero when unit price is zero', () => {
    expect(
      getSaleItemTotal(5, 0),
    ).toBe(0)
  })
})

describe('getSaleItemsTotal', () => {
  it('calculates total for all sale items', () => {
    const items = [
      createItem(5, 100),
      createItem(2, 200),
    ]

    expect(
      getSaleItemsTotal(items),
    ).toBe(900)
  })

  it('returns zero for an empty array', () => {
    expect(
      getSaleItemsTotal([]),
    ).toBe(0)
  })
})
