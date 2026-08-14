import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Client } from '@madina/core'
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

  const deleteClient = useCallback(
    (clientId: string) => {
      setClients((currentClients) => {
        const nextClients =
          currentClients.filter(
            (client) =>
              client.id !== clientId,
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
      deleteClient,
      getClientById,
    }),
    [
      clients,
      addClient,
      updateClient,
      deleteClient,
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
