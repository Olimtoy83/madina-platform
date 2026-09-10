import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRetailLocations,
  getRetailProductByBarcode,
  getRetailProducts,
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
})
