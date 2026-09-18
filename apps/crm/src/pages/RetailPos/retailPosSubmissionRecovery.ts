export const POS_PENDING_SALE_STORAGE_KEY =
  'madina-crm:v1:retail-pos-submission-recovery'

const SCHEMA_VERSION = 1 as const

export type PosSubmissionPaymentMethod =
  | 'cash'
  | 'card'
  | 'transfer'
  | 'other'

export interface PosCompletionPayload {
  clientOperationId: string
  saleId: string
  lines: ReadonlyArray<{
    id: string
    productId: string
    quantity: number
    discountAmountMinor?: number
  }>
  allocations: ReadonlyArray<{
    id: string
    method: PosSubmissionPaymentMethod
    amountMinor: number
    ordinal: number
  }>
}

export interface PendingPosSaleSubmission {
  schemaVersion: typeof SCHEMA_VERSION
  ownerUserId: string
  locationId: string
  payload: PosCompletionPayload
}

export interface PosSubmissionRecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LoadPendingPosSaleSubmissionResult =
  | { status: 'none' }
  | { status: 'pending'; snapshot: Readonly<PendingPosSaleSubmission> }
  | { status: 'foreign-owner' }
  | { status: 'invalid' }
  | { status: 'storage-error' }

export type SavePendingPosSaleSubmissionResult =
  | { status: 'saved'; snapshot: Readonly<PendingPosSaleSubmission> }
  | { status: 'already-pending' }
  | { status: 'invalid' }
  | { status: 'storage-error' }

export type ClearPendingPosSaleSubmissionResult =
  | { status: 'cleared' | 'none' | 'foreign-owner' | 'different-attempt' | 'invalid' }
  | { status: 'storage-error' }

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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPaymentMethod(value: unknown): value is PosSubmissionPaymentMethod {
  return value === 'cash'
    || value === 'card'
    || value === 'transfer'
    || value === 'other'
}

function isPendingPosSaleSubmission(value: unknown): value is PendingPosSaleSubmission {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'ownerUserId', 'locationId', 'payload'])
    || value.schemaVersion !== SCHEMA_VERSION
    || !isNonEmptyString(value.ownerUserId)
    || !isNonEmptyString(value.locationId)
    || !isRecord(value.payload)
    || !hasOnlyKeys(value.payload, ['clientOperationId', 'saleId', 'lines', 'allocations'])
    || !isNonEmptyString(value.payload.clientOperationId)
    || !isNonEmptyString(value.payload.saleId)
    || !Array.isArray(value.payload.lines)
    || value.payload.lines.length === 0
    || !Array.isArray(value.payload.allocations)
    || value.payload.allocations.length === 0) {
    return false
  }

  const lineIds = new Set<string>()
  const productIds = new Set<string>()
  for (const line of value.payload.lines) {
    if (!isRecord(line)
      || !Object.keys(line).every((key) => ['id', 'productId', 'quantity', 'discountAmountMinor'].includes(key))
      || !['id', 'productId', 'quantity'].every((key) => key in line)
      || !isNonEmptyString(line.id)
      || !isNonEmptyString(line.productId)
      || !isPositiveSafeInteger(line.quantity)
      || (line.discountAmountMinor !== undefined
        && !isPositiveSafeInteger(line.discountAmountMinor))
      || lineIds.has(line.id)
      || productIds.has(line.productId)) {
      return false
    }
    lineIds.add(line.id)
    productIds.add(line.productId)
  }

  const allocationIds = new Set<string>()
  const ordinals = new Set<number>()
  for (const [index, allocation] of value.payload.allocations.entries()) {
    if (!isRecord(allocation)
      || !hasOnlyKeys(allocation, ['id', 'method', 'amountMinor', 'ordinal'])
      || !isNonEmptyString(allocation.id)
      || !isPaymentMethod(allocation.method)
      || !isPositiveSafeInteger(allocation.amountMinor)
      || !isNonNegativeSafeInteger(allocation.ordinal)
      || allocation.ordinal !== index
      || allocationIds.has(allocation.id)
      || ordinals.has(allocation.ordinal)) {
      return false
    }
    allocationIds.add(allocation.id)
    ordinals.add(allocation.ordinal)
  }

  return true
}

