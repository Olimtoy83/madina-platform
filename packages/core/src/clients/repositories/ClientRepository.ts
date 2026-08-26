import type { Client } from '../types/client'

export interface ClientRepository {
  findAll(): Promise<Client[]>
}
