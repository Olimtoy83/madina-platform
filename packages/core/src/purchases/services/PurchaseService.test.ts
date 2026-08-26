import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../../inventory/types/product'
import type { Purchase } from '../types/purchase'
import {
  completePurchase,
  normalizePurchase,
  PurchaseValidationError,
  updatePurchase,
} from './PurchaseService'

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
    category: 'dry-fruits',
    quantity,
    unit: 'kg',
    costPrice: 100,
    salePrice: 150,
    status: 'active',
  }
}

function createPurchase(
  status: Purchase['status'] = 'draft',
): Purchase {
  const now = new Date()

  return {
    id: 'purchase-001',
    createdAt: now,
    updatedAt: now,
    purchaseNumber: 'PUR-0001',
    purchaseDate: now,
    supplierName: 'Test Supplier',
    items: [
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitCost: 100,
        totalCost: 500,
      },
    ],
    totalAmount: 500,
    paymentMethod: 'cash',
    status,
  }
}

describe('completePurchase', () => {
  it('normalizes duplicate purchase items by product', () => {
    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitCost: 100,
        totalCost: 300,
      },
    ]

    const normalizedPurchase = normalizePurchase(
      purchase,
    )

    expect(normalizedPurchase.items).toEqual([
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitCost: 100,
        totalCost: 500,
      },
    ])
    expect(normalizedPurchase.totalAmount).toBe(500)
  })

  it('rejects duplicate purchase items with different unit costs', () => {
    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitCost: 120,
        totalCost: 360,
      },
    ]

    expect(() => normalizePurchase(purchase)).toThrow(
      PurchaseValidationError,
    )
    expect(() => normalizePurchase(purchase)).toThrow(
      'Нельзя объединить позиции поступления с разной ценой закупки.',
    )
  })

  it('rejects duplicate purchase items with matching costs and different units', () => {
    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'box',
        unitCost: 100,
        totalCost: 300,
      },
    ]

    expect(() => normalizePurchase(purchase)).toThrow(
      PurchaseValidationError,
    )
    expect(() => normalizePurchase(purchase)).toThrow(
      'Нельзя объединить позиции поступления с разными единицами измерения.',
    )
  })

  it('rejects invalid numeric purchase item data during normalization', () => {
    const purchase = createPurchase()
    const validItem = purchase.items[0]!
    const invalidItems: Purchase['items'] = [
      { ...validItem, quantity: 0 },
      { ...validItem, quantity: -1 },
      { ...validItem, quantity: Number.NaN },
      { ...validItem, quantity: Number.POSITIVE_INFINITY },
      { ...validItem, unitCost: 0 },
      { ...validItem, unitCost: -1 },
      { ...validItem, unitCost: Number.NaN },
      {
        ...validItem,
        unitCost: Number.POSITIVE_INFINITY,
      },
    ]

    for (const item of invalidItems) {
      expect(() => normalizePurchase({
        ...purchase,
        items: [item],
      })).toThrow(PurchaseValidationError)
    }
  })

  it('accepts a fractional positive purchase quantity', () => {
    const purchase = createPurchase()

    const normalizedPurchase = normalizePurchase({
      ...purchase,
      items: [
        {
          ...purchase.items[0]!,
          quantity: 1.5,
          unitCost: 100,
        },
      ],
    })

    expect(normalizedPurchase.items[0]).toMatchObject({
      quantity: 1.5,
      totalCost: 150,
    })
    expect(normalizedPurchase.totalAmount).toBe(150)
  })

  it('rejects invalid numeric purchase data before side effects', () => {
    const products = [createProduct()]
    const purchase = createPurchase()
    const randomUUID = vi.spyOn(crypto, 'randomUUID')

    purchase.items[0] = {
      ...purchase.items[0]!,
      unitCost: 0,
    }

    try {
      expect(() => completePurchase(
        purchase,
        products,
      )).toThrow(PurchaseValidationError)
      expect(products[0]?.quantity).toBe(10)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })

  it('completes purchase and increases stock', () => {
    const products = [createProduct()]
    const purchase = createPurchase()

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(true)

    expect(result.purchase).toMatchObject({
      id: purchase.id,
      status: 'completed',
    })

    expect(result.products[0]?.quantity).toBe(15)

    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      productId: 'product-001',
      type: 'purchase',
      quantity: 5,
      unit: 'kg',
      referenceId: purchase.id,
    })

    expect(result.transaction).toMatchObject({
      type: 'expense',
      category: 'purchase',
      amount: 500,
      paymentMethod: 'cash',
      transactionDate: purchase.purchaseDate,
      referenceId: purchase.id,
      status: 'completed',
    })
  })

  it('rejects a purchase item with a mismatching unit before side effects', () => {
    const products = [createProduct()]
    const purchase = createPurchase()
    const randomUUID = vi.spyOn(crypto, 'randomUUID')

    purchase.items[0] = {
      ...purchase.items[0]!,
      unit: 'box',
    }

    try {
      expect(() => completePurchase(
        purchase,
        products,
      )).toThrow(PurchaseValidationError)
      expect(products[0]?.quantity).toBe(10)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })

  it('completes purchase with multiple items', () => {
    const products = [
      createProduct('product-001', 10),
      createProduct('product-002', 20),
    ]

    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 5,
        unit: 'kg',
        unitCost: 100,
        totalCost: 500,
      },
      {
        productId: 'product-002',
        quantity: 3,
        unit: 'kg',
        unitCost: 200,
        totalCost: 600,
      },
    ]

    purchase.totalAmount = 1100

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(true)

    expect(
      result.products.find(
        (product) =>
          product.id === 'product-001',
      )?.quantity,
    ).toBe(15)

    expect(
      result.products.find(
        (product) =>
          product.id === 'product-002',
      )?.quantity,
    ).toBe(23)

    expect(result.movements).toHaveLength(2)
    expect(result.transaction?.amount).toBe(1100)
  })

  it('completes duplicate items as one traceable movement', () => {
    const products = [createProduct()]
    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitCost: 100,
        totalCost: 300,
      },
    ]
    purchase.totalAmount = 500

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(true)
    expect(result.products[0]?.quantity).toBe(15)
    expect(result.purchase?.items).toHaveLength(1)
    expect(result.purchase?.items[0]?.quantity).toBe(5)
    expect(result.movements).toHaveLength(1)
    expect(result.movements[0]).toMatchObject({
      productId: 'product-001',
      type: 'purchase',
      quantity: 5,
      referenceId: purchase.id,
    })
    expect(result.transaction?.amount).toBe(500)
  })

  it('rejects a conflicting legacy draft before completion side effects', () => {
    const products = [createProduct()]
    const purchase = createPurchase()
    const randomUUID = vi.spyOn(crypto, 'randomUUID')

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitCost: 120,
        totalCost: 360,
      },
    ]

    try {
      expect(() => completePurchase(
        purchase,
        products,
      )).toThrow(PurchaseValidationError)
      expect(products[0]?.quantity).toBe(10)
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })

  it('rejects purchase that is not a draft', () => {
    const products = [createProduct()]
    const purchase = createPurchase(
      'completed',
    )

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.purchase).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.products[0]?.quantity).toBe(10)
    expect(result.transaction).toBeUndefined()
  })

  it('rejects a cancelled purchase', () => {
    const products = [createProduct()]
    const purchase = createPurchase('cancelled')

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.purchase).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.products[0]?.quantity).toBe(10)
    expect(result.transaction).toBeUndefined()
  })

  it('rejects purchase without items', () => {
    const products = [createProduct()]
    const purchase = createPurchase()

    purchase.items = []
    purchase.totalAmount = 0

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.purchase).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.transaction).toBeUndefined()
    expect(result.products).toEqual(products)
  })

  it('rejects purchase when product is missing', () => {
    const products = [createProduct()]
    const purchase = createPurchase()

    purchase.items[0] = {
      productId: 'missing-product',
      quantity: 5,
      unit: 'kg',
      unitCost: 100,
      totalCost: 500,
    }

    const result = completePurchase(
      purchase,
      products,
    )

    expect(result.success).toBe(false)
    expect(result.purchase).toBeUndefined()
    expect(result.movements).toHaveLength(0)
    expect(result.transaction).toBeUndefined()
    expect(result.products[0]?.quantity).toBe(10)
  })
})

