import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product } from '@madina/core'
import type { CommerceAggregateState } from '../shared/commerceState'
import type { ProductsContextValue } from './ProductsContext'

const mocks = vi.hoisted(() => ({
  adjustProductStock: vi.fn(),
  createProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  reload: vi.fn(),
  snapshot: {} as CommerceAggregateState,
  updateProduct: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()

  return {
    ...react,
    useCallback: <T,>(callback: T): T => callback,
    useMemo: <T,>(factory: () => T): T => factory(),
  }
})

vi.mock('../shared/api/commerceApi', () => ({
  adjustProductStock: mocks.adjustProductStock,
  createProduct: mocks.createProduct,
  deactivateProduct: mocks.deactivateProduct,
  updateProduct: mocks.updateProduct,
}))

vi.mock('./useTransactionalState', () => ({
  useTransactionalState: () => ({
    snapshot: mocks.snapshot,
    reload: mocks.reload,
  }),
}))

import { ProductsProvider } from './ProductsProvider'

const confirmedProduct: Product = {
  id: 'product-1',
  createdAt: new Date('2026-08-27T00:00:00.000Z'),
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
  name: 'Финики',
  category: 'dates',
  quantity: 2,
  unit: 'kg',
  costPrice: 10,
  salePrice: 15,
  status: 'active',
}

function getContextValue(): ProductsContextValue {
  const element = ProductsProvider({ children: null }) as unknown as {
    props: { value: ProductsContextValue }
  }

  return element.props.value
}

describe('ProductsProvider', () => {
  beforeEach(() => {
    mocks.snapshot = {
      products: [confirmedProduct],
      stockMovements: [],
      purchases: [],
      sales: [],
      transactions: [],
    }
    mocks.reload.mockReset()
    mocks.adjustProductStock.mockReset()
  })

  it('reloads the server aggregate after a confirmed stock adjustment', async () => {
    mocks.adjustProductStock.mockResolvedValue({
      product: {
        ...confirmedProduct,
        quantity: 3,
        createdAt: confirmedProduct.createdAt.toISOString(),
        updatedAt: confirmedProduct.updatedAt.toISOString(),
      },
    })
    const context = getContextValue()

    await expect(context.adjustProductStock('product-1', 1, 'Пересчёт'))
      .resolves.toMatchObject({ success: true, value: { quantity: 3 } })

    expect(mocks.adjustProductStock).toHaveBeenCalledWith('product-1', {
      quantity: 1,
      note: 'Пересчёт',
    })
    expect(mocks.reload).toHaveBeenCalledOnce()
  })

  it('keeps the confirmed state when a stock adjustment fails', async () => {
    mocks.adjustProductStock.mockRejectedValue(new Error('Недостаточно товара'))
    const context = getContextValue()

    await expect(context.adjustProductStock('product-1', -3))
      .resolves.toEqual({
        success: false,
        message: 'Недостаточно товара',
      })

    expect(mocks.reload).not.toHaveBeenCalled()
    expect(context.products).toBe(mocks.snapshot.products)
    expect(context.products[0]?.quantity).toBe(2)
  })
})
