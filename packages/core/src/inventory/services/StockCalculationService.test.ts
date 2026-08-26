import { describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import { getTotalStockQuantity } from './StockCalculationService'

function createProduct(
  quantity: number,
): Product {
  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: 'Test Product',
    category: 'dry-fruits',
    unit: 'kg',
    quantity,
    costPrice: 100,
    salePrice: 150,
    status: 'active',
  }
}

describe('getTotalStockQuantity', () => {
  it('calculates total quantity of all products', () => {
    const products = [
      createProduct(10),
      createProduct(5),
      createProduct(2),
    ]

    expect(
      getTotalStockQuantity(products),
    ).toBe(17)
  })

  it('returns zero for empty products', () => {
    expect(
      getTotalStockQuantity([]),
    ).toBe(0)
  })
})
