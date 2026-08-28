import type { DatabaseSync } from 'node:sqlite'
import type {
  IncomeReport,
  IncomeReportQuery,
  ReportingAllTimeSummary,
  ReportingQueryRepository,
  ReportingStockByUnit,
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

  close(): void {
    this.database.close()
  }
}
