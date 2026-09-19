export const POS_PENDING_RETURN_STORAGE_KEY =
  'madina-crm:v1:retail-return-submission-recovery'

const SCHEMA_VERSION = 1 as const

export interface RetailReturnPayload {
  clientOperationId: string
  saleId: string
  items: ReadonlyArray<{ saleItemId: string; quantity: number }>
}

export interface PendingPosReturnSubmission {
  schemaVersion: typeof SCHEMA_VERSION
  ownerUserId: string
  locationId: string
  payload: RetailReturnPayload
}

export interface PosReturnRecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LoadPendingPosReturnResult =
  | { status: 'none' | 'foreign-owner' | 'invalid' | 'storage-error' }
  | { status: 'pending'; snapshot: Readonly<PendingPosReturnSubmission> }

export type SavePendingPosReturnResult =
  | { status: 'saved'; snapshot: Readonly<PendingPosReturnSubmission> }
  | { status: 'already-pending' | 'invalid' | 'storage-error' }

export type ClearPendingPosReturnResult =
  | { status: 'cleared' | 'none' | 'foreign-owner' | 'different-attempt' | 'invalid' | 'storage-error' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => key in value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isPending(value: unknown): value is PendingPosReturnSubmission {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'ownerUserId', 'locationId', 'payload'])
    || value.schemaVersion !== SCHEMA_VERSION
    || !isNonEmptyString(value.ownerUserId)
    || !isNonEmptyString(value.locationId)
    || !isRecord(value.payload)
    || !hasOnlyKeys(value.payload, ['clientOperationId', 'saleId', 'items'])
    || !isNonEmptyString(value.payload.clientOperationId)
    || !isNonEmptyString(value.payload.saleId)
    || !Array.isArray(value.payload.items)
    || value.payload.items.length === 0) return false

  const itemIds = new Set<string>()
  for (const item of value.payload.items) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['saleItemId', 'quantity'])
      || !isNonEmptyString(item.saleItemId)
      || !isPositiveSafeInteger(item.quantity)
      || itemIds.has(item.saleItemId)) return false
    itemIds.add(item.saleItemId)
  }
  return true
}

function freezeSnapshot(snapshot: PendingPosReturnSubmission): Readonly<PendingPosReturnSubmission> {
  const items = Object.freeze(snapshot.payload.items.map((item) => Object.freeze({
    saleItemId: item.saleItemId,
    quantity: item.quantity,
  })))
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    ownerUserId: snapshot.ownerUserId,
    locationId: snapshot.locationId,
    payload: Object.freeze({
      clientOperationId: snapshot.payload.clientOperationId,
      saleId: snapshot.payload.saleId,
      items,
    }),
  })
}

function read(storage: PosReturnRecoveryStorage):
{ status: 'none' | 'invalid' | 'storage-error' } | { status: 'valid'; snapshot: Readonly<PendingPosReturnSubmission> } {
  let raw: string | null
  try { raw = storage.getItem(POS_PENDING_RETURN_STORAGE_KEY) } catch { return { status: 'storage-error' } }
  if (raw === null) return { status: 'none' }
  try {
    const value = JSON.parse(raw) as unknown
    return isPending(value) ? { status: 'valid', snapshot: freezeSnapshot(value) } : { status: 'invalid' }
  } catch { return { status: 'invalid' } }
}

export function loadPendingPosReturnSubmission(currentUserId: string, storage: PosReturnRecoveryStorage = localStorage): LoadPendingPosReturnResult {
  const result = read(storage)
  if (result.status !== 'valid') return result
  return result.snapshot.ownerUserId === currentUserId
    ? { status: 'pending', snapshot: result.snapshot }
    : { status: 'foreign-owner' }
}

export function savePendingPosReturnSubmission(input: unknown, storage: PosReturnRecoveryStorage = localStorage): SavePendingPosReturnResult {
  if (!isPending(input)) return { status: 'invalid' }
  const existing = read(storage)
  if (existing.status === 'valid') return { status: 'already-pending' }
  if (existing.status !== 'none') return existing.status === 'storage-error'
    ? { status: 'storage-error' }
    : { status: 'invalid' }
  const snapshot = freezeSnapshot(input)
  try { storage.setItem(POS_PENDING_RETURN_STORAGE_KEY, JSON.stringify(snapshot)) } catch { return { status: 'storage-error' } }
  return { status: 'saved', snapshot }
}

export function clearPendingPosReturnSubmission(ownerUserId: string, clientOperationId: string, storage: PosReturnRecoveryStorage = localStorage): ClearPendingPosReturnResult {
  const existing = read(storage)
  if (existing.status !== 'valid') return existing
  if (existing.snapshot.ownerUserId !== ownerUserId) return { status: 'foreign-owner' }
  if (existing.snapshot.payload.clientOperationId !== clientOperationId) return { status: 'different-attempt' }
  try { storage.removeItem(POS_PENDING_RETURN_STORAGE_KEY) } catch { return { status: 'storage-error' } }
  return { status: 'cleared' }
}
