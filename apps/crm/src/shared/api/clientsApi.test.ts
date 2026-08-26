import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createClient,
  getClient,
  getClients,
  updateClient,
} from './clientsApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clientsApi', () => {
  it('gets the clients list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          clients: [
            {
              id: 'client-1',
              createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
              name: 'Ahmad',
              status: 'active',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const result = await getClients()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'client-1',
      name: 'Ahmad',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/clients',
      expect.any(Object),
    )
  })

  it('gets one client with an encoded id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'client/1',
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
          name: 'Ahmad',
          status: 'active',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    await getClient('client/1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/clients/client%2F1',
      expect.any(Object),
    )
  })

  it('creates a client with POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'client-1',
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
          name: 'Ahmad',
          status: 'active',
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    await createClient({
      name: 'Ahmad',
      status: 'active',
    })

    const [, options] =
      fetchMock.mock.calls[0]

    expect(options?.method).toBe('POST')
    expect(options?.body).toBe(
      JSON.stringify({
        name: 'Ahmad',
        status: 'active',
      }),
    )
  })

  it('updates a client with PATCH', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'client-1',
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T01:00:00.000Z',
          name: 'Ahmad',
          status: 'inactive',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    await updateClient(
      'client-1',
      {
        status: 'inactive',
      },
    )

    const [, options] =
      fetchMock.mock.calls[0]

    expect(options?.method).toBe('PATCH')
    expect(options?.body).toBe(
      JSON.stringify({
        status: 'inactive',
      }),
    )
  })
})
