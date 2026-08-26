export type ClientStatus =
  | 'active'
  | 'inactive'

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
