import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Client } from '@madina/core'
import type {
  ClientResponse,
  UpdateClientRequest,
} from '@madina/api'
import {
  createClient as createClientApi,
  getClients,
  updateClient as updateClientApi,
} from '../shared/api/clientsApi'
import { ClientsContext } from './ClientsContext'

interface ClientsProviderProps {
  children: ReactNode
}

function toClient(
  response: ClientResponse,
): Client {
  return {
    ...response,
    createdAt: new Date(response.createdAt),
    updatedAt: new Date(response.updatedAt),
  }
}

function toUpdateRequest(
  updates: Partial<Client>,
): UpdateClientRequest {
  const request: UpdateClientRequest = {}

  if (updates.name !== undefined) {
    request.name = updates.name
  }

  if (updates.phone !== undefined) {
    request.phone = updates.phone
  }

  if (updates.email !== undefined) {
    request.email = updates.email
  }

  if (updates.company !== undefined) {
    request.company = updates.company
  }

  if (updates.note !== undefined) {
    request.note = updates.note
  }

  if (updates.status !== undefined) {
    request.status = updates.status
  }

  return request
}

export function ClientsProvider({
  children,
}: ClientsProviderProps) {
  const [clients, setClients] =
    useState<Client[]>([])

  const [isLoading, setIsLoading] =
    useState(true)

  const [loadError, setLoadError] =
    useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const responses =
          await getClients()

        if (cancelled) {
          return
        }

        setClients(
          responses.map(toClient),
        )
        setLoadError(null)
      } catch (error) {
        if (cancelled) {
          return
        }

        setLoadError(
          error instanceof Error
            ? error
            : new Error(
                'Не удалось загрузить клиентов.',
              ),
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const addClient = useCallback(
    async (
      client: Client,
    ): Promise<Client> => {
      const response =
        await createClientApi({
          name: client.name,
          phone: client.phone,
          email: client.email,
          company: client.company,
          note: client.note,
          status: client.status,
        })

      const savedClient =
        toClient(response)

      setClients((currentClients) => [
        savedClient,
        ...currentClients,
      ])

      return savedClient
    },
    [],
  )

  const updateClient = useCallback(
    async (
      clientId: string,
      updates: Partial<Client>,
    ): Promise<Client> => {
      const response =
        await updateClientApi(
          clientId,
          toUpdateRequest(updates),
        )

      const savedClient =
        toClient(response)

      setClients((currentClients) =>
        currentClients.map((client) =>
          client.id === savedClient.id
            ? savedClient
            : client,
        ),
      )

      return savedClient
    },
    [],
  )

  const deactivateClient = useCallback(
    async (
      clientId: string,
    ): Promise<Client | undefined> => {
      const exists = clients.some(
        (client) =>
          client.id === clientId,
      )

      if (!exists) {
        return undefined
      }

      const response =
        await updateClientApi(
          clientId,
          {
            status: 'inactive',
          },
        )

      const savedClient =
        toClient(response)

      setClients((currentClients) =>
        currentClients.map((client) =>
          client.id === savedClient.id
            ? savedClient
            : client,
        ),
      )

      return savedClient
    },
    [clients],
  )

  const getClientById = useCallback(
    (clientId: string) =>
      clients.find(
        (client) =>
          client.id === clientId,
      ),
    [clients],
  )

  const value = useMemo(
    () => ({
      clients,
      isLoading,
      loadError,
      addClient,
      updateClient,
      deactivateClient,
      getClientById,
    }),
    [
      clients,
      isLoading,
      loadError,
      addClient,
      updateClient,
      deactivateClient,
      getClientById,
    ],
  )

  return (
    <ClientsContext.Provider
      value={value}
    >
      {children}
    </ClientsContext.Provider>
  )
}
