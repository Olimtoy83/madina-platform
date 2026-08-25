import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  normalizePurchase,
  updatePurchase as updatePurchaseCore,
  type Purchase,
  type PurchaseStatus,
} from '@madina/core'
import { getNextSnapshot, TransactionalPersistenceError } from '../shared/transactionalStorage'
import { PurchasesContext } from './PurchasesContext'
import { useTransactionalState } from './useTransactionalState'
import {
  completePurchaseSnapshot,
  createCompletionGuard,
} from '../shared/transactionalCompletion'

interface PurchasesProviderProps { children: ReactNode }

export function PurchasesProvider({ children }: PurchasesProviderProps) {
  const { snapshot, commit, persistenceError } = useTransactionalState()
  const { purchases } = snapshot
  const completionGuard = useRef(createCompletionGuard())

  const addPurchase = useCallback((purchase: Purchase) => {
    try {
      const normalizedPurchase =
        normalizePurchase(purchase)

      commit(
        getNextSnapshot(snapshot, {
          purchases: [
            normalizedPurchase,
            ...purchases,
          ],
        }),
      )

      return {
        success: true,
      }
    } catch (error) {
      if (
        error instanceof
        TransactionalPersistenceError
      ) {
        return {
          success: false,
          message: error.message,
        }
      }

      throw error
    }
  }, [commit, purchases, snapshot])

  const updatePurchase = useCallback((purchaseId: string, updates: Partial<Purchase>) => {
    const nextPurchases = purchases.map((purchase) => purchase.id === purchaseId
      ? updatePurchaseCore(purchase, updates)
      : purchase)
    commit(getNextSnapshot(snapshot, { purchases: nextPurchases }))
  }, [commit, purchases, snapshot])

  const completePurchase = useCallback((purchaseId: string) => {
    if (persistenceError) return { success: false, message: persistenceError.message }
    if (!completionGuard.current.begin(purchaseId)) {
      return { success: false, message: 'Завершение поступления уже выполняется.' }
    }
    try {
      const result = completePurchaseSnapshot(snapshot, purchaseId)
      if (!result.success || !result.snapshot) {
        return { success: false, message: result.message }
      }
      commit(result.snapshot)
      return { success: true }
    } catch (error) {
      if (error instanceof TransactionalPersistenceError) {
        return { success: false, message: error.message }
      }
      throw error
    } finally {
      completionGuard.current.finish(purchaseId)
    }
  }, [commit, persistenceError, snapshot])

  const cancelPurchase = useCallback((purchaseId: string) => {
    try {
      const nextPurchases = purchases.map(
        (purchase) =>
          purchase.id === purchaseId &&
            purchase.status === 'draft'
            ? {
              ...purchase,
              status:
                'cancelled' as PurchaseStatus,
              updatedAt: new Date(),
            }
            : purchase,
      )

      commit(
        getNextSnapshot(snapshot, {
          purchases: nextPurchases,
        }),
      )

      return {
        success: true,
      }
    } catch (error) {
      if (
        error instanceof
        TransactionalPersistenceError
      ) {
        return {
          success: false,
          message: error.message,
        }
      }

      throw error
    }
  }, [commit, purchases, snapshot])

  const value = useMemo(() => ({ purchases, addPurchase, updatePurchase, completePurchase, cancelPurchase }), [purchases, addPurchase, updatePurchase, completePurchase, cancelPurchase])
  return <PurchasesContext.Provider value={value}>{children}</PurchasesContext.Provider>
}
