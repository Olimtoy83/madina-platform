import { BUSINESS_TIMEZONE } from '@madina/shared/constants/app'
import type {
  AccountingReportPeriod,
  AccountingReportWindow,
} from './ReportingQueryRepository.js'

interface CalendarDate {
  year: number
  month: number
  day: number
}

export interface BusinessDateRange {
  from?: Date
  toExclusive?: Date
}

export class BusinessDateRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessDateRangeError'
  }
}

const calendarFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  calendar: 'iso8601',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  timeZoneName: 'longOffset',
})

export function resolveAccountingReportWindow(
  period: AccountingReportPeriod,
  now: Date,
): AccountingReportWindow {
  return resolveReportingPeriodWindow(period, now)
}

export function resolveReportingPeriodWindow(
  period: AccountingReportPeriod,
  now: Date,
): AccountingReportWindow {
  const effectiveNow = new Date(now)

  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error('Accounting report effective time is invalid.')
  }

  if (period === 'all') {
    return { to: effectiveNow }
  }

  const today = getCalendarDate(effectiveNow)

  if (period === 'today') {
    return {
      from: calendarDateStart(today),
      to: effectiveNow,
    }
  }

  if (period === '7days') {
    return {
      from: calendarDateStart(addCalendarDays(today, -6)),
      to: effectiveNow,
    }
  }

  return {
    from: calendarDateStart({
      year: today.year,
      month: today.month,
      day: 1,
    }),
    to: effectiveNow,
  }
}

/** Resolves inclusive business calendar dates to absolute half-open instants. */
export function resolveBusinessDateRange(
  dateFrom?: string,
  dateTo?: string,
): BusinessDateRange {
  const from = dateFrom === undefined
    ? undefined
    : calendarDateStart(parseBusinessDate(dateFrom))
  const toExclusive = dateTo === undefined
    ? undefined
    : calendarDateStart(addCalendarDays(parseBusinessDate(dateTo), 1))

  if (from && toExclusive && from >= toExclusive) {
    throw new BusinessDateRangeError('Business date range is invalid.')
  }

  return { from, toExclusive }
}

function parseBusinessDate(value: string): CalendarDate {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new BusinessDateRangeError('Business date is invalid.')

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  const candidate = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (
    candidate.getUTCFullYear() !== date.year ||
    candidate.getUTCMonth() + 1 !== date.month ||
    candidate.getUTCDate() !== date.day
  ) {
    throw new BusinessDateRangeError('Business date is invalid.')
  }

  return date
}

function getCalendarDate(instant: Date): CalendarDate {
  const parts = calendarFormatter.formatToParts(instant)
  const values = new Map(parts.map((part) => [part.type, part.value]))

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  }
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(
    date.year,
    date.month - 1,
    date.day + days,
  ))

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function calendarDateStart(date: CalendarDate): Date {
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day)
  let instant = new Date(utcMidnight - getOffsetMilliseconds(
    new Date(utcMidnight),
  ))

  // Re-read the IANA offset at the candidate instant so this remains correct
  // for timezone transitions instead of assuming an offset from the host.
  instant = new Date(utcMidnight - getOffsetMilliseconds(instant))
  return instant
}

function getOffsetMilliseconds(instant: Date): number {
  const offset = offsetFormatter.formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = offset?.match(/^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/)

  if (!match) {
    throw new Error('Unable to resolve the business timezone offset.')
  }

  if (!match.groups?.sign) return 0

  const milliseconds = (
    Number(match.groups.hours) * 60 + Number(match.groups.minutes)
  ) * 60_000

  return match.groups.sign === '+' ? milliseconds : -milliseconds
}
