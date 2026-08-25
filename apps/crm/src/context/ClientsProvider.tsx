import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  deactivateClient as deactivateClientCore,
  type Client,
} from '@madina/core'
import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { ClientsContext } from './ClientsContext'

interface ClientsProviderProps {
  children: ReactNode
}

type StoredClient = Omit<
  Client,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'clients'

function restoreClient(
  client: StoredClient,
): Client {
  return {
    ...client,
    createdAt: new Date(client.createdAt),
    updatedAt: new Date(client.updatedAt),
  }
}

function loadClients(): Client[] {
  const storedClients =
    loadStorage<StoredClient[]>(
      STORAGE_KEY,
      [],
    )

  return storedClients.map(
    restoreClient,
  )
}

export function ClientsProvider({
  children,
}: ClientsProviderProps) {
  const [clients, setClients] =
    useState<Client[]>(loadClients)

  const addClient = useCallback(
    (client: Client) => {
      setClients((currentClients) => {
        const nextClients = [
          client,
          ...currentClients,
        ]

        saveStorage(
          STORAGE_KEY,
          nextClients,
        )

        return nextClients
      })
    },
    [],
  )

  const updateClient = useCallback(
    (
      clientId: string,
      updates: Partial<Client>,
    ) => {
      setClients((currentClients) => {
        const nextClients =
          currentClients.map((client) =>
            client.id === clientId
              ? {
                ...client,
                ...updates,
                updatedAt: new Date(),
              }
              : client,
          )

        saveStorage(
          STORAGE_KEY,
          nextClients,
        )

        return nextClients
      })
    },
    [],
  )

  const deactivateClient = useCallback(
    (clientId: string) => {
      const client = clients.find(
        (currentClient) =>
          currentClient.id === clientId,
      )

      if (!client) {
        return
      }

      const deactivatedClient =
        deactivateClientCore(client)

      const nextClients = clients.map(
        (currentClient) =>
          currentClient.id === clientId
            ? deactivatedClient
            : currentClient,
      )

      saveStorage(STORAGE_KEY, nextClients)
      setClients(nextClients)
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
      addClient,
      updateClient,
      deactivateClient,
      getClientById,
    }),
    [
      clients,
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
