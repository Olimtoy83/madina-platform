import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { bootstrapClientsToServer } from './clientServerBootstrap'

class StorageDouble {
  values =
    new Map<string, string>()

  getItem(key: string) {
    return (
      this.values.get(key) ??
      null
    )
  }

  setItem(
    key: string,
    value: string,
  ) {
    this.values.set(
      key,
      value,
    )
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const clientsStorageKey =
  'madina-crm:v1:clients'

const migrationMarkerKey =
  'madina-crm:migration:clients-to-server:v1'

const originalStorage =
  globalThis.localStorage

function installStorage(
  storage: StorageDouble,
) {
  Object.defineProperty(
    globalThis,
    'localStorage',
    {
      configurable: true,
      value: storage,
    },
  )
}

function installFetch(
  responseBody: unknown,
  status = 200,
) {
  const fetchMock =
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(responseBody),
        {
          status,
          headers: {
            'Content-Type':
              'application/json',
          },
        },
      ),
    )

  vi.stubGlobal(
    'fetch',
    fetchMock,
  )

  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()

  Object.defineProperty(
    globalThis,
    'localStorage',
    {
      configurable: true,
      value: originalStorage,
    },
  )
})

describe(
  'clientServerBootstrap',
  () => {
    it(
      'imports legacy clients and writes migration marker after success',
      async () => {
        const storage =
          new StorageDouble()

        storage.values.set(
          clientsStorageKey,
          JSON.stringify([
            {
              id: 'legacy-client-1',
              createdAt:
                '2026-08-01T10:00:00.000Z',
              updatedAt:
                '2026-08-02T10:00:00.000Z',
              name: 'Ahmad',
              phone:
                '+966500000000',
              status: 'active',
            },
          ]),
        )

        installStorage(storage)

        const fetchMock =
          installFetch({
            created: 1,
            updated: 0,
          })

        const result =
          await bootstrapClientsToServer()

        expect(result).toEqual({
          skipped: false,
          imported: 1,
          created: 1,
          updated: 0,
        })

        expect(
          storage.getItem(
            migrationMarkerKey,
          ),
        ).toBe('done')

        const [url, options] =
          fetchMock.mock.calls[0]

        expect(url).toBe(
          '/api/v1/clients/import',
        )

        expect(options?.method).toBe(
          'POST',
        )

        expect(
          JSON.parse(
            options?.body as string,
          ),
        ).toEqual({
          clients: [
            {
              id: 'legacy-client-1',
              createdAt:
                '2026-08-01T10:00:00.000Z',
              updatedAt:
                '2026-08-02T10:00:00.000Z',
              name: 'Ahmad',
              phone:
                '+966500000000',
              status: 'active',
            },
          ],
        })

        expect(
          storage.getItem(
            clientsStorageKey,
          ),
        ).not.toBeNull()
      },
    )

    it(
      'skips import when migration marker already exists',
      async () => {
        const storage =
          new StorageDouble()

        storage.values.set(
          migrationMarkerKey,
          'done',
        )

        storage.values.set(
          clientsStorageKey,
          JSON.stringify([
            {
              id: 'legacy-client-1',
              createdAt:
                '2026-08-01T10:00:00.000Z',
              updatedAt:
                '2026-08-02T10:00:00.000Z',
              name: 'Ahmad',
              status: 'active',
            },
          ]),
        )

        installStorage(storage)

        const fetchMock =
          installFetch({
            created: 1,
            updated: 0,
          })

        const result =
          await bootstrapClientsToServer()

        expect(result).toEqual({
          skipped: true,
          imported: 0,
          created: 0,
          updated: 0,
        })

        expect(
          fetchMock,
        ).not.toHaveBeenCalled()
      },
    )

    it(
      'does not write migration marker when import fails',
      async () => {
        const storage =
          new StorageDouble()

        storage.values.set(
          clientsStorageKey,
          JSON.stringify([
            {
              id: 'legacy-client-1',
              createdAt:
                '2026-08-01T10:00:00.000Z',
              updatedAt:
                '2026-08-02T10:00:00.000Z',
              name: 'Ahmad',
              status: 'active',
            },
          ]),
        )

        installStorage(storage)

        installFetch(
          {
            message:
              'Import failed',
          },
          500,
        )

        await expect(
          bootstrapClientsToServer(),
        ).rejects.toMatchObject({
          status: 500,
          message: 'Import failed',
        })

        expect(
          storage.getItem(
            migrationMarkerKey,
          ),
        ).toBeNull()

        expect(
          storage.getItem(
            clientsStorageKey,
          ),
        ).not.toBeNull()
      },
    )
  },
)
