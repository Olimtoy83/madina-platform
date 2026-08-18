import { describe, expect, it } from 'vitest'
import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Product } from '../types/product'
import type { StockMovement } from '../types/stockMovement'
import {
  deactivateProduct,
  ProductValidationError,
  updateProduct,
} from './ProductService'

function createProduct(
  overrides: Partial<Product> = {},
): Product {
  const now = new Date('2026-08-18T12:00:00')

  return {
    id: 'product-1',
    createdAt: now,
    updatedAt: now,
    name: 'Dates',
    category: 'dates',
    quantity: 0,
    unit: 'kg',
    costPrice: 10,
    salePrice: 20,
    status: 'active',
    ...overrides,
  }
}

function createSale(
  overrides: Partial<Sale> = {},
): Sale {
  const now = new Date('2026-08-18T12:00:00')

  return {
    id: 'sale-1',
    createdAt: now,
    updatedAt: now,
    saleNumber: 'SALE-001',
    saleDate: now,
    clientName: 'Ahmad',
    items: [{
      productId: 'product-1',
      quantity: 1,
      unit: 'kg',
      unitPrice: 20,
      totalAmount: 20,
    }],
    totalAmount: 20,
    paymentMethod: 'cash',
    status: 'draft',
    ...overrides,
  }
}

function createPurchase(
  overrides: Partial<Purchase> = {},
): Purchase {
  const now = new Date('2026-08-18T12:00:00')

  return {
    id: 'purchase-1',
    createdAt: now,
    updatedAt: now,
    purchaseNumber: 'PURCHASE-001',
    purchaseDate: now,
    supplierName: 'Supplier',
    items: [{
      productId: 'product-1',
      quantity: 1,
      unit: 'kg',
      unitCost: 10,
      totalCost: 10,
    }],
    totalAmount: 10,
    paymentMethod: 'cash',
    status: 'draft',
    ...overrides,
  }
}

describe('ProductService', () => {
  it('deactivates a product without removing its identity', () => {
    const product = createProduct()

    const result = deactivateProduct(product)

    expect(result).toMatchObject({
      id: product.id,
      status: 'inactive',
    })
    expect(result.createdAt).toBe(product.createdAt)
  })

  it('rejects a unit change while stock remains', () => {
    const product = createProduct({ quantity: 1 })

    expect(() =>
      updateProduct(product, { unit: 'piece' }, [], []),
    ).toThrow(ProductValidationError)
  })

  it('rejects a unit change referenced by a draft sale', () => {
    const product = createProduct()

    expect(() =>
      updateProduct(
        product,
        { unit: 'piece' },
        [createSale()],
        [],
      ),
    ).toThrow(ProductValidationError)
  })

  it('rejects a unit change referenced by a draft purchase', () => {
    const product = createProduct()

    expect(() =>
      updateProduct(
        product,
        { unit: 'piece' },
        [],
        [createPurchase()],
      ),
    ).toThrow(ProductValidationError)
  })

  it('allows a unit change at zero stock without draft references', () => {
    const product = createProduct()

    const result = updateProduct(
      product,
      { unit: 'piece' },
      [],
      [],
    )

    expect(result.unit).toBe('piece')
    expect(result.id).toBe(product.id)
    expect(result.createdAt).toBe(product.createdAt)
  })

  it('allows an update when the product unit is unchanged', () => {
    const product = createProduct({ quantity: 3 })

    const result = updateProduct(
      product,
      { name: 'Updated Dates', unit: 'kg' },
      [createSale()],
      [createPurchase()],
    )

    expect(result).toMatchObject({
      id: product.id,
      name: 'Updated Dates',
      unit: 'kg',
    })
  })

  it('does not let completed or cancelled records block a valid unit change', () => {
    const product = createProduct()
    const completedSale = createSale({ status: 'completed' })
    const cancelledPurchase = createPurchase({
      status: 'cancelled',
    })
    const movement: StockMovement = {
      id: 'movement-1',
      createdAt: new Date('2026-08-18T12:00:00'),
      updatedAt: new Date('2026-08-18T12:00:00'),
      productId: product.id,
      type: 'sale',
      quantity: -1,
      unit: 'kg',
    }

    const result = updateProduct(
      product,
      { unit: 'piece' },
      [completedSale],
      [cancelledPurchase],
    )

    expect(result.unit).toBe('piece')
    expect(completedSale.items[0]?.unit).toBe('kg')
    expect(cancelledPurchase.items[0]?.unit).toBe('kg')
    expect(movement.unit).toBe('kg')
  })
})
