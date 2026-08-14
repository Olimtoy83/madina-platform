import { createContext } from 'react'
import type { Transaction } from '@madina/core'

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
