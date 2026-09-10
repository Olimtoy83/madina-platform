import { describe, expect, it } from 'vitest'
import { getVisibleNavigationItems } from './navigation'

describe('CRM navigation', () => {
  it('keeps all readable CRM sections visible to a viewer', () => {
    const items = getVisibleNavigationItems({
      id: 'user-viewer',
      username: 'viewer',
      role: 'viewer',
    })

    expect(items.map((item) => item.path)).toEqual([
      '/',
      '/warehouse',
      '/warehouse/movements',
      '/purchases',
      '/sales',
      '/reports/sales',
      '/clients',
      '/income',
      '/accounting',
      '/tasks',
      '/statistics',
    ])
  })

  it('shows Retail POS only to roles with retail sales capability', () => {
    const adminItems = getVisibleNavigationItems({
      id: 'user-admin',
      username: 'admin',
      role: 'admin',
    })

    const managerItems = getVisibleNavigationItems({
      id: 'user-manager',
      username: 'manager',
      role: 'manager',
    })

    const operatorItems = getVisibleNavigationItems({
      id: 'user-operator',
      username: 'operator',
      role: 'operator',
    })

    const viewerItems = getVisibleNavigationItems({
      id: 'user-viewer',
      username: 'viewer',
      role: 'viewer',
    })

    expect(adminItems.some((item) => item.path === '/retail/pos')).toBe(true)
    expect(managerItems.some((item) => item.path === '/retail/pos')).toBe(true)
    expect(operatorItems.some((item) => item.path === '/retail/pos')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/pos')).toBe(false)
  })

  it('does not render navigation before authentication is established', () => {
    expect(getVisibleNavigationItems(null)).toEqual([])
  })
})
