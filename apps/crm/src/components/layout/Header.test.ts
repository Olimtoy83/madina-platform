import { describe, expect, it } from 'vitest'
import { getPageTitle } from './Header'

describe('getPageTitle', () => {
  it('keeps client and sale detail routes in their current sections', () => {
    expect(getPageTitle('/clients/client-1')).toBe('Клиенты')
    expect(getPageTitle('/sales/sale-1')).toBe('Продажи')
    expect(getPageTitle('/retail/offline-operations')).toBe('Офлайн-операции')
  })
})
