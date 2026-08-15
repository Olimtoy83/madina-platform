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