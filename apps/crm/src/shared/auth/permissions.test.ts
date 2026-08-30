import { describe, expect, it } from 'vitest'
import { can } from './permissions'

describe('CRM permission helper', () => {
  it('keeps viewers on readable pages without write actions', () => {
    const viewer = {
      id: 'user-viewer',
      username: 'viewer',
      role: 'viewer' as const,
    }

    expect(can(viewer, 'commerce:read')).toBe(true)
    expect(can(viewer, 'reports:read')).toBe(true)
    expect(can(viewer, 'sales:write')).toBe(false)
  })

  it('uses the shared policy for operator and manager actions', () => {
    const operator = {
      id: 'user-operator',
      username: 'operator',
      role: 'operator' as const,
    }
    const manager = {
      id: 'user-manager',
      username: 'manager',
      role: 'manager' as const,
    }

    expect(can(operator, 'sales:write')).toBe(true)
    expect(can(operator, 'purchases:write')).toBe(false)
    expect(can(manager, 'products:write')).toBe(true)
    expect(can(manager, 'data:import')).toBe(false)
  })
})
