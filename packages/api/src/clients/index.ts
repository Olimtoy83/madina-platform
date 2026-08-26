export type ClientStatus =
  | 'active'
  | 'inactive'

export interface CreateClientRequest {
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: ClientStatus
}

export type UpdateClientRequest =
  Partial<CreateClientRequest>

export interface ImportClientRequest {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: ClientStatus
}

export interface ImportClientsRequest {
  clients: ImportClientRequest[]
}

export interface ImportClientsResponse {
  created: number
  updated: number
}

export interface ClientResponse {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: ClientStatus
}

export interface ClientsListResponse {
  clients: ClientResponse[]
}
