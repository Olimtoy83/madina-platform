import { describe, expect, it } from 'vitest'
import {
  getSaleStatusLabel,
  getSaleStatusVariant,
} from './SaleDetails'

describe('SaleDetails presentation helpers', () => {
  it('presents every persisted sale status consistently', () => {
    expect(getSaleStatusLabel('draft')).toBe('Черновик')
    expect(getSaleStatusLabel('completed')).toBe('Завершено')
    expect(getSaleStatusLabel('cancelled')).toBe('Отменено')
  })

  it('uses the shared badge variants for sale status', () => {
    expect(getSaleStatusVariant('draft')).toBe('warning')
    expect(getSaleStatusVariant('completed')).toBe('success')
    expect(getSaleStatusVariant('cancelled')).toBe('danger')
  })
})
