import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  HttpError,
  requestJson,
  subscribeToUnauthorized,
} from './httpClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('httpClient', () => {
  it('returns parsed JSON for a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal(
      'fetch',
      fetchMock,
    )

    const result =
      await requestJson<{ ok: boolean }>(
        '/api/test',
      )

    expect(result).toEqual({
      ok: true,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('serializes a JSON request body and adds content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal(
      'fetch',
      fetchMock,
    )

    await requestJson(
      '/api/test',
      {
        method: 'POST',
        body: {
          name: 'Ahmad',
        },
      },
    )

    const [, options] =
      fetchMock.mock.calls[0]

    expect(options?.body).toBe(
      JSON.stringify({
        name: 'Ahmad',
      }),
    )

    expect(
      new Headers(
        options?.headers,
      ).get('Content-Type'),
    ).toBe('application/json')
    expect(options?.credentials).toBe('same-origin')
  })

  it('throws HttpError with API message for a failed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Client not found',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal(
      'fetch',
      fetchMock,
    )

    await expect(
      requestJson('/api/test'),
    ).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
      message: 'Client not found',
    } satisfies Partial<HttpError>)
  })

  it('notifies subscribers only for 401 responses', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToUnauthorized(listener)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ message: 'Authentication required.' }),
        { status: 401 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ message: 'Permission denied.' }),
        { status: 403 },
      ))

    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson('/api/protected')).rejects.toMatchObject({
      status: 401,
    })
    await expect(requestJson('/api/forbidden')).rejects.toMatchObject({
      status: 403,
    })

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
