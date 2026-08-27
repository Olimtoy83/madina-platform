import { useMemo, type ReactNode } from 'react'
import { TransactionsContext } from './TransactionsContext'
import { useTransactionalState } from './useTransactionalState'

interface TransactionsProviderProps { children: ReactNode }

export function TransactionsProvider({ children }: TransactionsProviderProps) {
  const { snapshot } = useTransactionalState()
  const value = useMemo(() => ({ transactions: snapshot.transactions }), [snapshot.transactions])
  return <TransactionsContext.Provider value={value}>{children}</TransactionsContext.Provider>
}
