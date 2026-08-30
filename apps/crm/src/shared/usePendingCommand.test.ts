import { describe, expect, it } from 'vitest'
import { createPendingCommandGuard } from './usePendingCommand'

describe('createPendingCommandGuard', () => {
  it('prevents a duplicate command until the active command finishes', () => {
    const guard = createPendingCommandGuard()

    expect(guard.begin('sale.complete:sale-1')).toBe(true)
    expect(guard.begin('sale.complete:sale-1')).toBe(false)
    expect(guard.has('sale.complete:sale-1')).toBe(true)

    guard.finish('sale.complete:sale-1')

    expect(guard.has('sale.complete:sale-1')).toBe(false)
    expect(guard.begin('sale.complete:sale-1')).toBe(true)
  })

  it('keeps unrelated commands independently available', () => {
    const guard = createPendingCommandGuard()

    expect(guard.begin('task.status:task-1')).toBe(true)
    expect(guard.begin('task.delete:task-1')).toBe(true)
    expect(guard.begin('task.status:task-2')).toBe(true)
  })
})
