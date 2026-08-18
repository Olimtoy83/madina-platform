import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../../inventory/types/product'
import type { Sale } from '../types/sale'
import {
  completeSale,
  getCompletedSales,
  getSaleStats,
  normalizeSale,
  SaleValidationError,
  updateSale,
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
  it('normalizes duplicate sale items by product', () => {
    const sale = createSale()

    sale.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 300,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 450,
      },
    ]

    const normalizedSale = normalizeSale(sale)

    expect(normalizedSale.items).toEqual([
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 750,
      },
    ])
    expect(normalizedSale.totalAmount).toBe(750)
  })

  it('rejects duplicate sale items with different unit prices', () => {
    const sale = createSale()

    sale.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 300,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitPrice: 200,
        totalAmount: 600,
      },
    ]

    expect(() => normalizeSale(sale)).toThrow(
      SaleValidationError,
    )
    expect(() => normalizeSale(sale)).toThrow(
      'Нельзя объединить позиции продажи с разной ценой.',
    )
    expect(() => completeSale(
      sale,
      [createProduct()],
    )).toThrow(SaleValidationError)
  })

  it('rejects duplicate sale items with matching prices and different units', () => {
    const sale = createSale()

    sale.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 300,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'box',
        unitPrice: 150,
        totalAmount: 450,
      },
    ]

    expect(() => normalizeSale(sale)).toThrow(
      SaleValidationError,
    )
    expect(() => normalizeSale(sale)).toThrow(
      'Нельзя объединить позиции продажи с разными единицами измерения.',
    )
  })

  it('rejects invalid numeric sale item data during normalization', () => {
    const sale = createSale()
    const validItem = sale.items[0]!
    const invalidItems: Sale['items'] = [
      { ...validItem, quantity: 0 },
      { ...validItem, quantity: -1 },
      { ...validItem, quantity: Number.NaN },
      { ...validItem, quantity: Number.POSITIVE_INFINITY },
      { ...validItem, unitPrice: 0 },
      { ...validItem, unitPrice: -1 },
      { ...validItem, unitPrice: Number.NaN },
      {
        ...validItem,
        unitPrice: Number.POSITIVE_INFINITY,
      },
    ]

    for (const item of invalidItems) {
      expect(() => normalizeSale({
        ...sale,
        items: [item],
      })).toThrow(SaleValidationError)
    }
  })

  it('accepts a fractional positive sale quantity', () => {
    const sale = createSale()

    const normalizedSale = normalizeSale({
      ...sale,
      items: [
        {
          ...sale.items[0]!,
          quantity: 1.5,
          unitPrice: 100,
        },
      ],
    })

    expect(normalizedSale.items[0]).toMatchObject({
      quantity: 1.5,
      totalAmount: 150,
    })
    expect(normalizedSale.totalAmount).toBe(150)
  })

  it('rejects invalid numeric sale data before side effects', () => {
    const products = [createProduct()]
    const sale = createSale()
    const randomUUID = vi.spyOn(crypto, 'randomUUID')

    sale.items[0] = {
      ...sale.items[0]!,
      unitPrice: 0,
    }

    try {
      expect(() => completeSale(
        sale,
        products,
      )).toThrow(SaleValidationError)
      expect(products[0]?.quantity).toBe(10)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })

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

  it('rejects a sale item with a mismatching unit before side effects', () => {
    const products = [createProduct()]
    const sale = createSale()
    const randomUUID = vi.spyOn(crypto, 'randomUUID')

    sale.items[0] = {
      ...sale.items[0]!,
      unit: 'box',
    }

    try {
      expect(() => completeSale(
        sale,
        products,
      )).toThrow(SaleValidationError)
      expect(products[0]?.quantity).toBe(10)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
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

  it('completes duplicate items as one traceable movement', () => {
    const products = [createProduct()]
    const sale = createSale()

    sale.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 300,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitPrice: 150,
        totalAmount: 450,
      },
    ]
    sale.totalAmount = 750

    const result = completeSale(
      sale,
      products,
    )

    expect(result.success).toBe(true)
    expect(result.products[0]?.quantity).toBe(5)
    expect(result.sale?.items).toHaveLength(1)
    expect(result.sale?.items[0]).toMatchObject({
      productId: 'product-001',
      quantity: 5,
      unitPrice: 150,
      totalAmount: 750,
    })
    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      productId: 'product-001',
      type: 'sale',
      quantity: -5,
      referenceId: sale.id,
    })
    expect(result.transaction?.amount).toBe(750)
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

describe('updateSale', () => {
  it('updates a draft sale with normalized items and a system-managed timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:00:00'))

    try {
      const sale = createSale()

      const updatedSale = updateSale(sale, {
        clientName: 'Updated Client',
        note: 'Updated note',
        items: [
          {
            productId: 'product-001',
            quantity: 2,
            unit: 'kg',
            unitPrice: 150,
            totalAmount: 300,
          },
          {
            productId: 'product-001',
            quantity: 3,
            unit: 'kg',
            unitPrice: 150,
            totalAmount: 450,
          },
        ],
      })

      expect(updatedSale).toMatchObject({
        clientName: 'Updated Client',
        note: 'Updated note',
        totalAmount: 750,
        updatedAt: new Date('2026-08-18T12:00:00'),
      })
      expect(updatedSale.items).toHaveLength(1)
      expect(updatedSale.items[0]).toMatchObject({
        quantity: 5,
        totalAmount: 750,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects direct changes to sale identity, status, and system fields', () => {
    const sale = createSale()

    const invalidUpdates: Partial<Sale>[] = [
      { id: 'sale-002' },
      { saleNumber: 'SAL-0002' },
      { createdAt: new Date('2026-01-01') },
      { updatedAt: new Date('2026-01-01') },
      { status: 'completed' },
      { totalAmount: 999 },
    ]

    for (const updates of invalidUpdates) {
      expect(() => updateSale(sale, updates)).toThrow(
        SaleValidationError,
      )
    }
  })

  it('rejects updates, including note changes, for terminal sales', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const sale = createSale(status)

      expect(() => updateSale(sale, {
        note: 'Updated note',
      })).toThrow(SaleValidationError)
      expect(sale.note).toBeUndefined()
    }
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
