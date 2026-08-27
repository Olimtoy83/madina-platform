import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adjustProductStock,
  cancelPurchase,
  cancelSale,
  completePurchase,
  completeSale,
  createProduct,
  createPurchase,
  createSale,
  deactivateProduct,
  getCommerceAggregate,
  updateProduct,
  updatePurchase,
  updateSale,
} from './commerceApi'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(bodies: unknown[]) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(response(bodies.shift())),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('commerceApi', () => {
  it('loads the full commerce aggregate from five server resources', async () => {
    const fetchMock = installFetch([
      { products: [] },
      { stockMovements: [] },
      { purchases: [] },
      { sales: [] },
      { transactions: [] },
    ])

    await expect(getCommerceAggregate()).resolves.toEqual({
      products: [], stockMovements: [], purchases: [], sales: [], transactions: [],
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/commerce/products',
      '/api/v1/commerce/stock-movements',
      '/api/v1/commerce/purchases',
      '/api/v1/commerce/sales',
      '/api/v1/commerce/transactions',
    ])
  })

  it('fails an aggregate load when one server resource fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/sales')
        ? response({ message: 'Unavailable' }, 503)
        : response(url.endsWith('/products') ? { products: [] }
          : url.endsWith('/stock-movements') ? { stockMovements: [] }
            : url.endsWith('/purchases') ? { purchases: [] }
              : { transactions: [] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCommerceAggregate()).rejects.toThrow('Unavailable')
  })

  it('uses server endpoints for every permitted commerce mutation', async () => {
    const fetchMock = installFetch(Array.from({ length: 12 }, () => ({ success: true })))

    await createProduct({ name: 'Dates', category: 'dates', unit: 'kg', costPrice: 10, salePrice: 15, status: 'active', initialQuantity: 0 })
    await updateProduct('product/1', { name: 'New dates' })
    await deactivateProduct('product/1')
    await adjustProductStock('product/1', { quantity: 2, note: 'Count' })
    await createPurchase({ purchaseNumber: 'PUR-1', purchaseDate: '2026-08-27T00:00:00.000Z', supplierName: 'Supplier', items: [], paymentMethod: 'cash' })
    await updatePurchase('purchase/1', { supplierName: 'New supplier' })
    await cancelPurchase('purchase/1')
    await completePurchase('purchase/1')
    await createSale({ saleNumber: 'SAL-1', saleDate: '2026-08-27T00:00:00.000Z', clientName: 'Client', items: [], paymentMethod: 'cash' })
    await updateSale('sale/1', { clientName: 'New client' })
    await cancelSale('sale/1')
    await completeSale('sale/1')

    expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['/api/v1/commerce/products', 'POST'],
      ['/api/v1/commerce/products/product%2F1', 'PATCH'],
      ['/api/v1/commerce/products/product%2F1/deactivate', 'POST'],
      ['/api/v1/commerce/products/product%2F1/stock-adjustments', 'POST'],
      ['/api/v1/commerce/purchases', 'POST'],
      ['/api/v1/commerce/purchases/purchase%2F1', 'PATCH'],
      ['/api/v1/commerce/purchases/purchase%2F1/cancel', 'POST'],
      ['/api/v1/commerce/purchases/purchase%2F1/complete', 'POST'],
      ['/api/v1/commerce/sales', 'POST'],
      ['/api/v1/commerce/sales/sale%2F1', 'PATCH'],
      ['/api/v1/commerce/sales/sale%2F1/cancel', 'POST'],
      ['/api/v1/commerce/sales/sale%2F1/complete', 'POST'],
    ])
  })
})
