import { describe, expect, it } from 'vitest'
import { resolveAccountingReportWindow } from './AccountingReportingPeriod.js'

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
})
