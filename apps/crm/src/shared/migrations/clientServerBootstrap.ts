import type {
  ImportClientRequest,
  ImportClientsResponse,
} from '@madina/api'
import { importClients } from '../api/clientsApi'

const CLIENTS_STORAGE_KEY =
  'madina-crm:v1:clients'

const MIGRATION_MARKER_KEY =
  'madina-crm:migration:clients-to-server:v1'

interface StoredClient {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: 'active' | 'inactive'
}

export interface ClientServerBootstrapResult {
  skipped: boolean
  imported: number
  created: number
  updated: number
}

function loadStoredClients():
  StoredClient[] {
  try {
    const rawValue =
      localStorage.getItem(
        CLIENTS_STORAGE_KEY,
      )

    if (!rawValue) {
      return []
    }

    const value = JSON.parse(rawValue)

    return Array.isArray(value)
      ? value as StoredClient[]
      : []
  } catch {
    return []
  }
}

function hasMigrationMarker(): boolean {
  try {
    return (
      localStorage.getItem(
        MIGRATION_MARKER_KEY,
      ) === 'done'
    )
  } catch {
    return false
  }
}

function saveMigrationMarker(): void {
  localStorage.setItem(
    MIGRATION_MARKER_KEY,
    'done',
  )
}

function toImportClient(
  client: StoredClient,
): ImportClientRequest {
  return {
    id: client.id,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    name: client.name,
    phone: client.phone,
    email: client.email,
    company: client.company,
    note: client.note,
    status: client.status,
  }
}

export async function bootstrapClientsToServer():
  Promise<ClientServerBootstrapResult> {
  if (hasMigrationMarker()) {
    return {
      skipped: true,
      imported: 0,
      created: 0,
      updated: 0,
    }
  }

  const storedClients =
    loadStoredClients()

  if (storedClients.length === 0) {
    saveMigrationMarker()

    return {
      skipped: false,
      imported: 0,
      created: 0,
      updated: 0,
    }
  }

  const response: ImportClientsResponse =
    await importClients({
      clients:
        storedClients.map(toImportClient),
    })

  saveMigrationMarker()

  return {
    skipped: false,
    imported: storedClients.length,
    created: response.created,
    updated: response.updated,
  }
}
