export type RetailSaleStatus = 'draft'

export interface RetailSaleItem {
  readonly id: string
  readonly saleId: string
  readonly productId: string
  readonly quantity: number
}

export interface RetailSaleDraft {
  readonly id: string
  readonly locationId: string
  readonly status: RetailSaleStatus
  readonly creationOperation: RetailOperationIdentity
  readonly lines: readonly RetailSaleItem[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface RetailSaleDraftPayload {
  readonly saleId: string
  readonly locationId: string
  readonly status: RetailSaleStatus
  readonly lines: readonly RetailSaleItem[]
}

export interface RetailOperationIdentity {
  readonly clientOperationId: string
  readonly operationKind: 'retail_sale_draft_create'
  readonly schemaVersion: 1
  readonly payloadHash: string
  readonly createdAt: Date
}

export type RetailOperationComparison =
  | 'DIFFERENT_OPERATION'
  | 'REPLAY_SAFE'
  | 'IDEMPOTENCY_CONFLICT'

function requiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Retail Sale draft ${field} is required.`)
  return normalized
}

function validTimestamp(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Retail Sale operation ${field} is invalid.`)
  }
  return value
}

function validateLine(line: RetailSaleItem, saleId: string): RetailSaleItem {
  if (!line || typeof line !== 'object') throw new Error('Retail Sale draft line is invalid.')
  if (requiredText(line.id, 'line id') !== line.id) {
    throw new Error('Retail Sale draft line id must not have surrounding whitespace.')
  }
  if (requiredText(line.saleId, 'line saleId') !== saleId) {
    throw new Error('Retail Sale draft line saleId must match the Sale.')
  }
  if (requiredText(line.productId, 'line productId') !== line.productId) {
    throw new Error('Retail Sale draft line productId must not have surrounding whitespace.')
  }
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
    throw new Error('Retail Sale draft line quantity must be a positive safe integer.')
  }
  return { id: line.id, saleId: line.saleId, productId: line.productId, quantity: line.quantity }
}

/**
 * Validates the pure Stage 8A draft shape. An empty line collection is valid:
 * this stage defines a draft, not a completed or stock-affecting Sale.
 */
export function validateRetailSaleDraftPayload(input: RetailSaleDraftPayload): RetailSaleDraftPayload {
  if (!input || typeof input !== 'object') throw new Error('Retail Sale draft input is invalid.')
  const saleId = requiredText(input.saleId, 'id')
  const locationId = requiredText(input.locationId, 'locationId')
  if (input.status !== 'draft') throw new Error('Retail Sale draft status must be draft.')
  if (!Array.isArray(input.lines)) throw new Error('Retail Sale draft lines must be an array.')

  const lineIds = new Set<string>()
  const productIds = new Set<string>()
  const lines = input.lines.map((line) => {
    const validated = validateLine(line, saleId)
    if (lineIds.has(validated.id)) throw new Error('Retail Sale draft duplicate line ids are not allowed.')
    if (productIds.has(validated.productId)) throw new Error('Retail Sale draft duplicate Product lines are not allowed.')
    lineIds.add(validated.id)
    productIds.add(validated.productId)
    return validated
  })

  return { saleId, locationId, status: 'draft', lines }
}

/**
 * Canonical business payload for Stage 8A hashing. It deliberately excludes
 * clientOperationId and timestamps; those identify an attempt, not its draft.
 */
export function canonicalizeRetailSaleDraftPayload(input: RetailSaleDraftPayload): string {
  const draft = validateRetailSaleDraftPayload(input)
  const lines = [...draft.lines]
    .sort((left, right) => left.productId.localeCompare(right.productId) || left.id.localeCompare(right.id))
    .map(({ id, saleId, productId, quantity }) => ({ id, saleId, productId, quantity }))
  return JSON.stringify({
    locationId: draft.locationId,
    saleId: draft.saleId,
    status: draft.status,
    lines,
  })
}

export async function hashRetailSaleDraftPayload(input: RetailSaleDraftPayload): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalizeRetailSaleDraftPayload(input)),
  ))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateRetailOperationIdentity(input: RetailOperationIdentity): RetailOperationIdentity {
  if (!input || typeof input !== 'object') throw new Error('Retail Sale operation identity is invalid.')
  const clientOperationId = requiredText(input.clientOperationId, 'clientOperationId')
  if (input.operationKind !== 'retail_sale_draft_create') {
    throw new Error('Retail Sale operation kind is invalid.')
  }
  if (input.schemaVersion !== 1) throw new Error('Retail Sale operation schemaVersion is invalid.')
  const payloadHash = requiredText(input.payloadHash, 'payloadHash')
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) throw new Error('Retail Sale operation payloadHash is invalid.')
  return {
    clientOperationId,
    operationKind: input.operationKind,
    schemaVersion: input.schemaVersion,
    payloadHash,
    createdAt: validTimestamp(input.createdAt, 'createdAt'),
  }
}

export function compareRetailOperationIdentity(
  prior: RetailOperationIdentity,
  incoming: RetailOperationIdentity,
): RetailOperationComparison {
  const existing = validateRetailOperationIdentity(prior)
  const candidate = validateRetailOperationIdentity(incoming)
  if (existing.clientOperationId !== candidate.clientOperationId) return 'DIFFERENT_OPERATION'
  return existing.operationKind === candidate.operationKind &&
    existing.schemaVersion === candidate.schemaVersion &&
    existing.payloadHash === candidate.payloadHash
    ? 'REPLAY_SAFE'
    : 'IDEMPOTENCY_CONFLICT'
}
