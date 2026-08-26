import type { Client } from '../types/client'

export interface ClientRepository {
  findAll(): Promise<Client[]>
  findById(
    clientId: string,
  ): Promise<Client | undefined>
}
