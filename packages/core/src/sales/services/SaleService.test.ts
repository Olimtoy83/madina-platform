import { describe, expect, it } from 'vitest'
import type { Product } from '../../inventory/types/product'
import type { Sale } from '../types/sale'
import {
  completeSale,
  getCompletedSales,
  getSaleStats,
} from './SaleService'

function createProduct(
  id = 'product-001',
  quantity = 10,
): Product {
  const now = new Date()

  return {
    id,
    createdAt: now,
    updatedAt: now,
    name: 'Test Product',
    category: 'Dry Fruits',
    quantity,
    unit: 'kg',
    costPrice: 100,
    salePrice: 150,
    status: 'active',
  }
}

function createSale(
  status: Sale['status'] = 'draft',
): Sale {
  const now = new Date()

  return {
    id: 'sale-001',
    createdAt: now,
    updatedAt: now,
    saleNumber: 'SAL-0001',
    saleDate: now,
    clientName: 'Test Client',
    items: [
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 750,
      },
    ],
    totalAmount: 750,
    paymentMethod: 'cash',
    status,
  }
}

describe('completeSale', () => {
  it('completes sale and decreases stock', () => {
    const products = [createProduct()]
    const sale = createSale()

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(true)

    expect(result.sale).toMatchObject({
      id: sale.id,
      status: 'completed',
    })

    expect(result.products[0]?.quantity).toBe(5)

    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      productId: 'product-001',
      type: 'sale',
      quantity: -5,
      unit: 'kg',
      referenceId: sale.id,
    })

    expect(result.transaction).toMatchObject({
      type: 'income',
      category: 'sale',
      amount: 750,
      paymentMethod: 'cash',
      transactionDate: sale.saleDate,
      referenceId: sale.id,
      status: 'completed',
    })
  })

  it('completes sale with multiple items', () => {
    const products = [
      createProduct('product-001', 10),
      createProduct('product-002', 20),
    ]

    const sale = createSale()

    sale.items = [
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 750,
      },
      {
        productId: 'product-002',
        quantity: 3,
        unit: 'kg',
        unitPrice: 200,
        totalAmount: 600,
      },
    ]

    sale.totalAmount = 1350

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(true)

    expect(
      result.products.find(
        (product) =>
          product.id === 'product-001',
      )?.quantity,
    ).toBe(5)

    expect(
      result.products.find(
        (product) =>
          product.id === 'product-002',
      )?.quantity,
    ).toBe(17)

    expect(result.movements).toHaveLength(2)
    expect(result.transaction?.amount).toBe(1350)
  })

  it('rejects sale that is not a draft', () => {
    const products = [createProduct()]
    const sale = createSale('completed')

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.sale).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.products[0]?.quantity).toBe(10)
    expect(result.transaction).toBeUndefined()
  })

  it('rejects sale without items', () => {
    const products = [createProduct()]
    const sale = createSale()

    sale.items = []
    sale.totalAmount = 0

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.sale).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.transaction).toBeUndefined()
    expect(result.products).toEqual(products)
  })

  it('rejects sale when product is missing', () => {
    const products = [createProduct()]
    const sale = createSale()

    sale.items[0] = {
      productId: 'missing-product',
      quantity: 5,
      unit: 'kg',
      unitPrice: 150,
      totalAmount: 750,
    }

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.sale).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.transaction).toBeUndefined()
    expect(result.products[0]?.quantity).toBe(10)
  })

  it('rejects sale when stock is insufficient', () => {
    const products = [createProduct('product-001', 3)]
    const sale = createSale()

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.sale).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.transaction).toBeUndefined()
    expect(result.products[0]?.quantity).toBe(3)
  })
})

describe('getCompletedSales', () => {
  it('returns only completed sales', () => {
    const sales = [
      createSale('completed'),
      createSale('draft'),
      createSale('cancelled'),
    ]

    const result = getCompletedSales(sales)

    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe('completed')
  })

  describe('getSaleStats', () => {
    it('returns correct sales statistics', () => {
      const completedSale = createSale('completed')
      const draftSale = createSale('draft')
      const cancelledSale = createSale('cancelled')

      draftSale.totalAmount = 500
      completedSale.totalAmount = 1000
      cancelledSale.totalAmount = 250

      const result = getSaleStats([
        completedSale,
        draftSale,
        cancelledSale,
      ])

      expect(result).toEqual({
        totalCount: 3,
        draftCount: 1,
        completedCount: 1,
        totalAmount: 1750,
      })
    })

    it('returns zero statistics for an empty array', () => {
      expect(getSaleStats([])).toEqual({
        totalCount: 0,
        draftCount: 0,
        completedCount: 0,
        totalAmount: 0,
      })
    })

    it('counts cancelled sales in total but not in draft or completed', () => {
      const sales = [
        createSale('cancelled'),
        createSale('cancelled'),
      ]

      const result = getSaleStats(sales)

      expect(result).toEqual({
        totalCount: 2,
        draftCount: 0,
        completedCount: 0,
        totalAmount: 1500,
      })
    })
  })

  it('returns an empty array when there are no completed sales', () => {
    const sales = [
      createSale('draft'),
      createSale('cancelled'),
    ]

    expect(getCompletedSales(sales)).toEqual([])
  })

  it('returns an empty array for an empty input', () => {
    expect(getCompletedSales([])).toEqual([])
  })
})
