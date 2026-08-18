import { createContext } from 'react'
import type { Transaction } from '@madina/core'

export interface TransactionsContextValue {
  transactions: Transaction[]

  addTransaction: (
    transaction: Transaction,
  ) => void
}

export const TransactionsContext =
  createContext<TransactionsContextValue | null>(null)
