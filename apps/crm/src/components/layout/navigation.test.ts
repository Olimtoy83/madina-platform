import { describe, expect, it } from 'vitest'
import { getVisibleNavigationItems, getWorkspaceHomePath } from './navigation'

describe('CRM navigation', () => {
  it('keeps all readable CRM sections visible to a viewer', () => {
    const items = getVisibleNavigationItems({
      id: 'user-viewer',
      username: 'viewer',
      role: 'viewer',
    }, 'default')

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

  it('shows Retail POS and Sales Journal only to roles with the required retail capabilities', () => {
    const adminItems = getVisibleNavigationItems({
      id: 'user-admin',
      username: 'admin',
      role: 'admin',
    }, 'default')

    const managerItems = getVisibleNavigationItems({
      id: 'user-manager',
      username: 'manager',
      role: 'manager',
    }, 'default')

    const operatorItems = getVisibleNavigationItems({
      id: 'user-operator',
      username: 'operator',
      role: 'operator',
    }, 'default')

    const viewerItems = getVisibleNavigationItems({
      id: 'user-viewer',
      username: 'viewer',
      role: 'viewer',
    }, 'default')

    expect(adminItems.some((item) => item.path === '/retail/pos')).toBe(true)
    expect(managerItems.some((item) => item.path === '/retail/pos')).toBe(true)
    expect(operatorItems.some((item) => item.path === '/retail/pos')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/pos')).toBe(false)
    for (const items of [adminItems, managerItems]) {
      const paths = items.map((item) => item.path)
      expect(paths.indexOf('/retail/sales')).toBe(paths.indexOf('/retail/pos') + 1)
      expect(paths.indexOf('/retail/offline-operations')).toBeGreaterThan(paths.indexOf('/retail/sales'))
      expect(paths.indexOf('/retail/terminal-setup')).toBe(paths.indexOf('/retail/offline-operations') + 1)
    }
    expect(operatorItems.some((item) => item.path === '/retail/sales')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/sales')).toBe(false)
    expect(operatorItems.some((item) => item.path === '/retail/offline-operations')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/offline-operations')).toBe(false)
    expect(operatorItems.some((item) => item.path === '/retail/terminal-setup')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/terminal-setup')).toBe(false)
  })

  it('does not render navigation before authentication is established', () => {
    expect(getVisibleNavigationItems(null)).toEqual([])
  })

  it('shows the concise SABONO retail workspace without generic or technical links', () => {
    const items = getVisibleNavigationItems({
      id: 'user-manager',
      username: 'manager',
      role: 'manager',
    }, 'sabono-retail')

    expect(items.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'Касса', path: '/retail/pos' },
      { label: 'Продажи', path: '/retail/sales' },
      { label: 'Товары', path: '/retail/products' },
      { label: 'Остатки', path: '/retail/inventory' },
      { label: 'Поступления', path: '/retail/goods-receipts' },
    ])
  })

  it('keeps the generic profile unchanged and opens SABONO at its first visible retail workflow', () => {
    const manager = { id: 'user-manager', username: 'manager', role: 'manager' } as const

    expect(getVisibleNavigationItems(manager, 'default').map((item) => item.path)).toEqual(
      navigationPathsForManager(),
    )
    expect(getWorkspaceHomePath(manager, 'default')).toBe('/')
    expect(getWorkspaceHomePath(manager, 'sabono-retail')).toBe('/retail/pos')
  })

  it('does not select a hidden generic home when SABONO has no visible retail workflow', () => {
    const viewer = { id: 'user-viewer', username: 'viewer', role: 'viewer' } as const

    expect(getVisibleNavigationItems(viewer, 'sabono-retail')).toEqual([])
    expect(getWorkspaceHomePath(viewer, 'sabono-retail')).toBeUndefined()
  })

  it('offers inventory and goods-receipts workflows only to roles with their read capabilities', () => {
    const managerItems = getVisibleNavigationItems({ id: 'user-manager', username: 'manager', role: 'manager' }, 'default')
    const viewerItems = getVisibleNavigationItems({ id: 'user-viewer', username: 'viewer', role: 'viewer' }, 'default')

    expect(managerItems.some((item) => item.path === '/retail/inventory')).toBe(true)
    expect(managerItems.some((item) => item.path === '/retail/goods-receipts')).toBe(true)
    expect(viewerItems.some((item) => item.path === '/retail/inventory')).toBe(false)
    expect(viewerItems.some((item) => item.path === '/retail/goods-receipts')).toBe(false)
  })
})

function navigationPathsForManager(): readonly string[] {
  return [
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
    '/retail/pos',
    '/retail/sales',
    '/retail/products',
    '/retail/inventory',
    '/retail/goods-receipts',
    '/retail/offline-operations',
    '/retail/terminal-setup',
  ]
}
