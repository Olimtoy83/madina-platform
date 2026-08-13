import { createContext } from 'react'
import type { Transaction } from '../entities/transaction'

export interface TransactionsContextValue {
  transactions: Transaction[]

  addTransaction: (
    transaction: Transaction,
  ) => void

  updateTransaction: (
    transactionId: string,
    updates: Partial<Transaction>,
  ) => void

  getTransactionsByType: (
    type: Transaction['type'],
  ) => Transaction[]

  getTransactionsByCategory: (
    category: Transaction['category'],
  ) => Transaction[]
}

export const TransactionsContext =
  createContext<TransactionsContextValue | null>(null)