function freezeSnapshot(
  snapshot: PendingPosSaleSubmission,
): Readonly<PendingPosSaleSubmission> {
  const lines = Object.freeze(snapshot.payload.lines.map((line) => Object.freeze({
    id: line.id,
    productId: line.productId,
    quantity: line.quantity,
    ...(line.discountAmountMinor === undefined
      ? {}
      : { discountAmountMinor: line.discountAmountMinor }),
  })))
  const allocations = Object.freeze(snapshot.payload.allocations.map((allocation) => Object.freeze({
    id: allocation.id,
    method: allocation.method,
    amountMinor: allocation.amountMinor,
    ordinal: allocation.ordinal,
  })))

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    ownerUserId: snapshot.ownerUserId,
    locationId: snapshot.locationId,
    payload: Object.freeze({
      clientOperationId: snapshot.payload.clientOperationId,
      saleId: snapshot.payload.saleId,
      lines,
      allocations,
    }),
  })
}

function parseSnapshot(rawValue: string): Readonly<PendingPosSaleSubmission> | undefined {
  try {
    const value = JSON.parse(rawValue) as unknown
    return isPendingPosSaleSubmission(value) ? freezeSnapshot(value) : undefined
  } catch {
    return undefined
  }
}

function readStoredSnapshot(
  storage: PosSubmissionRecoveryStorage,
): { status: 'none' | 'invalid' | 'storage-error' } | {
  status: 'valid'
  snapshot: Readonly<PendingPosSaleSubmission>
} {
  let rawValue: string | null
  try {
    rawValue = storage.getItem(POS_PENDING_SALE_STORAGE_KEY)
  } catch {
    return { status: 'storage-error' }
  }

  if (rawValue === null) return { status: 'none' }

  const snapshot = parseSnapshot(rawValue)
  return snapshot
    ? { status: 'valid', snapshot }
    : { status: 'invalid' }
}

export function loadPendingPosSaleSubmission(
  currentUserId: string,
  storage: PosSubmissionRecoveryStorage = localStorage,
): LoadPendingPosSaleSubmissionResult {
  const result = readStoredSnapshot(storage)
  if (result.status !== 'valid') return result
  if (result.snapshot.ownerUserId !== currentUserId) {
    return { status: 'foreign-owner' }
  }
  return { status: 'pending', snapshot: result.snapshot }
}

export function savePendingPosSaleSubmission(
  input: unknown,
  storage: PosSubmissionRecoveryStorage = localStorage,
): SavePendingPosSaleSubmissionResult {
  if (!isPendingPosSaleSubmission(input)) return { status: 'invalid' }

  const existing = readStoredSnapshot(storage)
  if (existing.status !== 'none') {
    if (existing.status === 'valid') return { status: 'already-pending' }
    if (existing.status === 'invalid') return { status: 'invalid' }
    return { status: 'storage-error' }
  }

  const snapshot = freezeSnapshot(input)
  try {
    storage.setItem(POS_PENDING_SALE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    return { status: 'storage-error' }
  }

  return { status: 'saved', snapshot }
}

export function clearPendingPosSaleSubmission(
  ownerUserId: string,
  clientOperationId: string,
  storage: PosSubmissionRecoveryStorage = localStorage,
): ClearPendingPosSaleSubmissionResult {
  const existing = readStoredSnapshot(storage)
  if (existing.status !== 'valid') return existing
  if (existing.snapshot.ownerUserId !== ownerUserId) {
    return { status: 'foreign-owner' }
  }
  if (existing.snapshot.payload.clientOperationId !== clientOperationId) {
    return { status: 'different-attempt' }
  }

  try {
    storage.removeItem(POS_PENDING_SALE_STORAGE_KEY)
  } catch {
    return { status: 'storage-error' }
  }
  return { status: 'cleared' }
}
