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

  async findById(
    clientId: string,
  ): Promise<Client | undefined> {
    return this.clients.find(
      (client) => client.id === clientId,
    )
  }

  async save(
    client: Client,
  ): Promise<void> {
    this.clients.push(client)
  }

  async update(
    client: Client,
  ): Promise<void> {
    const index = this.clients.findIndex(
      (currentClient) =>
        currentClient.id === client.id,
    )

    if (index === -1) {
      return
    }

    this.clients[index] = client
  }
}
