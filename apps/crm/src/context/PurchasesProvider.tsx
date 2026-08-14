import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  Purchase,
  PurchaseStatus,
} from '../entities/purchase'
import type { StockMovement } from '../entities/stockMovement'
import { mockPurchases } from '../pages/Purchases/mockPurchases'
import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { useProducts } from './useProducts'
import { useStockMovements } from './useStockMovements'
import { receiveStock } from '../services/StockService'
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

  if (storedPurchases.length === 0) {
    return mockPurchases
  }

  return storedPurchases.map(
    restorePurchase,
  )
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
      setPurchases((currentPurchases) => {
        const nextPurchases = [
          purchase,
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

      if (purchase.status !== 'draft') {
        return {
          success: false,
          message:
            'Можно завершить только черновик поступления.',
        }
      }

      for (const item of purchase.items) {
        const product = products.find(
          (currentProduct) =>
            currentProduct.id === item.productId,
        )

        if (!product) {
          return {
            success: false,
            message:
              `Товар не найден на складе: ${item.productId}.`,
          }
        }
      }

      const updatedAt = new Date()

      let nextProducts = products

      const movements: StockMovement[] = []

      for (const item of purchase.items) {
        const result = receiveStock(
          nextProducts,
          item.productId,
          item.quantity,
          purchase.id,
          `Поступление ${purchase.purchaseNumber}`,
        )

        if (!result.success) {
          return {
            success: false,
            message:
              result.message ??
              'Не удалось изменить остаток товара.',
          }
        }

        if (
          !result.product ||
          !result.movement
        ) {
          return {
            success: false,
            message:
              'StockService не вернул обновлённый товар или движение.',
          }
        }

        nextProducts = result.products

        movements.push(result.movement)
      }

      replaceProducts(nextProducts)

      for (const movement of movements) {
        addMovement(movement)
      }

      addTransaction({
        id: crypto.randomUUID(),
        createdAt: updatedAt,
        updatedAt,
        type: 'expense',
        category: 'purchase',
        amount: purchase.totalAmount,
        paymentMethod: purchase.paymentMethod,
        transactionDate: purchase.purchaseDate,
        referenceId: purchase.id,
        description:
          `Поступление ${purchase.purchaseNumber}`,
        status: 'completed',
      })

      setPurchases((currentPurchases) => {
        const nextPurchases =
          currentPurchases.map(
            (currentPurchase) =>
              currentPurchase.id === purchaseId
                ? {
                  ...currentPurchase,
                  status:
                    'completed' as PurchaseStatus,
                  updatedAt,
                }
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