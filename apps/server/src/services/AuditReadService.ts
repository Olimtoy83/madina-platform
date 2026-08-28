import type {
  AuditEventListItemResponse,
  AuditEventsListQuery,
  AuditEventsListResponse,
} from '@madina/api'
import type {
  AuditEventQuery,
  AuditQueryRepository,
} from '@madina/database'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

type NormalizedFilters = {
  fromOccurredAt?: string
  toOccurredAt?: string
  actorUserId?: string
  entityType?: string
  entityId?: string
  requestId?: string
}

interface AuditCursor {
  version: 1
  occurredAt: string
  id: string
  filters: NormalizedFilters
}

interface AuditReadEvent {
  id: string
  occurredAt: Date
  actorType: string
  actorUserId?: string
  requestId: string
  domain: string
  action: string
  entityType: string
  entityId: string
}

export class AuditReadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditReadValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new AuditReadValidationError('Audit query contains an unsupported parameter.')
    }
  }
}

function optionalNonEmptyString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || !value.trim()) {
    throw new AuditReadValidationError(`Audit query ${field} is invalid.`)
  }

  return value.trim()
}

function normalizeOccurredAt(
  value: unknown,
  field: string,
): string | undefined {
  const input = optionalNonEmptyString(value, field)
  if (input === undefined) return undefined

  if (!UTC_ISO_TIMESTAMP.test(input)) {
    throw new AuditReadValidationError(`Audit query ${field} must be a UTC ISO timestamp.`)
  }

  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    throw new AuditReadValidationError(`Audit query ${field} is invalid.`)
  }

  return date.toISOString()
}

function normalizeFilters(value: Record<string, unknown>): NormalizedFilters {
  assertAllowedKeys(value, [
    'fromOccurredAt',
    'toOccurredAt',
    'actorUserId',
    'entityType',
    'entityId',
    'requestId',
  ])

  const filters: NormalizedFilters = {
    fromOccurredAt: normalizeOccurredAt(value.fromOccurredAt, 'fromOccurredAt'),
    toOccurredAt: normalizeOccurredAt(value.toOccurredAt, 'toOccurredAt'),
    actorUserId: optionalNonEmptyString(value.actorUserId, 'actorUserId'),
    entityType: optionalNonEmptyString(value.entityType, 'entityType'),
    entityId: optionalNonEmptyString(value.entityId, 'entityId'),
    requestId: optionalNonEmptyString(value.requestId, 'requestId'),
  }

  if ((filters.entityType === undefined) !== (filters.entityId === undefined)) {
    throw new AuditReadValidationError('Audit query entityType and entityId must be provided together.')
  }

  if (
    filters.fromOccurredAt !== undefined &&
    filters.toOccurredAt !== undefined &&
    filters.fromOccurredAt > filters.toOccurredAt
  ) {
    throw new AuditReadValidationError('Audit query fromOccurredAt must not be after toOccurredAt.')
  }

  return Object.fromEntries(
    Object.entries(filters).filter(([, entry]) => entry !== undefined),
  ) as NormalizedFilters
}

function pickFilterValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    fromOccurredAt: value.fromOccurredAt,
    toOccurredAt: value.toOccurredAt,
    actorUserId: value.actorUserId,
    entityType: value.entityType,
    entityId: value.entityId,
    requestId: value.requestId,
  }
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AuditReadValidationError('Audit query limit is invalid.')
  }

  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_LIMIT) {
    throw new AuditReadValidationError(`Audit query limit must be between 1 and ${MAX_LIMIT}.`)
  }

  return limit
}

function decodeCursor(value: unknown): AuditCursor | undefined {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuditReadValidationError('Audit query cursor is invalid.')
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(decoded)) {
      throw new AuditReadValidationError('Audit query cursor is invalid.')
    }

    assertAllowedKeys(decoded, ['version', 'occurredAt', 'id', 'filters'])

    if (decoded.version !== 1 ||
      typeof decoded.occurredAt !== 'string' ||
      typeof decoded.id !== 'string' || !decoded.id.trim() ||
      !isRecord(decoded.filters)) {
      throw new AuditReadValidationError('Audit query cursor is invalid.')
    }

    const occurredAt = normalizeOccurredAt(decoded.occurredAt, 'cursor occurredAt')
    if (occurredAt === undefined) {
      throw new AuditReadValidationError('Audit query cursor is invalid.')
    }

    return {
      version: 1,
      occurredAt,
      id: decoded.id,
      filters: normalizeFilters(decoded.filters),
    }
  } catch (error) {
    if (error instanceof AuditReadValidationError) throw error
    throw new AuditReadValidationError('Audit query cursor is invalid.')
  }
}

function filtersMatch(
  left: NormalizedFilters,
  right: NormalizedFilters,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function toPublicEvent(event: AuditReadEvent): AuditEventListItemResponse {
  return {
    id: event.id,
    occurredAt: event.occurredAt.toISOString(),
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    requestId: event.requestId,
    domain: event.domain,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
  }
}

function encodeCursor(
  event: AuditReadEvent,
  filters: NormalizedFilters,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    occurredAt: event.occurredAt.toISOString(),
    id: event.id,
    filters,
  } satisfies AuditCursor)).toString('base64url')
}

export class AuditReadService {
  constructor(private readonly repository: AuditQueryRepository) {}

  async listEvents(
    input: AuditEventsListQuery | unknown,
  ): Promise<AuditEventsListResponse> {
    if (!isRecord(input)) {
      throw new AuditReadValidationError('Audit query is invalid.')
    }

    assertAllowedKeys(input, [
      'limit',
      'cursor',
      'fromOccurredAt',
      'toOccurredAt',
      'actorUserId',
      'entityType',
      'entityId',
      'requestId',
    ])

    const limit = parseLimit(input.limit)
    const filters = normalizeFilters(pickFilterValues(input))
    const cursor = decodeCursor(input.cursor)

    if (cursor && !filtersMatch(cursor.filters, filters)) {
      throw new AuditReadValidationError('Audit query cursor does not match the current filters.')
    }

    const query: AuditEventQuery = {
      limit: limit + 1,
      cursor: cursor
        ? { occurredAt: new Date(cursor.occurredAt), id: cursor.id }
        : undefined,
      fromOccurredAt: filters.fromOccurredAt
        ? new Date(filters.fromOccurredAt)
        : undefined,
      toOccurredAt: filters.toOccurredAt
        ? new Date(filters.toOccurredAt)
        : undefined,
      actorUserId: filters.actorUserId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      requestId: filters.requestId,
    }
    const events = await this.repository.listEvents(query)
    const page = events.slice(0, limit)
    const last = page.at(-1)

    return {
      events: page.map(toPublicEvent),
      nextCursor: events.length > limit && last
        ? encodeCursor(last, filters)
        : undefined,
    }
  }
}
