import type { DatabaseSync } from 'node:sqlite'
import type {
  Client,
  ClientRepository,
  ClientStatus,
  ClientUnitOfWork,
} from '@madina/core'
import type { AuditEvent } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface ClientRow {
  id: string
  created_at: string
  updated_at: string
  name: string
  phone: string | null
  email: string | null
  company: string | null
  note: string | null
  status: ClientStatus
}

function toOptionalText(
  value: string | null,
): string | undefined {
  return value ?? undefined
}

function toClient(
  row: ClientRow,
): Client {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    name: row.name,
    phone: toOptionalText(row.phone),
    email: toOptionalText(row.email),
    company: toOptionalText(row.company),
    note: toOptionalText(row.note),
    status: row.status,
  }
}

class SqliteClientUnitOfWork
  implements ClientUnitOfWork {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  async findAll(): Promise<Client[]> {
    const rows = this.database
      .prepare(`
        SELECT
          id,
          created_at,
          updated_at,
          name,
          phone,
          email,
          company,
          note,
          status
        FROM clients
      `)
      .all() as unknown as ClientRow[]

    return rows.map(toClient)
  }

  async findById(
    clientId: string,
  ): Promise<Client | undefined> {
    const row = this.database
      .prepare(`
        SELECT
          id,
          created_at,
          updated_at,
          name,
          phone,
          email,
          company,
          note,
          status
        FROM clients
        WHERE id = ?
      `)
      .get(clientId) as
        | ClientRow
        | undefined

    return row
      ? toClient(row)
      : undefined
  }

  async save(
    client: Client,
  ): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO clients (
          id,
          created_at,
          updated_at,
          name,
          phone,
          email,
          company,
          note,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        client.id,
        client.createdAt.toISOString(),
        client.updatedAt.toISOString(),
        client.name,
        client.phone ?? null,
        client.email ?? null,
        client.company ?? null,
        client.note ?? null,
        client.status,
      )
  }

  async update(
    client: Client,
  ): Promise<void> {
    this.database
      .prepare(`
        UPDATE clients
        SET
          created_at = ?,
          updated_at = ?,
          name = ?,
          phone = ?,
          email = ?,
          company = ?,
          note = ?,
          status = ?
        WHERE id = ?
      `)
      .run(
        client.createdAt.toISOString(),
        client.updatedAt.toISOString(),
        client.name,
        client.phone ?? null,
        client.email ?? null,
        client.company ?? null,
        client.note ?? null,
        client.status,
        client.id,
      )
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    appendAuditEvent(this.database, event)
  }
}

export class SqliteClientRepository
  implements ClientRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async withTransaction<T>(
    operation: (unitOfWork: ClientUnitOfWork) => Promise<T>,
  ): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')

    try {
      const result = await operation(
        new SqliteClientUnitOfWork(this.database),
      )
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async findAll(): Promise<Client[]> {
    return new SqliteClientUnitOfWork(this.database).findAll()
  }

  async findById(
    clientId: string,
  ): Promise<Client | undefined> {
    return new SqliteClientUnitOfWork(this.database).findById(clientId)
  }

  async save(client: Client): Promise<void> {
    await new SqliteClientUnitOfWork(this.database).save(client)
  }

  async update(client: Client): Promise<void> {
    await new SqliteClientUnitOfWork(this.database).update(client)
  }

  close(): void {
    this.database.close()
  }
}
