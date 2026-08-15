import { describe, expect, it } from 'vitest'
import type { Product } from '../types/product'
import {
  adjustStock,
  issueStock,
  receiveStock,
} from './StockService'


function createProduct(
  quantity = 10,
): Product {
  const now = new Date()

  return {
    id: 'product-001',
    createdAt: now,
    updatedAt: now,
    name: 'Test Product',
    category: 'Dry Fruits',
    unit: 'kg',
    quantity,
    costPrice: 100,
    salePrice: 150,
    status: 'active',
  }
}

describe('receiveStock', () => {
  it('increases product quantity and creates purchase movement', () => {
    const products = [createProduct()]

    const result = receiveStock(
      products,
      'product-001',
      5,
      'purchase-001',
      'Test purchase',
    )

    expect(result.success).toBe(true)
    expect(result.product?.quantity).toBe(15)

    expect(result.movement).toMatchObject({
      productId: 'product-001',
      type: 'purchase',
      quantity: 5,
      unit: 'kg',
      referenceId: 'purchase-001',
      note: 'Test purchase',
    })
  })
})

describe('issueStock', () => {
  it('decreases product quantity and creates sale movement', () => {
    const products = [createProduct()]

    const result = issueStock(
      products,
      'product-001',
      4,
      'sale-001',
      'Test sale',
    )

    expect(result.success).toBe(true)
    expect(result.product?.quantity).toBe(6)

    expect(result.movement).toMatchObject({
      productId: 'product-001',
      type: 'sale',
      quantity: -4,
      unit: 'kg',
      referenceId: 'sale-001',
      note: 'Test sale',
    })
  })

  it('rejects issue when stock is insufficient', () => {
    const products = [createProduct(3)]

    const result = issueStock(
      products,
      'product-001',
      5,
    )

    expect(result.success).toBe(false)
    expect(result.products[0]?.quantity).toBe(3)
    expect(result.movement).toBeUndefined()
  })
})

describe('adjustStock', () => {
  it('adjusts product quantity and creates adjustment movement', () => {
    const products = [createProduct()]

    const result = adjustStock(
      products,
      'product-001',
      3,
      'adjustment-001',
      'Inventory correction',
    )

    expect(result.success).toBe(true)
    expect(result.product?.quantity).toBe(13)

    expect(result.movement).toMatchObject({
      productId: 'product-001',
      type: 'adjustment',
      quantity: 3,
      unit: 'kg',
      referenceId: 'adjustment-001',
      note: 'Inventory correction',
    })
  })

  it('rejects adjustment that would create negative stock', () => {
    const products = [createProduct(3)]

    const result = adjustStock(
      products,
      'product-001',
      -5,
    )

    expect(result.success).toBe(false)
    expect(result.products[0]?.quantity).toBe(3)
    expect(result.movement).toBeUndefined()
  })
})