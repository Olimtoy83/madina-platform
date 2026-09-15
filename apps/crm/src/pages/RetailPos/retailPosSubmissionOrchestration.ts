import type {
  RetailSaleCompletionRequest,
  RetailSaleCompletionResult,
} from '../../shared/api/retailApi'
import type { CreatePosCompletionPayloadInput } from './retailPosCompletionPayload'
import type {
  ClearPendingPosSaleSubmissionResult,
  PendingPosSaleSubmission,
  PosCompletionPayload,
  SavePendingPosSaleSubmissionResult,
} from './retailPosSubmissionRecovery'

export interface PosSaleSubmissionInput extends CreatePosCompletionPayloadInput {
  ownerUserId: string
}

export interface PosSaleSubmissionDependencies {
  createPayload: (input: CreatePosCompletionPayloadInput) => PosCompletionPayload
  saveSnapshot: (
    snapshot: PendingPosSaleSubmission,
  ) => SavePendingPosSaleSubmissionResult
  complete: (
    locationId: string,
    payload: RetailSaleCompletionRequest,
  ) => Promise<RetailSaleCompletionResult>
  clearSnapshot: (
    ownerUserId: string,
    clientOperationId: string,
  ) => ClearPendingPosSaleSubmissionResult
  isCurrent: () => boolean
}

export type PosSaleSubmissionOutcome =
  | { status: 'assembly-error' }
  | { status: 'blocked'; reason: 'save-already-pending' | 'save-invalid' | 'save-storage-error' | 'request-failed' | 'clear-failed' | 'stale' }
  | { status: 'succeeded'; completionStatus: 200 | 201 }

function toSaveFailureOutcome(
  result: Exclude<SavePendingPosSaleSubmissionResult, { status: 'saved' }>,
): PosSaleSubmissionOutcome {
  switch (result.status) {
    case 'already-pending':
      return { status: 'blocked', reason: 'save-already-pending' }
    case 'invalid':
      return { status: 'blocked', reason: 'save-invalid' }
    case 'storage-error':
      return { status: 'blocked', reason: 'save-storage-error' }
  }
}

/**
 * Saves the immutable recovery snapshot before dispatching it.  All post-save
 * effects use that returned snapshot, never the mutable POS form state.
 */
export async function submitPosSale(
  input: PosSaleSubmissionInput,
  dependencies: PosSaleSubmissionDependencies,
): Promise<PosSaleSubmissionOutcome> {
  let payload: PosCompletionPayload
  try {
    payload = dependencies.createPayload({
      checkoutAttempt: input.checkoutAttempt,
      paymentAllocations: input.paymentAllocations,
      paymentSummary: input.paymentSummary,
      currencyExponent: input.currencyExponent,
    })
  } catch {
    return { status: 'assembly-error' }
  }

  let saved: SavePendingPosSaleSubmissionResult
  try {
    saved = dependencies.saveSnapshot({
      schemaVersion: 1,
      ownerUserId: input.ownerUserId,
      locationId: input.checkoutAttempt.locationId,
      payload,
    })
  } catch {
    return { status: 'blocked', reason: 'save-storage-error' }
  }

  if (saved.status !== 'saved') return toSaveFailureOutcome(saved)

  const snapshot = saved.snapshot
  if (!dependencies.isCurrent()) return { status: 'blocked', reason: 'stale' }

  let completion: RetailSaleCompletionResult
  try {
    completion = await dependencies.complete(snapshot.locationId, snapshot.payload)
  } catch {
    return { status: 'blocked', reason: 'request-failed' }
  }

  if (completion.status !== 200 && completion.status !== 201) {
    return { status: 'blocked', reason: 'request-failed' }
  }
  if (!dependencies.isCurrent()) return { status: 'blocked', reason: 'stale' }

  try {
    const cleared = dependencies.clearSnapshot(
      snapshot.ownerUserId,
      snapshot.payload.clientOperationId,
    )
    if (cleared.status !== 'cleared') {
      return { status: 'blocked', reason: 'clear-failed' }
    }
  } catch {
    return { status: 'blocked', reason: 'clear-failed' }
  }

  return { status: 'succeeded', completionStatus: completion.status }
}
