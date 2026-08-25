import { describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import type { StockMovement } from '../types/stockMovement'
import { getStockIntegrityDiscrepancies } from './StockIntegrityService'

function createProduct(
  overrides: Partial<Product> = {},
): Product {
  const now = new Date()

  return {
    id: 'product-001',
    createdAt: now,
    updatedAt: now,
    name: 'Dates',
    category: 'dates',
    quantity: 10,
    unit: 'kg',
    costPrice: 5,
    salePrice: 10,
    status: 'active',
    ...overrides,
  }
}

function createMovement(
  quantity: number,
  overrides: Partial<StockMovement> = {},
): StockMovement {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    productId: 'product-001',
    type:
      quantity < 0
        ? 'sale'
        : 'purchase',
    quantity,
    unit: 'kg',
    ...overrides,
  }
}

describe('getStockIntegrityDiscrepancies', () => {
  it('returns no discrepancy when product balance matches movements', () => {
    const product = createProduct({
      quantity: 8,
    })

    const movements = [
      createMovement(10),
      createMovement(-2),
    ]

    expect(
      getStockIntegrityDiscrepancies(
        [product],
        movements,
      ),
    ).toEqual([])
  })

  it('returns discrepancy when product balance differs from movements', () => {
    const product = createProduct({
      quantity: 9,
    })

    const movements = [
      createMovement(10),
      createMovement(-2),
    ]

    expect(
      getStockIntegrityDiscrepancies(
        [product],
        movements,
      ),
    ).toEqual([
      {
        productId: 'product-001',
        productName: 'Dates',
        actualQuantity: 9,
        calculatedQuantity: 8,
        difference: 1,
      },
    ])
  })

  it('treats missing movements as calculated zero balance', () => {
    const product = createProduct({
      quantity: 3,
    })

    expect(
      getStockIntegrityDiscrepancies(
        [product],
        [],
      ),
    ).toEqual([
      {
        productId: 'product-001',
        productName: 'Dates',
        actualQuantity: 3,
        calculatedQuantity: 0,
        difference: 3,
      },
    ])
  })

  it('supports positive and negative adjustments', () => {
    const product = createProduct({
      quantity: 11,
    })

    const movements = [
      createMovement(10),
      createMovement(3, {
        type: 'adjustment',
      }),
      createMovement(-2, {
        type: 'adjustment',
      }),
    ]

    expect(
      getStockIntegrityDiscrepancies(
        [product],
        movements,
      ),
    ).toEqual([])
  })

  it('ignores floating-point differences within epsilon', () => {
    const product = createProduct({
      quantity: 0.3,
    })

    const movements = [
      createMovement(0.1),
      createMovement(0.2),
    ]

    expect(
      getStockIntegrityDiscrepancies(
        [product],
        movements,
      ),
    ).toEqual([])
  })
})
