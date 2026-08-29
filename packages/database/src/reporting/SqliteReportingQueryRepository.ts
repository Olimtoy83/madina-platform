import type { DatabaseSync } from 'node:sqlite'
import type {
  AccountingReport,
  AccountingReportQuery,
  IncomeReport,
  IncomeReportQuery,
  ReportingAllTimeSummary,
  ReportingQueryRepository,
  ReportingStockByUnit,
  SalesReport,
  SalesReportQuery,
  StatisticsReport,
  StatisticsReportQuery,
  Transaction,
} from '@madina/core'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface FinancialRow {
  total_income: number
  total_expense: number
  revenue: number
  purchase_expense: number
}

interface SalesRow {
  completed_count: number
}

interface InventoryRow {
  product_count: number
  active_product_count: number
}

interface StockByUnitRow {
  unit: ReportingStockByUnit['unit']
  quantity: number
}

interface TransactionRow {
  id: string
  created_at: string
  updated_at: string
  type: Transaction['type']
  category: Transaction['category']
  amount: number
  payment_method: Transaction['paymentMethod']
  transaction_date: string
  reference_id: string | null
  description: string | null
  status: Transaction['status']
}

interface AccountingAggregateRow {
  total_income: number
  total_expense: number
  transaction_count: number
  sale_total: number
  purchase_total: number
  other_total: number
}

interface SalesReportAggregateRow {
  draft_count: number
  completed_count: number
  cancelled_count: number
  completed_amount: number
}

interface StatisticsTaskAggregateRow {
  total_count: number
  todo_count: number
  in_progress_count: number
  completed_count: number
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    type: row.type,
    category: row.category,
    amount: row.amount,
    paymentMethod: row.payment_method,
    transactionDate: new Date(row.transaction_date),
    referenceId: row.reference_id ?? undefined,
    description: row.description ?? undefined,
    status: row.status,
  }
}

