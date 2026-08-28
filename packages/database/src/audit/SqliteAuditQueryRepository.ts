import type { DatabaseSync } from 'node:sqlite'
import type {
  AuditEvent,
  AuditMetadata,
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

export interface AuditEventCursor {
  occurredAt: Date
  id: string
}

export interface AuditEventQuery {
  limit: number
  cursor?: AuditEventCursor
  fromOccurredAt?: Date
  toOccurredAt?: Date
  actorUserId?: string
  entityType?: string
  entityId?: string
  requestId?: string
}

export interface AuditQueryRepository {
  listEvents(query: AuditEventQuery): Promise<readonly AuditEvent[]>
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

export class SqliteAuditQueryRepository implements AuditQueryRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async listEvents(
    query: AuditEventQuery,
  ): Promise<readonly AuditEvent[]> {
    const predicates: string[] = []
    const parameters: (string | number)[] = []

    if (query.fromOccurredAt) {
      predicates.push('occurred_at >= ?')
      parameters.push(query.fromOccurredAt.toISOString())
    }

    if (query.toOccurredAt) {
      predicates.push('occurred_at <= ?')
      parameters.push(query.toOccurredAt.toISOString())
    }

    if (query.actorUserId) {
      predicates.push('actor_user_id = ?')
      parameters.push(query.actorUserId)
    }

    if (query.entityType && query.entityId) {
      predicates.push('entity_type = ? AND entity_id = ?')
      parameters.push(query.entityType, query.entityId)
    }

    if (query.requestId) {
      predicates.push('request_id = ?')
      parameters.push(query.requestId)
    }

    if (query.cursor) {
      predicates.push(
        '(occurred_at < ? OR (occurred_at = ? AND id < ?))',
      )
      const cursorOccurredAt = query.cursor.occurredAt.toISOString()
      parameters.push(cursorOccurredAt, cursorOccurredAt, query.cursor.id)
    }

    const where = predicates.length > 0
      ? `WHERE ${predicates.join(' AND ')}`
      : ''

    const rows = this.database.prepare(`
      SELECT id, occurred_at, actor_user_id, actor_type, request_id, domain,
        entity_type, entity_id, action, metadata_json
      FROM audit_events
      ${where}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `).all(...parameters, query.limit) as unknown as AuditEventRow[]

    return rows.map(toAuditEvent)
  }

  close(): void {
    this.database.close()
  }
}
