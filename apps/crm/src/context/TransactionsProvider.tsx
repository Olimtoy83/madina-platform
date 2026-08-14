import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Transaction } from '@madina/core'
import { loadStorage, saveStorage } from '../shared/storage'
import { TransactionsContext } from './TransactionsContext'

interface TransactionsProviderProps {
  children: ReactNode
}

type StoredTransaction = Omit<
  Transaction,
  'createdAt' | 'updatedAt' | 'transactionDate'
> & {
  createdAt: string
  updatedAt: string
  transactionDate: string
}

const STORAGE_KEY = 'transactions'

function restoreTransaction(
  transaction: StoredTransaction,
): Transaction {
  return {
    ...transaction,
    createdAt: new Date(transaction.createdAt),
    updatedAt: new Date(transaction.updatedAt),
    transactionDate: new Date(
      transaction.transactionDate,
    ),
  }
}

function loadTransactions(): Transaction[] {
  const storedTransactions =
    loadStorage<StoredTransaction[]>(
      STORAGE_KEY,
      [],
    )

  return storedTransactions.map(
    restoreTransaction,
  )
}

function hasReference(
  transaction: Transaction,
): boolean {
  return Boolean(transaction.referenceId)
}

function isDuplicateTransaction(
  transactions: Transaction[],
  transaction: Transaction,
): boolean {
  if (!hasReference(transaction)) {
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

export function TransactionsProvider({
  children,
}: TransactionsProviderProps) {
  const [transactions, setTransactions] =
    useState<Transaction[]>(
      loadTransactions,
    )

  const addTransaction = useCallback(
    (transaction: Transaction) => {
      setTransactions((currentTransactions) => {
        if (
          isDuplicateTransaction(
            currentTransactions,
            transaction,
          )
        ) {
          return currentTransactions
        }

        const nextTransactions = [
          transaction,
          ...currentTransactions,
        ]

        saveStorage(
          STORAGE_KEY,
          nextTransactions,
        )

        return nextTransactions
      })
    },
    [],
  )

  const updateTransaction = useCallback(
    (
      transactionId: string,
      updates: Partial<Transaction>,
    ) => {
      setTransactions((currentTransactions) => {
        const nextTransactions =
          currentTransactions.map(
            (transaction) =>
              transaction.id === transactionId
                ? {
                  ...transaction,
                  ...updates,
                  updatedAt: new Date(),
                }
                : transaction,
          )

        saveStorage(
          STORAGE_KEY,
          nextTransactions,
        )

        return nextTransactions
      })
    },
    [],
  )

  const getTransactionsByType = useCallback(
    (type: Transaction['type']) =>
      transactions.filter(
        (transaction) =>
          transaction.type === type,
      ),
    [transactions],
  )

  const getTransactionsByCategory =
    useCallback(
      (
        category: Transaction['category'],
      ) =>
        transactions.filter(
          (transaction) =>
            transaction.category ===
            category,
        ),
      [transactions],
    )

  const value = useMemo(
    () => ({
      transactions,
      addTransaction,
      updateTransaction,
      getTransactionsByType,
      getTransactionsByCategory,
    }),
    [
      transactions,
      addTransaction,
      updateTransaction,
      getTransactionsByType,
      getTransactionsByCategory,
    ],
  )

  return (
    <TransactionsContext.Provider
      value={value}
    >
      {children}
    </TransactionsContext.Provider>
  )
}
