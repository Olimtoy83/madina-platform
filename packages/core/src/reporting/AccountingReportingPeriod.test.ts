import { describe, expect, it } from 'vitest'
import {
  resolveAccountingReportWindow,
  resolveBusinessDateStart,
  resolveBusinessDateRange,
} from './AccountingReportingPeriod.js'

describe('resolveAccountingReportWindow', () => {
  const now = new Date('2026-03-01T01:30:00.000Z')

  it('resolves Asia/Riyadh calendar boundaries from absolute instants', () => {
    expect(resolveAccountingReportWindow('today', now)).toEqual({
      from: new Date('2026-02-28T21:00:00.000Z'),
      to: now,
    })
    expect(resolveAccountingReportWindow('7days', now)).toEqual({
      from: new Date('2026-02-22T21:00:00.000Z'),
      to: now,
    })
    expect(resolveAccountingReportWindow('month', now)).toEqual({
      from: new Date('2026-02-28T21:00:00.000Z'),
      to: now,
    })
    expect(resolveAccountingReportWindow('all', now)).toEqual({ to: now })
  })

  it('resolves inclusive Riyadh calendar dates as a half-open window', () => {
    expect(resolveBusinessDateRange('2025-08-28', '2025-08-28')).toEqual({
      from: new Date('2025-08-27T21:00:00.000Z'),
      toExclusive: new Date('2025-08-28T21:00:00.000Z'),
    })
  })

  it('resolves a purchase calendar date at Asia/Riyadh midnight independently of browser time', () => {
    expect(resolveBusinessDateStart('2026-08-29')).toEqual(
      new Date('2026-08-28T21:00:00.000Z'),
    )
  })
})
