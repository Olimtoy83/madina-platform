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

  it('does not render navigation before authentication is established', () => {
    expect(getVisibleNavigationItems(null)).toEqual([])
  })
})
