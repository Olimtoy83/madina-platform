import type { Purchase } from '../../purchases/types/purchase'
import type { Sale } from '../../sales/types/sale'
import type { Transaction } from '../../transactions/types/transaction'
import type { ProductUnit } from '../../inventory/types/product'

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

export interface DocumentStatusBreakdown {
  draft: number
  completed: number
  cancelled: number
}

export interface DocumentReportingSummary {
  statusBreakdown: DocumentStatusBreakdown
  completedCount: number
  completedAmount: number
}

export type SalesReportingSummary =
  DocumentReportingSummary

export type PurchasesReportingSummary =
  DocumentReportingSummary

export interface ProductQuantityMetric {
  productId: string
  unit: ProductUnit
  quantity: number
}

export interface ClientSalesMetric {
  clientId: string
  clientNames: string[]
  completedSaleCount: number
  completedSaleAmount: number
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

export function getSalesReportingSummary(
  sales: readonly Sale[],
  period: ReportingPeriod,
  now: Date = new Date(),
): SalesReportingSummary {
  return getDocumentReportingSummary(
    filterByReportingPeriod(
      sales,
      (sale) => sale.saleDate,
      period,
      now,
    ),
  )
}

export function getPurchasesReportingSummary(
  purchases: readonly Purchase[],
  period: ReportingPeriod,
  now: Date = new Date(),
): PurchasesReportingSummary {
  return getDocumentReportingSummary(
    filterByReportingPeriod(
      purchases,
      (purchase) => purchase.purchaseDate,
      period,
      now,
    ),
  )
}

export function getSalesProductMetrics(
  sales: readonly Sale[],
  period: ReportingPeriod,
  now: Date = new Date(),
): ProductQuantityMetric[] {
  return getProductQuantityMetrics(
    getReportingEligibleSales(sales, period, now).flatMap(
      (sale) => sale.items,
    ),
  )
}

export function getPurchasesProductMetrics(
  purchases: readonly Purchase[],
  period: ReportingPeriod,
  now: Date = new Date(),
): ProductQuantityMetric[] {
  return getProductQuantityMetrics(
    getReportingEligiblePurchases(
      purchases,
      period,
      now,
    ).flatMap((purchase) => purchase.items),
  )
}

export function getClientSalesMetrics(
  sales: readonly Sale[],
  period: ReportingPeriod,
  now: Date = new Date(),
): ClientSalesMetric[] {
  const metricsByClientId = new Map<
    string,
    ClientSalesMetric
  >()

  for (const sale of getReportingEligibleSales(
    sales,
    period,
    now,
  )) {
    if (!sale.clientId) {
      continue
    }

    const metric = metricsByClientId.get(sale.clientId)

    if (metric) {
      metric.completedSaleCount += 1
      metric.completedSaleAmount += sale.totalAmount

      if (!metric.clientNames.includes(sale.clientName)) {
        metric.clientNames.push(sale.clientName)
      }

      continue
    }

    metricsByClientId.set(sale.clientId, {
      clientId: sale.clientId,
      clientNames: [sale.clientName],
      completedSaleCount: 1,
      completedSaleAmount: sale.totalAmount,
    })
  }

  return [...metricsByClientId.values()]
}

function getDocumentReportingSummary<
  T extends {
    status: 'draft' | 'completed' | 'cancelled'
    totalAmount: number
  },
>(documents: readonly T[]): DocumentReportingSummary {
  return documents.reduce<DocumentReportingSummary>(
    (summary, document) => {
      summary.statusBreakdown[document.status] += 1

      if (document.status === 'completed') {
        summary.completedCount += 1
        summary.completedAmount += document.totalAmount
      }

      return summary
    },
    {
      statusBreakdown: {
        draft: 0,
        completed: 0,
        cancelled: 0,
      },
      completedCount: 0,
      completedAmount: 0,
    },
  )
}

function getProductQuantityMetrics(
  items: readonly {
    productId: string
    unit: ProductUnit
    quantity: number
  }[],
): ProductQuantityMetric[] {
  const metricsByProductId = new Map<
    string,
    Map<ProductUnit, ProductQuantityMetric>
  >()

  for (const item of items) {
    const metricsByUnit =
      metricsByProductId.get(item.productId) ?? new Map()
    const metric = metricsByUnit.get(item.unit)

    if (metric) {
      metric.quantity += item.quantity
    } else {
      metricsByUnit.set(item.unit, {
        productId: item.productId,
        unit: item.unit,
        quantity: item.quantity,
      })
    }

    metricsByProductId.set(item.productId, metricsByUnit)
  }

  return [...metricsByProductId.values()].flatMap(
    (metricsByUnit) => [...metricsByUnit.values()],
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
