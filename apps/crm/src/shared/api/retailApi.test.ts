import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeRetailSale,
  completeRetailReturn,
  getRetailCompletedSale,
  getRetailCompletedSales,
  getRetailLocations,
  getRetailOfflineAuthorities,
  getRetailProductByBarcode,
  getRetailProductPrice,
  getRetailProducts,
  isRetailSaleInsufficientStockError,
  RETAIL_INSUFFICIENT_STOCK_CODE,
  type RetailSaleCompletionRequest,
} from './retailApi'
import { HttpError } from './httpClient'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retailApi', () => {
  it('validates the typed offline Authority list and rejects malformed or duplicate summaries', async () => {
    const valid = { authorityId: 'authority-1', authorityVersion: 1, terminalId: 'terminal-1', terminalKeyVersion: 1, userId: 'user-1', locationId: 'location-1', issuedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', currencyCode: 'USD', currencyExponent: 2, permitCount: 2, revoked: false }
    const fetchMock = vi.fn().mockResolvedValue(response({ authorities: [valid] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRetailOfflineAuthorities('location / 1')).resolves.toEqual([valid])
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/retail/locations/location%20%2F%201/offline-authorities')
    for (const authorities of [[valid, valid], [{ ...valid, terminalKeyVersion: 0 }], [{ ...valid, expiresAt: 'invalid' }], [{ ...valid, currencyCode: 'bad' }]]) {
      fetchMock.mockResolvedValueOnce(response({ authorities }))
      await expect(getRetailOfflineAuthorities('location-1')).rejects.toThrow('Retail Offline Authority list is invalid.')
    }
  })

  const completionPayload: RetailSaleCompletionRequest = {
    clientOperationId: 'operation-1',
    saleId: 'sale-1',
    lines: [{ id: 'line-1', productId: 'product-1', quantity: 2 }],
    allocations: [{
      id: 'allocation-1', method: 'cash', amountMinor: 2500, ordinal: 0,
    }],
  }

  const completionBody = {
    sale: { id: 'sale-1', subtotal_minor: 2500 },
    items: [{ id: 'line-1', sale_id: 'sale-1' }],
    allocations: [{ id: 'allocation-1', sale_id: 'sale-1' }],
  }

  it.each([201, 200] as const)(
    'posts the exact completion payload and preserves status %i',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(response(completionBody, status))
      vi.stubGlobal('fetch', fetchMock)

      await expect(completeRetailSale('location / 1', completionPayload)).resolves.toEqual({
        status,
        body: completionBody,
      })

      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/api/v1/retail/locations/location%20%2F%201/sales/complete',
      ])
      const options = fetchMock.mock.calls[0]?.[1]
      expect(options).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify(completionPayload),
      })
      expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json')
      expect(JSON.parse(options?.body as string)).toEqual(completionPayload)
    },
  )

  it('preserves HttpError for a completion conflict without interpreting it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      message: 'IDEMPOTENCY_CONFLICT',
    }, 409)))

    const error = await completeRetailSale('location-1', completionPayload)
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 409,
      message: 'IDEMPOTENCY_CONFLICT',
      body: { message: 'IDEMPOTENCY_CONFLICT' },
    })
  })

  it('recognizes only the structured insufficient-stock completion rejection', () => {
    expect(isRetailSaleInsufficientStockError(new HttpError(409, 'stock', {
      code: RETAIL_INSUFFICIENT_STOCK_CODE,
    }))).toBe(true)
    expect(isRetailSaleInsufficientStockError(new HttpError(409, 'stock', {
      code: 'OTHER_CONFLICT',
    }))).toBe(false)
    expect(isRetailSaleInsufficientStockError(new HttpError(409, 'stock'))).toBe(false)
    expect(isRetailSaleInsufficientStockError(new HttpError(500, 'stock', {
      code: RETAIL_INSUFFICIENT_STOCK_CODE,
    }))).toBe(false)
  })

  it('loads the encoded completed Retail Sale evidence without client-side monetary mapping', async () => {
    const body = { sale: { id: 'sale-1', location_id: 'location-1', location_name: 'Store', location_code: 'STORE', status: 'completed', currency_code: 'USD', currency_exponent: 2, payable_total_minor: 99, completed_at: '2026-09-19T00:00:00.000Z' }, items: [{ sale_item_id: 'item-1', product_id: 'product-1', source_id: 'SKU-1', name: 'Product', quantity: 1, unit_price_minor: 100, line_total_minor: 100, discount_amount_minor: 1, already_returned_quantity: 0, already_refunded_amount_minor: 0 }], paymentAllocations: [] }
    const fetchMock = vi.fn().mockResolvedValue(response(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRetailCompletedSale('location / 1', 'sale / 1')).resolves.toEqual(body)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/retail/locations/location%20%2F%201/sales/sale%20%2F%201'])
  })

  it('loads the location-scoped completed Retail Sales journal with server-owned filters and cursor', async () => {
    const body = { sales: { items: [{ id: 'sale-1', locationId: 'location-1', currencyCode: 'USD', currencyExponent: 2, payableTotalMinor: 99, completedAt: '2026-09-19T00:00:00.000Z', paymentMethods: ['cash'], hasReturns: false }], nextCursor: 'next-page' } }
    const fetchMock = vi.fn().mockResolvedValue(response(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRetailCompletedSales('location / 1', { dateFrom: '2026-09-01', dateTo: '2026-09-30', cursor: 'next page', limit: '10' })).resolves.toEqual(body.sales)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/retail/locations/location%20%2F%201/sales?dateFrom=2026-09-01&dateTo=2026-09-30&cursor=next+page&limit=10'])
  })

  it.each([201, 200] as const)('posts only Return intent and accepts status %i', async (status) => {
    const payload = { clientOperationId: 'return-operation-1', items: [{ saleItemId: 'item-1', quantity: 1 }] }
    const body = { saleReturn: { id: 'return-1', original_sale_id: 'sale-1', completed_at: '2026-09-19T00:00:00.000Z' }, items: [], refundAllocations: [], movements: [] }
    const fetchMock = vi.fn().mockResolvedValue(response(body, status))
    vi.stubGlobal('fetch', fetchMock)
    await expect(completeRetailReturn('location / 1', 'sale / 1', payload)).resolves.toEqual({ status, body })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/retail/locations/location%20%2F%201/sales/sale%20%2F%201/returns'])
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(payload)
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain('amountMinor')
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain('method')
  })

  it('preserves Return server errors from the shared HTTP transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ message: 'IDEMPOTENCY_CONFLICT' }, 409)))
    const error = await completeRetailReturn('location-1', 'sale-1', { clientOperationId: 'return-1', items: [{ saleItemId: 'item-1', quantity: 1 }] }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 409, message: 'IDEMPOTENCY_CONFLICT' })
  })

  it('loads locations and maps JSON timestamps to canonical retail locations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      locations: [{
        id: 'location-1',
        code: 'STORE-1',
        name: 'Main store',
        type: 'store',
        status: 'active',
        currencyCode: 'UZS',
        currencyExponent: 0,
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T09:00:00.000Z',
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailLocations()).resolves.toEqual([{
      id: 'location-1',
      code: 'STORE-1',
      name: 'Main store',
      type: 'store',
      status: 'active',
      currencyCode: 'UZS',
      currencyExponent: 0,
      createdAt: new Date('2026-09-10T08:00:00.000Z'),
      updatedAt: new Date('2026-09-10T09:00:00.000Z'),
    }])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/retail/locations',
    ])
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it('does not mask errors from the shared HTTP client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      message: 'Locations are unavailable.',
    }, 503)))

    const error = await getRetailLocations().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 503,
      message: 'Locations are unavailable.',
    })
  })

  it('uses the encoded Product search endpoint and maps Product timestamps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      products: [{
        id: 'product-1',
        sourceId: 'WILMAX / 1',
        name: 'Wilmax plate',
        status: 'active',
        baseUnit: 'piece',
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T09:00:00.000Z',
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailProducts(' Wilmax / plate ')).resolves.toEqual([{
      id: 'product-1',
      sourceId: 'WILMAX / 1',
      name: 'Wilmax plate',
      status: 'active',
      baseUnit: 'piece',
      createdAt: new Date('2026-09-10T08:00:00.000Z'),
      updatedAt: new Date('2026-09-10T09:00:00.000Z'),
    }])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/retail/products?search=Wilmax%20%2F%20plate',
    ])
  })

  it('loads the Product catalog when the search is blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ products: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailProducts('   ')).resolves.toEqual([])
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/retail/products'])
  })

  it('uses the encoded barcode endpoint and maps Product timestamps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      product: {
        id: 'product-1',
        sourceId: 'WILMAX-1',
        name: 'Wilmax plate',
        status: 'active',
        baseUnit: 'piece',
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-10T09:00:00.000Z',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailProductByBarcode(' 00/123 ')).resolves.toEqual({
      id: 'product-1',
      sourceId: 'WILMAX-1',
      name: 'Wilmax plate',
      status: 'active',
      baseUnit: 'piece',
      createdAt: new Date('2026-09-10T08:00:00.000Z'),
      updatedAt: new Date('2026-09-10T09:00:00.000Z'),
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/retail/products/by-barcode/00%2F123',
    ])
  })

  it('does not mask barcode not-found errors from the shared HTTP client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      message: 'Retail Product barcode not found.',
    }, 404)))

    const error = await getRetailProductByBarcode('missing').catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 404,
      message: 'Retail Product barcode not found.',
    })
  })

  it('uses the encoded location-specific Product price endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      unitPriceMinor: 123456789,
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailProductPrice('location / 1', 'product / 1')).resolves.toBe(
      123456789,
    )
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/retail/locations/location%20%2F%201/products/product%20%2F%201/price',
    ])
  })

  it('does not mask missing Product price errors from the shared HTTP client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      message: 'Retail Product price not found.',
    }, 404)))

    const error = await getRetailProductPrice('location-1', 'product-1').catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 404,
      message: 'Retail Product price not found.',
    })
  })

  it('does not mask Product price request errors from the shared HTTP client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      message: 'Retail Product prices are unavailable.',
    }, 503)))

    const error = await getRetailProductPrice('location-1', 'product-1').catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({
      status: 503,
      message: 'Retail Product prices are unavailable.',
    })
  })
})
