import type {
  Client,
  ClientRepository,
} from '@madina/core'

export class InMemoryClientRepository
  implements ClientRepository {
  private readonly clients: Client[]

  constructor(initialClients: Client[] = []) {
    this.clients = [...initialClients]
  }

  async findAll(): Promise<Client[]> {
    return [...this.clients]
  }
}
