import { describe, expect, it } from 'vitest'
import type { SaleItem } from '../types/sale'
import { getSaleItemsTotal } from './SaleCalculationService'

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
