export type CommandActorType =
  | 'user'
  | 'system'
  | 'migration'

export type CommandContext =
  | {
      readonly actorType: 'user'
      readonly actorUserId: string
      readonly requestId: string
    }
  | {
      readonly actorType: 'system' | 'migration'
      readonly actorUserId?: string
      readonly requestId: string
    }

export type AuditDomain =
  | 'clients'
  | 'tasks'
  | 'commerce'
  | 'korea-auto'
  | 'retail'
  | 'users'

export type AuditAction =
  | 'client.created'
  | 'client.updated'
  | 'client.status_changed'
  | 'clients.imported'
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'tasks.imported'
  | 'product.created'
  | 'product.updated'
  | 'product.deactivated'
  | 'stock.adjusted'
  | 'purchase.created'
  | 'purchase.updated'
  | 'purchase.cancelled'
  | 'purchase.completed'
  | 'sale.created'
  | 'sale.updated'
  | 'sale.cancelled'
  | 'sale.completed'
  | 'commerce.snapshot_imported'
  | 'products.bulk_imported'
  | 'vehicle.created'
  | 'vehicle.updated'
  | 'vehicle.status_changed'
  | 'user.created'
  | 'user.role_changed'
  | 'user.status_changed'
  | 'user.password_reset'
  | 'user.sessions_revoked'
  | 'user.bootstrap_admin_created'
  | 'retail.location_created'
  | 'retail.location_updated'
  | 'retail.location_granted'
  | 'retail.location_revoked'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type AuditMetadata = {
  readonly [key: string]: JsonValue
}

export interface AuditEvent {
  readonly id: string
  readonly occurredAt: Date
  readonly actorType: CommandActorType
  readonly actorUserId?: string
  readonly requestId: string
  readonly domain: AuditDomain
  readonly entityType: string
  readonly entityId: string
  readonly action: AuditAction
  readonly metadata?: AuditMetadata
}

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>
}

export function createAuditEvent(
  context: CommandContext,
  input: Omit<AuditEvent, 'id' | 'occurredAt' | 'actorType' | 'actorUserId' | 'requestId'>,
): AuditEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    occurredAt: new Date(),
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  }
}
