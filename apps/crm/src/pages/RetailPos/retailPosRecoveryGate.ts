import type { LoadPendingPosSaleSubmissionResult } from './retailPosSubmissionRecovery'

export type PosRecoveryGateBlockedReason =
  | 'pending'
  | 'foreign-owner'
  | 'invalid'
  | 'storage-error'

export type PosRecoveryGateState =
  | { status: 'checking' }
  | { status: 'clear'; ownerUserId: string }
  | {
      status: 'blocked'
      ownerUserId: string
      reason: PosRecoveryGateBlockedReason
    }

export function createPosRecoveryGateState(
  ownerUserId: string,
  recovery: LoadPendingPosSaleSubmissionResult,
): PosRecoveryGateState {
  if (recovery.status === 'none') {
    return { status: 'clear', ownerUserId }
  }

  return {
    status: 'blocked',
    ownerUserId,
    reason: recovery.status === 'pending'
      ? 'pending'
      : recovery.status,
  }
}

export function canPreparePosCheckout(
  gate: PosRecoveryGateState,
  currentUserId: string | undefined,
): boolean {
  return gate.status === 'clear' && gate.ownerUserId === currentUserId
}
