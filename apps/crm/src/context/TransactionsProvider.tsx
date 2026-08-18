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

  const value = useMemo(() => ({ transactions, addTransaction }), [
    transactions,
    addTransaction,
  ])
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>
}
