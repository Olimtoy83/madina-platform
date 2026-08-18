import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Transaction } from '../../transactions/types/transaction'

export type PresetReportingPeriod =
  | 'all'
  | 'today'
  | '7days'
  | 'month'

export interface CustomReportingPeriod {
  kind: 'custom'
  start: Date
  end: Date
}

export type ReportingPeriod =
  | PresetReportingPeriod
  | CustomReportingPeriod

export interface ReportingDateRange {
  from?: Date
  to: Date
}

export interface FinancialKpis {
  revenue: number
  totalIncome: number
  purchaseExpense: number
  totalExpense: number
  financialBalance: number
}

export class ReportingValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportingValidationError'
  }
}

export function resolveReportingPeriod(
  period: ReportingPeriod,
  now: Date = new Date(),
): ReportingDateRange {
  const effectiveNow = createValidDate(now, 'Текущее время')

  if (period === 'all') {
    return { to: effectiveNow }
  }

  if (period === 'today') {
    return {
      from: startOfLocalDay(effectiveNow),
      to: effectiveNow,
    }
  }

  if (period === '7days') {
    const from = startOfLocalDay(effectiveNow)

    from.setDate(from.getDate() - 6)

    return {
      from,
      to: effectiveNow,
    }
  }

  if (period === 'month') {
    return {
      from: new Date(
        effectiveNow.getFullYear(),
        effectiveNow.getMonth(),
        1,
      ),
      to: effectiveNow,
    }
  }

  const start = startOfLocalDay(
    createValidDate(period.start, 'Дата начала периода'),
  )
  const end = startOfLocalDay(
    createValidDate(period.end, 'Дата окончания периода'),
  )

  if (start > end) {
    throw new ReportingValidationError(
      'Дата начала отчётного периода не может быть позже даты окончания.',
    )
  }

  const inclusiveEnd = endOfLocalDay(end)

  return {
    from: start,
    to:
      inclusiveEnd < effectiveNow
        ? inclusiveEnd
        : effectiveNow,
  }
}

export function isDateInReportingRange(
  sourceDate: Date,
  range: ReportingDateRange,
): boolean {
  const date = createValidDate(
    sourceDate,
    'Дата исходной записи',
  )

  return (
    (!range.from || date >= range.from) &&
    date <= range.to
  )
}

export function filterByReportingPeriod<T>(
  records: readonly T[],
  getDate: (record: T) => Date,
  period: ReportingPeriod,
  now: Date = new Date(),
): T[] {
  const range = resolveReportingPeriod(period, now)

  return records.filter((record) =>
    isDateInReportingRange(getDate(record), range),
  )
}

export function getReportingEligibleTransactions(
  transactions: readonly Transaction[],
  period: ReportingPeriod,
  now: Date = new Date(),
): Transaction[] {
  return filterByReportingPeriod(
    transactions.filter(
      (transaction) =>
        transaction.status === 'completed',
    ),
    (transaction) => transaction.transactionDate,
    period,
    now,
  )
}

export function getFinancialKpis(
  transactions: readonly Transaction[],
  period: ReportingPeriod,
  now: Date = new Date(),
): FinancialKpis {
  const eligibleTransactions =
    getReportingEligibleTransactions(
      transactions,
      period,
      now,
    )

  const totals = eligibleTransactions.reduce(
    (
      currentTotals,
      transaction,
    ) => {
      if (transaction.type === 'income') {
        currentTotals.totalIncome += transaction.amount

        if (transaction.category === 'sale') {
          currentTotals.revenue += transaction.amount
        }
      }

      if (transaction.type === 'expense') {
        currentTotals.totalExpense += transaction.amount

        if (transaction.category === 'purchase') {
          currentTotals.purchaseExpense +=
            transaction.amount
        }
      }

      return currentTotals
    },
    {
      revenue: 0,
      totalIncome: 0,
      purchaseExpense: 0,
      totalExpense: 0,
    },
  )

  return {
    ...totals,
    financialBalance:
      totals.totalIncome - totals.totalExpense,
  }
}

export function getReportingEligibleSales(
  sales: readonly Sale[],
  period: ReportingPeriod,
  now: Date = new Date(),
): Sale[] {
  return filterByReportingPeriod(
    sales.filter((sale) => sale.status === 'completed'),
    (sale) => sale.saleDate,
    period,
    now,
  )
}

export function getReportingEligiblePurchases(
  purchases: readonly Purchase[],
  period: ReportingPeriod,
  now: Date = new Date(),
): Purchase[] {
  return filterByReportingPeriod(
    purchases.filter(
      (purchase) => purchase.status === 'completed',
    ),
    (purchase) => purchase.purchaseDate,
    period,
    now,
  )
}

function createValidDate(
  value: Date,
  label: string,
): Date {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new ReportingValidationError(
      `${label} должна быть корректной датой.`,
    )
  }

  return date
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date)

  start.setHours(0, 0, 0, 0)

  return start
}

function endOfLocalDay(date: Date): Date {
  const end = new Date(date)

  end.setHours(23, 59, 59, 999)

  return end
}
