import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRetailLocations } from './retailApi'
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
})
