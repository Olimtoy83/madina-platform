import { useCallback, useMemo, type ReactNode } from 'react'
import { isDuplicateTransaction, type Transaction } from '@madina/core'
import { getNextSnapshot } from '../shared/transactionalStorage'
import { TransactionsContext } from './TransactionsContext'
import { useTransactionalState } from './useTransactionalState'

interface TransactionsProviderProps { children: ReactNode }

export function TransactionsProvider({ children }: TransactionsProviderProps) {
  const { snapshot, commit } = useTransactionalState()
  const { transactions } = snapshot

  const addTransaction = useCallback((transaction: Transaction) => {
    if (isDuplicateTransaction(transactions, transaction)) return
    commit(getNextSnapshot(snapshot, {
      transactions: [transaction, ...transactions],
    }))
  }, [commit, snapshot, transactions])

  const updateTransaction = useCallback((transactionId: string, updates: Partial<Transaction>) => {
    const nextTransactions = transactions.map((transaction) =>
      transaction.id === transactionId
        ? { ...transaction, ...updates, updatedAt: new Date() }
        : transaction,
    )
    commit(getNextSnapshot(snapshot, { transactions: nextTransactions }))
  }, [commit, snapshot, transactions])

  const value = useMemo(() => ({ transactions, addTransaction, updateTransaction }), [transactions, addTransaction, updateTransaction])
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>
}
