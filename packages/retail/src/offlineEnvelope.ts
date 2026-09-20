export const RETAIL_OFFLINE_SIGNATURE_ALGORITHM = 'ed25519-spki-der-base64-v1' as const
export const RETAIL_OFFLINE_SIGNATURE_PREFIX = 'ed25519-raw-base64-v1:' as const
export const RETAIL_OFFLINE_ENVELOPE_SCHEMA_VERSION = 1 as const

export interface RetailOfflineEnvelopeLine {
  readonly id: string
  readonly productId: string
  readonly quantity: number
  readonly unitPriceMinor: number
}

export interface RetailOfflineCashAllocation {
  readonly id: string
  readonly method: 'cash'
  readonly amountMinor: number
  readonly ordinal: 0
}

export interface RetailOfflineEnvelope {
  readonly schemaVersion: 1
  readonly offlineOperationId: string
  readonly authorityId: string
  readonly authorityVersion: number
  readonly permitId: string
  readonly permitSequence: number
  readonly terminalId: string
  readonly terminalKeyVersion: number
  readonly userId: string
  readonly locationId: string
  readonly proposedSaleId: string
  readonly lines: readonly RetailOfflineEnvelopeLine[]
  readonly currencyCode: string
  readonly currencyExponent: number
  readonly cashAllocation: RetailOfflineCashAllocation
  readonly subtotalMinor: number
  readonly payableTotalMinor: number
  readonly claimedOfflineCompletedAt: string
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`Retail Offline envelope ${field} is invalid.`)
  return value
}

function integer(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`Retail Offline envelope ${field} is invalid.`)
  return value as number
}

function timestamp(value: unknown): string {
  const result = text(value, 'claimedOfflineCompletedAt')
  const parsed = new Date(result)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) throw new Error('Retail Offline envelope claimedOfflineCompletedAt is invalid.')
  return result
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`Retail Offline envelope ${field} has unsupported fields.`)
}

function line(value: unknown): RetailOfflineEnvelopeLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Retail Offline envelope line is invalid.')
  const candidate = value as Record<string, unknown>
  exactKeys(candidate, ['id', 'productId', 'quantity', 'unitPriceMinor'], 'line')
  return { id: text(candidate.id, 'line id'), productId: text(candidate.productId, 'line productId'), quantity: integer(candidate.quantity, 'line quantity', 1), unitPriceMinor: integer(candidate.unitPriceMinor, 'line unitPriceMinor', 1) }
}

function allocation(value: unknown): RetailOfflineCashAllocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Retail Offline envelope cashAllocation is invalid.')
  const candidate = value as Record<string, unknown>
  exactKeys(candidate, ['id', 'method', 'amountMinor', 'ordinal'], 'cashAllocation')
  if (candidate.method !== 'cash' || candidate.ordinal !== 0) throw new Error('Retail Offline envelope requires one cash allocation.')
  return { id: text(candidate.id, 'cashAllocation id'), method: 'cash', amountMinor: integer(candidate.amountMinor, 'cashAllocation amountMinor', 1), ordinal: 0 }
}

export function validateRetailOfflineEnvelope(input: unknown): RetailOfflineEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Retail Offline envelope is invalid.')
  const candidate = input as Record<string, unknown>
  exactKeys(candidate, ['schemaVersion', 'offlineOperationId', 'authorityId', 'authorityVersion', 'permitId', 'permitSequence', 'terminalId', 'terminalKeyVersion', 'userId', 'locationId', 'proposedSaleId', 'lines', 'currencyCode', 'currencyExponent', 'cashAllocation', 'subtotalMinor', 'payableTotalMinor', 'claimedOfflineCompletedAt'], 'root')
  if (candidate.schemaVersion !== RETAIL_OFFLINE_ENVELOPE_SCHEMA_VERSION) throw new Error('Retail Offline envelope schemaVersion is invalid.')
  if (!Array.isArray(candidate.lines) || !candidate.lines.length) throw new Error('Retail Offline envelope lines are invalid.')
  const lines = candidate.lines.map(line)
  const lineIds = new Set<string>(), productIds = new Set<string>()
  let subtotal = 0
  for (const item of lines) {
    if (lineIds.has(item.id) || productIds.has(item.productId)) throw new Error('Retail Offline envelope duplicate line or Product.')
    lineIds.add(item.id); productIds.add(item.productId)
    const total = item.quantity * item.unitPriceMinor
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(subtotal + total)) throw new Error('Retail Offline envelope money overflow.')
    subtotal += total
  }
  const currencyCode = text(candidate.currencyCode, 'currencyCode')
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error('Retail Offline envelope currencyCode is invalid.')
  const cashAllocation = allocation(candidate.cashAllocation)
  const payableTotalMinor = integer(candidate.payableTotalMinor, 'payableTotalMinor', 1)
  if (integer(candidate.subtotalMinor, 'subtotalMinor', 1) !== subtotal || payableTotalMinor !== subtotal || cashAllocation.amountMinor !== subtotal) throw new Error('Retail Offline envelope totals are invalid.')
  return {
    schemaVersion: 1,
    offlineOperationId: text(candidate.offlineOperationId, 'offlineOperationId'),
    authorityId: text(candidate.authorityId, 'authorityId'),
    authorityVersion: integer(candidate.authorityVersion, 'authorityVersion', 1),
    permitId: text(candidate.permitId, 'permitId'),
    permitSequence: integer(candidate.permitSequence, 'permitSequence', 0),
    terminalId: text(candidate.terminalId, 'terminalId'),
    terminalKeyVersion: integer(candidate.terminalKeyVersion, 'terminalKeyVersion', 1),
    userId: text(candidate.userId, 'userId'),
    locationId: text(candidate.locationId, 'locationId'),
    proposedSaleId: text(candidate.proposedSaleId, 'proposedSaleId'),
    lines,
    currencyCode,
    currencyExponent: integer(candidate.currencyExponent, 'currencyExponent', 0),
    cashAllocation,
    subtotalMinor: subtotal,
    payableTotalMinor,
    claimedOfflineCompletedAt: timestamp(candidate.claimedOfflineCompletedAt),
  }
}

export function canonicalizeRetailOfflineEnvelope(input: unknown): string {
  const envelope = validateRetailOfflineEnvelope(input)
  return JSON.stringify({
    schemaVersion: envelope.schemaVersion,
    offlineOperationId: envelope.offlineOperationId,
    authorityId: envelope.authorityId,
    authorityVersion: envelope.authorityVersion,
    permitId: envelope.permitId,
    permitSequence: envelope.permitSequence,
    terminalId: envelope.terminalId,
    terminalKeyVersion: envelope.terminalKeyVersion,
    userId: envelope.userId,
    locationId: envelope.locationId,
    proposedSaleId: envelope.proposedSaleId,
    lines: [...envelope.lines].sort((left, right) => left.id.localeCompare(right.id)).map((item) => ({ id: item.id, productId: item.productId, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor })),
    currencyCode: envelope.currencyCode,
    currencyExponent: envelope.currencyExponent,
    cashAllocation: { id: envelope.cashAllocation.id, method: 'cash', amountMinor: envelope.cashAllocation.amountMinor, ordinal: 0 },
    subtotalMinor: envelope.subtotalMinor,
    payableTotalMinor: envelope.payableTotalMinor,
    claimedOfflineCompletedAt: envelope.claimedOfflineCompletedAt,
  })
}

export async function hashRetailOfflineEnvelope(input: unknown): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalizeRetailOfflineEnvelope(input))))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
