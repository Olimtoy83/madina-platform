import { describe, expect, it } from 'vitest'
import {
  canPreparePosCheckout,
  createPosRecoveryGateState,
  type PosRecoveryGateState,
} from './retailPosRecoveryGate'

describe('retail POS recovery gate', () => {
  it('keeps checkout blocked while recovery is checking', () => {
    expect(canPreparePosCheckout({ status: 'checking' }, 'user-1')).toBe(false)
  })

  it('maps no stored recovery snapshot to a clear gate for its owner', () => {
    const gate = createPosRecoveryGateState('user-1', { status: 'none' })

    expect(gate).toEqual({ status: 'clear', ownerUserId: 'user-1' })
    expect(canPreparePosCheckout(gate, 'user-1')).toBe(true)
  })

  it.each([
    ['pending', { status: 'pending', snapshot: {} }],
    ['foreign-owner', { status: 'foreign-owner' }],
    ['invalid', { status: 'invalid' }],
    ['storage-error', { status: 'storage-error' }],
  ] as const)('maps %s to a distinguishable blocked gate without payload details', (
    reason,
    recovery,
  ) => {
    const gate = createPosRecoveryGateState(
      'user-1',
      recovery as Parameters<typeof createPosRecoveryGateState>[1],
    )

    expect(gate).toEqual({
      status: 'blocked',
      ownerUserId: 'user-1',
      reason,
    })
    expect(canPreparePosCheckout(gate, 'user-1')).toBe(false)
    expect(gate).not.toHaveProperty('snapshot')
    expect(gate).not.toHaveProperty('payload')
  })

  it('does not let a clear state from one owner authorize another owner', () => {
    const gate: PosRecoveryGateState = {
      status: 'clear',
      ownerUserId: 'user-a',
    }

    expect(canPreparePosCheckout(gate, 'user-a')).toBe(true)
    expect(canPreparePosCheckout(gate, 'user-b')).toBe(false)
    expect(canPreparePosCheckout(gate, undefined)).toBe(false)
  })
})
