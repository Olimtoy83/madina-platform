import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeRetailSale,
  getRetailLocations,
  getRetailProductByBarcode,
  getRetailProductPrice,
  getRetailProducts,
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

  it('does not issue an unbounded Product request for a blank search', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getRetailProducts('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
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
