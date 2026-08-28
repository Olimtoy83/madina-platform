export interface AuditEventListItemResponse {
  id: string
  occurredAt: string
  actorType: string
  actorUserId?: string
  requestId: string
  domain: string
  action: string
  entityType: string
  entityId: string
}

export interface AuditEventsListResponse {
  events: AuditEventListItemResponse[]
  nextCursor?: string
}

export interface AuditEventsListQuery {
  limit?: string
  cursor?: string
  fromOccurredAt?: string
  toOccurredAt?: string
  actorUserId?: string
  entityType?: string
  entityId?: string
  requestId?: string
}
