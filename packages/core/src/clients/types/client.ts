import type { BaseEntity } from '@madina/shared'

export type ClientStatus =
  | 'active'
  | 'inactive'

export interface Client extends BaseEntity {
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: ClientStatus
}