export class SqliteReportingQueryRepository
  implements ReportingQueryRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async getAllTimeSummary(
    now = new Date(),
  ): Promise<ReportingAllTimeSummary> {
    const currentTime = now.toISOString()
    this.database.exec('BEGIN')

    try {
      const financial = this.database.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN status = 'completed' AND type = 'income'
            THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE
            WHEN status = 'completed' AND type = 'expense'
            THEN amount ELSE 0 END), 0) AS total_expense,
          COALESCE(SUM(CASE
            WHEN status = 'completed' AND type = 'income' AND category = 'sale'
            THEN amount ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE
            WHEN status = 'completed' AND type = 'expense' AND category = 'purchase'
            THEN amount ELSE 0 END), 0) AS purchase_expense
        FROM transactions
        WHERE transaction_date <= ?
      `).get(currentTime) as unknown as FinancialRow

      const sales = this.database.prepare(`
        SELECT COUNT(*) AS completed_count
        FROM sales
        WHERE status = 'completed' AND sale_date <= ?
      `).get(currentTime) as unknown as SalesRow

      const inventory = this.database.prepare(`
        SELECT
          COUNT(*) AS product_count,
          COALESCE(SUM(CASE
            WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_product_count
        FROM products
      `).get() as unknown as InventoryRow

      const stockByUnit = this.database.prepare(`
        SELECT unit, COALESCE(SUM(quantity), 0) AS quantity
        FROM products
        GROUP BY unit
        ORDER BY unit ASC
      `).all() as unknown as StockByUnitRow[]

      this.database.exec('COMMIT')

      return {
        sales: {
          completedCount: sales.completed_count,
        },
        financial: {
          totalIncome: financial.total_income,
          totalExpense: financial.total_expense,
          financialBalance:
            financial.total_income - financial.total_expense,
          revenue: financial.revenue,
          purchaseExpense: financial.purchase_expense,
        },
        inventory: {
          productCount: inventory.product_count,
          activeProductCount: inventory.active_product_count,
          stockByUnit: stockByUnit.map((row) => ({
            unit: row.unit,
            quantity: row.quantity,
          })),
        },
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getIncomeReport(
    query: IncomeReportQuery,
    now = new Date(),
  ): Promise<IncomeReport> {
    const effectiveNow = now.toISOString()
    this.database.exec('BEGIN')

    try {
      const financial = this.database.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE
            WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense
        FROM transactions
        WHERE status = 'completed' AND transaction_date <= ?
      `).get(effectiveNow) as unknown as Pick<
        FinancialRow,
        'total_income' | 'total_expense'
      >

      const parameters: Array<string | number> = [effectiveNow]
      let filters = "status = 'completed' AND transaction_date <= ?"

      if (query.type) {
        filters += ' AND type = ?'
        parameters.push(query.type)
      }

      if (query.cursor) {
        filters += ` AND (
          transaction_date < ? OR (
            transaction_date = ? AND id < ?
          )
        )`
        const cursorDate = query.cursor.transactionDate.toISOString()
        parameters.push(cursorDate, cursorDate, query.cursor.id)
      }

      parameters.push(query.limit)
      const rows = this.database.prepare(`
        SELECT id, created_at, updated_at, type, category, amount,
          payment_method, transaction_date, reference_id, description, status
        FROM transactions
        WHERE ${filters}
        ORDER BY transaction_date DESC, id DESC
        LIMIT ?
      `).all(...parameters) as unknown as TransactionRow[]

      this.database.exec('COMMIT')

      return {
        summary: {
          totalIncome: financial.total_income,
          totalExpense: financial.total_expense,
          financialBalance:
            financial.total_income - financial.total_expense,
        },
        transactions: rows.map(toTransaction),
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getAccountingReport(
    query: AccountingReportQuery,
  ): Promise<AccountingReport> {
    const parameters: Array<string | number> = [
      query.window.to.toISOString(),
    ]
    let filters = "status = 'completed' AND transaction_date <= ?"

    if (query.window.from) {
      filters += ' AND transaction_date >= ?'
      parameters.push(query.window.from.toISOString())
    }

    if (query.type) {
      filters += ' AND type = ?'
      parameters.push(query.type)
    }

    this.database.exec('BEGIN')

    try {
      const aggregate = this.database.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE
            WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
          COUNT(*) AS transaction_count,
          COALESCE(SUM(CASE
            WHEN category = 'sale' THEN amount ELSE 0 END), 0) AS sale_total,
          COALESCE(SUM(CASE
            WHEN category = 'purchase' THEN amount ELSE 0 END), 0) AS purchase_total,
          COALESCE(SUM(CASE
            WHEN category = 'other' THEN amount ELSE 0 END), 0) AS other_total
        FROM transactions
        WHERE ${filters}
      `).get(...parameters) as unknown as AccountingAggregateRow

      const rowParameters = [...parameters]
      let rowFilters = filters

      if (query.cursor) {
        rowFilters += ` AND (
          transaction_date < ? OR (
            transaction_date = ? AND id < ?
          )
        )`
        const cursorDate = query.cursor.transactionDate.toISOString()
        rowParameters.push(cursorDate, cursorDate, query.cursor.id)
      }

      rowParameters.push(query.limit)
      const rows = this.database.prepare(`
        SELECT id, created_at, updated_at, type, category, amount,
          payment_method, transaction_date, reference_id, description, status
        FROM transactions
        WHERE ${rowFilters}
        ORDER BY transaction_date DESC, id DESC
        LIMIT ?
      `).all(...rowParameters) as unknown as TransactionRow[]

      this.database.exec('COMMIT')

      return {
        summary: {
          totalIncome: aggregate.total_income,
          totalExpense: aggregate.total_expense,
          financialBalance:
            aggregate.total_income - aggregate.total_expense,
          transactionCount: aggregate.transaction_count,
        },
        categories: {
          sale: aggregate.sale_total,
          purchase: aggregate.purchase_total,
          other: aggregate.other_total,
        },
        transactions: rows.map(toTransaction),
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async getSalesReport(query: SalesReportQuery): Promise<SalesReport> {
    const parameters: string[] = [query.window.to.toISOString()]
    let filters = 'sale_date <= ?'

    if (query.window.from) {
      filters += ' AND sale_date >= ?'
      parameters.push(query.window.from.toISOString())
    }

    const aggregate = this.database.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
        COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
        COALESCE(SUM(CASE
          WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS completed_amount
      FROM sales
      WHERE ${filters}
    `).get(...parameters) as unknown as SalesReportAggregateRow

    return {
      period: query.period,
      statusCounts: {
        draft: aggregate.draft_count,
        completed: aggregate.completed_count,
        cancelled: aggregate.cancelled_count,
      },
      completedAmount: aggregate.completed_amount,
    }
  }

  async getStatisticsReport(
    query: StatisticsReportQuery,
  ): Promise<StatisticsReport> {
    const parameters: Array<string | number> = [
      query.window.to.toISOString(),
    ]
    let filters = "status = 'completed' AND transaction_date <= ?"

    if (query.window.from) {
      filters += ' AND transaction_date >= ?'
      parameters.push(query.window.from.toISOString())
    }

    this.database.exec('BEGIN')

    try {
      const financial = this.database.prepare(`
        SELECT
          COALESCE(SUM(CASE
            WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
          COALESCE(SUM(CASE
            WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
          COUNT(*) AS transaction_count,
          COALESCE(SUM(CASE
            WHEN category = 'sale' THEN amount ELSE 0 END), 0) AS sale_total,
          COALESCE(SUM(CASE
            WHEN category = 'purchase' THEN amount ELSE 0 END), 0) AS purchase_total,
          COALESCE(SUM(CASE
            WHEN category = 'other' THEN amount ELSE 0 END), 0) AS other_total
        FROM transactions
        WHERE ${filters}
      `).get(...parameters) as unknown as AccountingAggregateRow

      const dateParameters = [
        query.window.to.toISOString(),
        ...(query.window.from ? [query.window.from.toISOString()] : []),
      ]
      const dateRange = query.window.from
        ? 'AND sale_date >= ?'
        : ''
      const sales = this.database.prepare(`
        SELECT COUNT(*) AS completed_count
        FROM sales
        WHERE status = 'completed' AND sale_date <= ? ${dateRange}
      `).get(...dateParameters) as unknown as SalesRow
      const purchaseDateRange = query.window.from
        ? 'AND purchase_date >= ?'
        : ''
      const purchases = this.database.prepare(`
        SELECT COUNT(*) AS completed_count
        FROM purchases
        WHERE status = 'completed' AND purchase_date <= ? ${purchaseDateRange}
      `).get(...dateParameters) as unknown as SalesRow

      const inventory = this.database.prepare(`
        SELECT COUNT(*) AS product_count
        FROM products
      `).get() as unknown as Pick<InventoryRow, 'product_count'>
      const stockByUnit = this.database.prepare(`
        SELECT unit, COALESCE(SUM(quantity), 0) AS quantity
        FROM products
        GROUP BY unit
        ORDER BY unit ASC
      `).all() as unknown as StockByUnitRow[]
      const tasks = this.database.prepare(`
        SELECT
          COUNT(*) AS total_count,
          COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END), 0) AS todo_count,
          COALESCE(SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
        FROM tasks
      `).get() as unknown as StatisticsTaskAggregateRow

      const rowParameters = [...parameters]
      let rowFilters = filters
      if (query.cursor) {
        rowFilters += ` AND (
          transaction_date < ? OR (
            transaction_date = ? AND id < ?
          )
        )`
        const cursorDate = query.cursor.transactionDate.toISOString()
        rowParameters.push(cursorDate, cursorDate, query.cursor.id)
      }
      rowParameters.push(query.limit)
      const rows = this.database.prepare(`
        SELECT id, created_at, updated_at, type, category, amount,
          payment_method, transaction_date, reference_id, description, status
        FROM transactions
        WHERE ${rowFilters}
        ORDER BY transaction_date DESC, id DESC
        LIMIT ?
      `).all(...rowParameters) as unknown as TransactionRow[]

      this.database.exec('COMMIT')

      return {
        period: query.period,
        financial: {
          totalIncome: financial.total_income,
          totalExpense: financial.total_expense,
          financialBalance: financial.total_income - financial.total_expense,
          transactionCount: financial.transaction_count,
          categories: {
            sale: financial.sale_total,
            purchase: financial.purchase_total,
            other: financial.other_total,
          },
        },
        sales: { completedCount: sales.completed_count },
        purchases: { completedCount: purchases.completed_count },
        inventory: {
          productCount: inventory.product_count,
          stockByUnit: stockByUnit.map((row) => ({
            unit: row.unit,
            quantity: row.quantity,
          })),
        },
        tasks: {
          total: tasks.total_count,
          todo: tasks.todo_count,
          inProgress: tasks.in_progress_count,
          completed: tasks.completed_count,
        },
        operations: rows.map(toTransaction),
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.database.close()
  }
}
