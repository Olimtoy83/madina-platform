import type {
  ClientResponse,
  ClientsListResponse,
  CreateClientRequest,
  UpdateClientRequest,
} from '@madina/api'
import { requestJson } from './httpClient'

const clientsUrl = '/api/v1/clients'

export async function getClients():
  Promise<ClientResponse[]> {
  const response =
    await requestJson<ClientsListResponse>(
      clientsUrl,
    )

  return response.clients
}

export function getClient(
  clientId: string,
): Promise<ClientResponse> {
  return requestJson<ClientResponse>(
    `${clientsUrl}/${encodeURIComponent(clientId)}`,
  )
}

export function createClient(
  input: CreateClientRequest,
): Promise<ClientResponse> {
  return requestJson<ClientResponse>(
    clientsUrl,
    {
      method: 'POST',
      body: input,
    },
  )
}

export function updateClient(
  clientId: string,
  input: UpdateClientRequest,
): Promise<ClientResponse> {
  return requestJson<ClientResponse>(
    `${clientsUrl}/${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      body: input,
    },
  )
}
