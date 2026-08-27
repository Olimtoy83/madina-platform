import { describe, expect, it } from 'vitest'
import { toCommerceAggregateState } from './commerceState'

describe('toCommerceAggregateState', () => {
  it('maps every server resource and restores ISO dates', () => {
    const state = toCommerceAggregateState({
      products: [{
        id: 'product-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z',
        name: 'Dates', category: 'dates', quantity: 3, unit: 'kg', costPrice: 10, salePrice: 15, status: 'active',
      }],
      stockMovements: [{
        id: 'movement-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z',
        productId: 'product-1', type: 'adjustment', quantity: 3, unit: 'kg',
      }],
      purchases: [{
        id: 'purchase-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z', purchaseDate: '2026-08-27T00:00:00.000Z',
        purchaseNumber: 'PUR-1', supplierName: 'Supplier', items: [], totalAmount: 0, paymentMethod: 'cash', status: 'draft',
      }],
      sales: [{
        id: 'sale-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z', saleDate: '2026-08-27T00:00:00.000Z',
        saleNumber: 'SAL-1', clientName: 'Client', items: [], totalAmount: 0, paymentMethod: 'cash', status: 'draft',
      }],
      transactions: [{
        id: 'transaction-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z', transactionDate: '2026-08-27T00:00:00.000Z',
        type: 'income', category: 'sale', amount: 15, paymentMethod: 'cash', status: 'completed',
      }],
    })

    expect(state.products[0]?.createdAt).toBeInstanceOf(Date)
    expect(state.stockMovements[0]?.updatedAt).toBeInstanceOf(Date)
    expect(state.purchases[0]?.purchaseDate).toBeInstanceOf(Date)
    expect(state.sales[0]?.saleDate).toBeInstanceOf(Date)
    expect(state.transactions[0]?.transactionDate).toBeInstanceOf(Date)
  })
})
