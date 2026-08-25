import { describe, expect, it } from 'vitest'
import type { StockMovement } from '../types/stockMovement'
import { getStockMovementTotals } from './StockMovementService'

function createMovement(
  type: StockMovement['type'],
  quantity: number,
): StockMovement {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    productId: 'product-001',
    type,
    quantity,
    unit: 'kg',
  }
}

describe('getStockMovementTotals', () => {
  it('calculates purchase and sale totals', () => {
    const movements = [
      createMovement('purchase', 10),
      createMovement('purchase', 5),
      createMovement('sale', -4),
      createMovement('sale', -3),
      createMovement('adjustment', 2),
    ]

    expect(
      getStockMovementTotals(movements),
    ).toEqual({
      totalPurchases: 15,
      totalSales: 7,
    })
  })

  it('ignores adjustment movements', () => {
    const movements = [
      createMovement('adjustment', 5),
      createMovement('adjustment', -2),
    ]

    expect(
      getStockMovementTotals(movements),
    ).toEqual({
      totalPurchases: 0,
      totalSales: 0,
    })
  })

  it('returns zero totals for empty input', () => {
    expect(
      getStockMovementTotals([]),
    ).toEqual({
      totalPurchases: 0,
      totalSales: 0,
    })
  })
})