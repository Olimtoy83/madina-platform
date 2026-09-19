import { HttpError } from '../../shared/api/httpClient'
import type { RetailReturnCompletionResult } from '../../shared/api/retailApi'
import type {
  ClearPendingPosReturnResult,
  PendingPosReturnSubmission,
  RetailReturnPayload,
  SavePendingPosReturnResult,
} from './retailPosReturnRecovery'

export function createPosReturnIntent(input: {
  locationId: string
  saleId: string
  items: ReadonlyArray<{ saleItemId: string; quantity: number }>
  createId: () => string
}): RetailReturnPayload {
  const items = input.items.map((item) => ({ saleItemId: item.saleItemId, quantity: item.quantity }))
    .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId))
  if (!input.locationId.trim() || !input.saleId.trim() || items.length === 0
    || items.some((item) => !item.saleItemId.trim() || !Number.isSafeInteger(item.quantity) || item.quantity < 1)
    || new Set(items.map((item) => item.saleItemId)).size !== items.length) throw new Error('Invalid Retail Return intent.')
  return { clientOperationId: input.createId(), saleId: input.saleId, items }
}

export function isDefinitiveReturnRejection(error: unknown): boolean {
  return error instanceof HttpError && [400, 403, 404, 409].includes(error.status)
}

export interface PosReturnDependencies {
  saveSnapshot: (snapshot: PendingPosReturnSubmission) => SavePendingPosReturnResult
  complete: (locationId: string, saleId: string, payload: RetailReturnPayload) => Promise<RetailReturnCompletionResult>
  clearSnapshot: (ownerUserId: string, clientOperationId: string) => ClearPendingPosReturnResult
  isCurrent: () => boolean
}

export type PosReturnSubmissionOutcome =
  | { status: 'succeeded'; completion: RetailReturnCompletionResult }
  | { status: 'rejected' }
  | { status: 'blocked'; reason: 'save-failed' | 'unknown-result' | 'clear-failed' | 'stale' }

async function dispatch(snapshot: Readonly<PendingPosReturnSubmission>, dependencies: Omit<PosReturnDependencies, 'saveSnapshot'>): Promise<PosReturnSubmissionOutcome> {
  if (!dependencies.isCurrent()) return { status: 'blocked', reason: 'stale' }
  try {
    const completion = await dependencies.complete(snapshot.locationId, snapshot.payload.saleId, snapshot.payload)
    if (!dependencies.isCurrent()) return { status: 'blocked', reason: 'stale' }
    const cleared = dependencies.clearSnapshot(snapshot.ownerUserId, snapshot.payload.clientOperationId)
    return cleared.status === 'cleared'
      ? { status: 'succeeded', completion }
      : { status: 'blocked', reason: 'clear-failed' }
  } catch (error) {
    if (!isDefinitiveReturnRejection(error)) return { status: 'blocked', reason: 'unknown-result' }
    if (!dependencies.isCurrent()) return { status: 'blocked', reason: 'stale' }
    const cleared = dependencies.clearSnapshot(snapshot.ownerUserId, snapshot.payload.clientOperationId)
    return cleared.status === 'cleared' ? { status: 'rejected' } : { status: 'blocked', reason: 'clear-failed' }
  }
}

export async function submitPosReturn(input: { ownerUserId: string; locationId: string; payload: RetailReturnPayload }, dependencies: PosReturnDependencies): Promise<PosReturnSubmissionOutcome> {
  const saved = dependencies.saveSnapshot({ schemaVersion: 1, ownerUserId: input.ownerUserId, locationId: input.locationId, payload: input.payload })
  if (saved.status !== 'saved') return { status: 'blocked', reason: 'save-failed' }
  return dispatch(saved.snapshot, dependencies)
}

export async function retryPendingPosReturn(snapshot: Readonly<PendingPosReturnSubmission>, dependencies: Omit<PosReturnDependencies, 'saveSnapshot'>): Promise<PosReturnSubmissionOutcome> {
  return dispatch(snapshot, dependencies)
}
