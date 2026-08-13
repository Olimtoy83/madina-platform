import { createContext } from 'react'
import type { Client } from '../entities/client'

export interface ClientsContextValue {
  clients: Client[]

  addClient: (
    client: Client,
  ) => void

  updateClient: (
    clientId: string,
    updates: Partial<Client>,
  ) => void

  deleteClient: (
    clientId: string,
  ) => void

  getClientById: (
    clientId: string,
  ) => Client | undefined
}

export const ClientsContext =
  createContext<ClientsContextValue | null>(null)
