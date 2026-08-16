import type { Transaction } from '../types/transaction'

export type TransactionPeriod =
  | 'all'
  | 'today'
  | '7days'
  | 'month'

export interface TransactionTotals {
  income: number
  expense: number
  balance: number
}

export function getCompletedTransactions(
  transactions: Transaction[],
): Transaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.status === 'completed',
  )
}

export function getTransactionsByPeriod(
  transactions: Transaction[],
  period: TransactionPeriod,
  now = new Date(),
): Transaction[] {
  if (period === 'all') {
    return transactions
  }

  return transactions.filter((transaction) =>
    isWithinPeriod(
      transaction.transactionDate,
      period,
      now,
    ),
  )
}

export function calculateIncome(
  transactions: Transaction[],
): number {
  return transactions
    .filter(
      (transaction) =>
        transaction.status === 'completed' &&
        transaction.type === 'income',
    )
    .reduce(
      (total, transaction) =>
        total + transaction.amount,
      0,
    )
}

export function calculateExpenses(
  transactions: Transaction[],
): number {
  return transactions
    .filter(
      (transaction) =>
        transaction.status === 'completed' &&
        transaction.type === 'expense',
    )
    .reduce(
      (total, transaction) =>
        total + transaction.amount,
      0,
    )
}

export function calculateBalance(
  transactions: Transaction[],
): number {
  return (
    calculateIncome(transactions) -
    calculateExpenses(transactions)
  )
}

export function getTransactionTotals(
  transactions: Transaction[],
): TransactionTotals {
  const completedTransactions =
    getCompletedTransactions(
      transactions,
    )

  const income = calculateIncome(
    completedTransactions,
  )

  const expense = calculateExpenses(
    completedTransactions,
  )

  return {
    income,
    expense,
    balance: income - expense,
  }
}

function isWithinPeriod(
  date: Date,
  period: Exclude<TransactionPeriod, 'all'>,
  now: Date,
): boolean {
  const transactionDate = new Date(date)

  if (period === 'today') {
    return (
      transactionDate.getFullYear() ===
      now.getFullYear() &&
      transactionDate.getMonth() ===
      now.getMonth() &&
      transactionDate.getDate() ===
      now.getDate()
    )
  }

  if (period === '7days') {
    const start = new Date(now)

    start.setDate(
      now.getDate() - 6,
    )

    start.setHours(
      0,
      0,
      0,
      0,
    )

    return transactionDate >= start
  }

  if (period === 'month') {
    return (
      transactionDate.getFullYear() ===
      now.getFullYear() &&
      transactionDate.getMonth() ===
      now.getMonth()
    )
  }

  return true
}

export interface TransactionFilters {
  period?: TransactionPeriod
  type?: Transaction['type']
  status?: Transaction['status']
}

export function filterTransactions(
  transactions: Transaction[],
  filters: TransactionFilters = {},
  now = new Date(),
): Transaction[] {
  const {
    period = 'all',
    type,
    status,
  } = filters

  let result = transactions

  if (status) {
    result = result.filter(
      (transaction) =>
        transaction.status === status,
    )
  }

  if (type) {
    result = result.filter(
      (transaction) =>
        transaction.type === type,
    )
  }

  if (period !== 'all') {
    result = getTransactionsByPeriod(
      result,
      period,
      now,
    )
  }

  return result
}

export type TransactionCategoryTotals =
  Record<Transaction['category'], number>

export function calculateCategoryTotals(
  transactions: Transaction[],
): TransactionCategoryTotals {
  return {
    sale: transactions
      .filter(
        (transaction) =>
          transaction.category === 'sale',
      )
      .reduce(
        (total, transaction) =>
          total + transaction.amount,
        0,
      ),

    purchase: transactions
      .filter(
        (transaction) =>
          transaction.category === 'purchase',
      )
      .reduce(
        (total, transaction) =>
          total + transaction.amount,
        0,
      ),

    other: transactions
      .filter(
        (transaction) =>
          transaction.category === 'other',
      )
      .reduce(
        (total, transaction) =>
          total + transaction.amount,
        0,
      ),
  }
}

export interface TransactionCategoryCounts {
  sales: number
  purchases: number
}

export function calculateCategoryCounts(
  transactions: Transaction[],
): TransactionCategoryCounts {
  return {
    sales: transactions.filter(
      (transaction) =>
        transaction.type === 'income' &&
        transaction.category === 'sale',
    ).length,

    purchases: transactions.filter(
      (transaction) =>
        transaction.type === 'expense' &&
        transaction.category === 'purchase',
    ).length,
  }
}

export function isDuplicateTransaction(
  transactions: Transaction[],
  transaction: Transaction,
): boolean {
  if (!transaction.referenceId) {
    return false
  }

  return transactions.some(
    (currentTransaction) =>
      currentTransaction.category ===
      transaction.category &&
      currentTransaction.referenceId ===
      transaction.referenceId,
  )
}