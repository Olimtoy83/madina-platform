import type { DatabaseSync } from 'node:sqlite'
import type {
  AuditEvent,
  AuditMetadata,
  AuditRepository,
  CommandActorType,
} from '@madina/shared'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface AuditEventRow {
  id: string
  occurred_at: string
  actor_user_id: string | null
  actor_type: CommandActorType
  request_id: string
  domain: AuditEvent['domain']
  entity_type: string
  entity_id: string
  action: AuditEvent['action']
  metadata_json: string | null
}

export interface AuditEventReader {
  findById(id: string): Promise<AuditEvent | undefined>
  findAll(): Promise<AuditEvent[]>
}

function assertNonEmpty(value: string | undefined, field: string): void {
  if (!value?.trim()) {
    throw new Error(`Audit event ${field} is required.`)
  }
}

function serializeMetadata(metadata: AuditMetadata | undefined): string | null {
  if (metadata === undefined) return null

  const serialized = JSON.stringify(metadata)
  if (!serialized || !serialized.startsWith('{')) {
    throw new Error('Audit event metadata must be a JSON object.')
  }

  return serialized
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    occurredAt: new Date(row.occurred_at),
    actorType: row.actor_type,
    actorUserId: row.actor_user_id ?? undefined,
    requestId: row.request_id,
    domain: row.domain,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    metadata: row.metadata_json
      ? JSON.parse(row.metadata_json) as AuditMetadata
      : undefined,
  }
}

export function appendAuditEvent(
  database: DatabaseSync,
  event: AuditEvent,
): void {
  assertNonEmpty(event.id, 'id')
  assertNonEmpty(event.requestId, 'requestId')
  assertNonEmpty(event.entityType, 'entityType')
  assertNonEmpty(event.entityId, 'entityId')

  if (Number.isNaN(event.occurredAt.getTime())) {
    throw new Error('Audit event occurredAt is invalid.')
  }

  if (event.actorType === 'user' && !event.actorUserId?.trim()) {
    throw new Error('User audit events require actorUserId.')
  }

  database.prepare(`
    INSERT INTO audit_events (
      id, occurred_at, actor_user_id, actor_type, request_id, domain,
      entity_type, entity_id, action, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.occurredAt.toISOString(),
    event.actorUserId ?? null,
    event.actorType,
    event.requestId,
    event.domain,
    event.entityType,
    event.entityId,
    event.action,
    serializeMetadata(event.metadata),
  )
}

export class SqliteAuditRepository
  implements AuditRepository, AuditEventReader {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async append(event: AuditEvent): Promise<void> {
    appendAuditEvent(this.database, event)
  }

  async findById(id: string): Promise<AuditEvent | undefined> {
    const row = this.database.prepare(`
      SELECT id, occurred_at, actor_user_id, actor_type, request_id, domain,
        entity_type, entity_id, action, metadata_json
      FROM audit_events WHERE id = ?
    `).get(id) as AuditEventRow | undefined

    return row ? toAuditEvent(row) : undefined
  }

  async findAll(): Promise<AuditEvent[]> {
    const rows = this.database.prepare(`
      SELECT id, occurred_at, actor_user_id, actor_type, request_id, domain,
        entity_type, entity_id, action, metadata_json
      FROM audit_events ORDER BY occurred_at DESC, id DESC
    `).all() as unknown as AuditEventRow[]

    return rows.map(toAuditEvent)
  }

  close(): void {
    this.database.close()
  }
}
