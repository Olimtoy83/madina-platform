import { describe, expect, it } from 'vitest'
import { toCommerceAggregateState } from './commerceState'

describe('toCommerceAggregateState', () => {
  it('maps the global products resource and restores ISO dates', () => {
    const state = toCommerceAggregateState({
      products: [{
        id: 'product-1', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T01:00:00.000Z',
        name: 'Dates', category: 'dates', quantity: 3, unit: 'kg', costPrice: 10, salePrice: 15, status: 'active',
      }],
    })

    expect(state.products[0]?.createdAt).toBeInstanceOf(Date)
    expect(state).not.toHaveProperty('purchases')
  })
})