describe('updatePurchase', () => {
  it('rejects updates to a conflicting legacy draft', () => {
    const purchase = createPurchase()

    purchase.items = [
      {
        productId: 'product-001',
        quantity: 2,
        unit: 'kg',
        unitCost: 100,
        totalCost: 200,
      },
      {
        productId: 'product-001',
        quantity: 3,
        unit: 'kg',
        unitCost: 120,
        totalCost: 360,
      },
    ]

    expect(() => updatePurchase(purchase, {
      note: 'Updated note',
    })).toThrow(PurchaseValidationError)
  })

  it('updates a draft purchase with normalized items and a system-managed timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:00:00'))

    try {
      const purchase = createPurchase()

      const updatedPurchase = updatePurchase(purchase, {
        supplierName: 'Updated Supplier',
        note: 'Updated note',
        items: [
          {
            productId: 'product-001',
            quantity: 2,
            unit: 'kg',
            unitCost: 100,
            totalCost: 200,
          },
          {
            productId: 'product-001',
            quantity: 3,
            unit: 'kg',
            unitCost: 100,
            totalCost: 300,
          },
        ],
      })

      expect(updatedPurchase).toMatchObject({
        supplierName: 'Updated Supplier',
        note: 'Updated note',
        totalAmount: 500,
        updatedAt: new Date('2026-08-18T12:00:00'),
      })
      expect(updatedPurchase.items).toHaveLength(1)
      expect(updatedPurchase.items[0]).toMatchObject({
        quantity: 5,
        totalCost: 500,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects direct changes to purchase identity, status, and system fields', () => {
    const purchase = createPurchase()

    const invalidUpdates: Partial<Purchase>[] = [
      { id: 'purchase-002' },
      { purchaseNumber: 'PUR-0002' },
      { createdAt: new Date('2026-01-01') },
      { updatedAt: new Date('2026-01-01') },
      { status: 'completed' },
      { totalAmount: 999 },
    ]

    for (const updates of invalidUpdates) {
      expect(() => updatePurchase(purchase, updates)).toThrow(
        PurchaseValidationError,
      )
    }
  })

  it('rejects updates, including note changes, for terminal purchases', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const purchase = createPurchase(status)

      expect(() => updatePurchase(purchase, {
        note: 'Updated note',
      })).toThrow(PurchaseValidationError)
      expect(purchase.note).toBeUndefined()
    }
  })
})
