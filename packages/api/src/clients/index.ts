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
