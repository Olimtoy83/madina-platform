import { createContext } from 'react'
import type { Client } from '@madina/core'

export interface ClientsContextValue {
  clients: Client[]
  isLoading: boolean
  loadError: Error | null

  addClient: (
    client: Client,
  ) => Promise<Client>

  updateClient: (
    clientId: string,
    updates: Partial<Client>,
  ) => Promise<Client>

  deactivateClient: (
    clientId: string,
  ) => Promise<Client | undefined>

  getClientById: (
    clientId: string,
  ) => Client | undefined
}

export const ClientsContext =
  createContext<ClientsContextValue | null>(null)
