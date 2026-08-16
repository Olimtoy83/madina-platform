import { describe, expect, it } from 'vitest'
import type { Purchase } from '../types/purchase'
import {
  getNextPurchaseNumber,
  getPurchaseItemTotal,
  getPurchaseTotal,
} from './PurchaseCalculationService'

function createPurchase(
  purchaseNumber: string,
): Purchase {
  const now = new Date()

  return {
    id: `purchase-${purchaseNumber}`,
    createdAt: now,
    updatedAt: now,
    purchaseNumber,
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
      {
        productId: 'product-002',
        quantity: 2,
        unit: 'kg',
        unitCost: 200,
        totalCost: 400,
      },
    ],
    totalAmount: 900,
    paymentMethod: 'cash',
    status: 'draft',
  }
}

describe('getPurchaseItemTotal', () => {
  it('calculates item total', () => {
    expect(
      getPurchaseItemTotal(5, 100),
    ).toBe(500)
  })
})

describe('getPurchaseTotal', () => {
  it('calculates total for all purchase items', () => {
    const purchase = createPurchase('PUR-0001')

    expect(
      getPurchaseTotal(purchase),
    ).toBe(900)
  })

  it('returns zero for an empty purchase', () => {
    const purchase = createPurchase('PUR-0001')
    purchase.items = []

    expect(
      getPurchaseTotal(purchase),
    ).toBe(0)
  })
})

describe('getNextPurchaseNumber', () => {
  it('returns the next purchase number', () => {
    const purchases = [
      createPurchase('PUR-0001'),
      createPurchase('PUR-0003'),
      createPurchase('PUR-0002'),
    ]

    expect(
      getNextPurchaseNumber(purchases),
    ).toBe('PUR-0004')
  })

  it('starts from PUR-0001 for an empty array', () => {
    expect(
      getNextPurchaseNumber([]),
    ).toBe('PUR-0001')
  })

  it('ignores invalid purchase numbers', () => {
    const purchases = [
      createPurchase('PUR-0005'),
      createPurchase('INVALID'),
    ]

    expect(
      getNextPurchaseNumber(purchases),
    ).toBe('PUR-0006')
  })
})
