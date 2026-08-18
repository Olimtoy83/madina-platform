import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  completePurchase as completePurchaseCore,
  normalizePurchase,
  type Purchase,
  type PurchaseStatus,
} from '@madina/core'

import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { useProducts } from './useProducts'
import { useStockMovements } from './useStockMovements'
import { useTransactions } from './useTransactions'
import { PurchasesContext } from './PurchasesContext'

interface PurchasesProviderProps {
  children: ReactNode
}

type StoredPurchase = Omit<
  Purchase,
  'createdAt' | 'updatedAt' | 'purchaseDate'
> & {
  createdAt: string
  updatedAt: string
  purchaseDate: string
}

const STORAGE_KEY = 'purchases'

function restorePurchase(
  purchase: StoredPurchase,
): Purchase {
  return {
    ...purchase,
    createdAt: new Date(purchase.createdAt),
    updatedAt: new Date(purchase.updatedAt),
    purchaseDate: new Date(
      purchase.purchaseDate,
    ),
  }
}

function loadPurchases(): Purchase[] {
  const storedPurchases =
    loadStorage<StoredPurchase[]>(
      STORAGE_KEY,
      [],
    )


  return storedPurchases
    .map(restorePurchase)
    .map(normalizePurchase)
}

export function PurchasesProvider({
  children,
}: PurchasesProviderProps) {
  const [purchases, setPurchases] =
    useState<Purchase[]>(loadPurchases)

  const {
    products,
    replaceProducts,
  } = useProducts()

  const { addMovement } =
    useStockMovements()

  const { addTransaction } =
    useTransactions()

  const addPurchase = useCallback(
    (purchase: Purchase) => {
      const normalizedPurchase = normalizePurchase(
        purchase,
      )

      setPurchases((currentPurchases) => {
        const nextPurchases = [
          normalizedPurchase,
          ...currentPurchases,
        ]

        saveStorage(
          STORAGE_KEY,
          nextPurchases,
        )

        return nextPurchases
      })
    },
    [],
  )

  const updatePurchase = useCallback(
    (
      purchaseId: string,
      updates: Partial<Purchase>,
    ) => {
      setPurchases((currentPurchases) => {
        const nextPurchases =
          currentPurchases.map(
            (purchase) =>
              purchase.id === purchaseId
                ? {
                  ...purchase,
                  ...updates,
                  updatedAt: new Date(),
                }
                : purchase,
          )

        saveStorage(
          STORAGE_KEY,
          nextPurchases,
        )

        return nextPurchases
      })
    },
    [],
  )

  const completePurchase = useCallback(
    (purchaseId: string) => {
      const purchase = purchases.find(
        (item) => item.id === purchaseId,
      )

      if (!purchase) {
        return {
          success: false,
          message: 'Поступление не найдено.',
        }
      }

      const result = completePurchaseCore(
        purchase,
        products,
      )

      if (!result.success) {
        return {
          success: false,
          message: result.message,
        }
      }

      replaceProducts(result.products)

      for (const movement of result.movements) {
        addMovement(movement)
      }

      if (result.transaction) {
        addTransaction(result.transaction)
      }

      setPurchases((currentPurchases) => {
        const nextPurchases =
          currentPurchases.map(
            (currentPurchase) =>
              currentPurchase.id === purchaseId
                ? result.purchase!
                : currentPurchase,
          )

        saveStorage(
          STORAGE_KEY,
          nextPurchases,
        )

        return nextPurchases
      })

      return {
        success: true,
      }
    },
    [
      purchases,
      products,
      replaceProducts,
      addMovement,
      addTransaction,
    ],
  )

  const cancelPurchase = useCallback(
    (purchaseId: string) => {
      setPurchases((currentPurchases) => {
        const nextPurchases =
          currentPurchases.map((purchase) =>
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

        saveStorage(
          STORAGE_KEY,
          nextPurchases,
        )

        return nextPurchases
      })
    },
    [],
  )

  const value = useMemo(
    () => ({
      purchases,
      addPurchase,
      updatePurchase,
      completePurchase,
      cancelPurchase,
    }),
    [
      purchases,
      addPurchase,
      updatePurchase,
      completePurchase,
      cancelPurchase,
    ],
  )

  return (
    <PurchasesContext.Provider value={value}>
      {children}
    </PurchasesContext.Provider>
  )
}
