import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  Sale,
  SaleStatus,
} from '../entities/sale'
import { mockSales } from '../pages/Sales/mockSales'
import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { useProducts } from './useProducts'
import { useStockMovements } from './useStockMovements'
import { issueStock } from '../services/StockService'
import { useTransactions } from './useTransactions'
import { SalesContext } from './SalesContext'

interface SalesProviderProps {
  children: ReactNode
}

type StoredSale = Omit<
  Sale,
  'createdAt' | 'updatedAt' | 'saleDate'
> & {
  createdAt: string
  updatedAt: string
  saleDate: string
}

const STORAGE_KEY = 'sales'

function restoreSale(
  sale: StoredSale,
): Sale {
  return {
    ...sale,
    createdAt: new Date(sale.createdAt),
    updatedAt: new Date(sale.updatedAt),
    saleDate: new Date(sale.saleDate),
  }
}

function loadSales(): Sale[] {
  const storedSales =
    loadStorage<StoredSale[]>(
      STORAGE_KEY,
      [],
    )

  if (storedSales.length === 0) {
    return mockSales
  }

  return storedSales.map(
    restoreSale,
  )
}

export function SalesProvider({
  children,
}: SalesProviderProps) {
  const [sales, setSales] =
    useState<Sale[]>(loadSales)

  const {
    products,
    replaceProducts,
  } = useProducts()

  const { addMovement } =
    useStockMovements()

  const { addTransaction } =
    useTransactions()

  const addSale = useCallback(
    (sale: Sale) => {
      setSales((currentSales) => {
        const nextSales = [
          ...currentSales,
          sale,
        ]

        saveStorage(
          STORAGE_KEY,
          nextSales,
        )

        return nextSales
      })
    },
    [],
  )

  const updateSale = useCallback(
    (
      saleId: string,
      updates: Partial<Sale>,
    ) => {
      setSales((currentSales) => {
        const nextSales =
          currentSales.map(
            (sale) =>
              sale.id === saleId
                ? {
                  ...sale,
                  ...updates,
                  updatedAt: new Date(),
                }
                : sale,
          )

        saveStorage(
          STORAGE_KEY,
          nextSales,
        )

        return nextSales
      })
    },
    [],
  )

  const completeSale = useCallback(
    (saleId: string) => {
      const sale = sales.find(
        (item) => item.id === saleId,
      )

      if (!sale) {
        return {
          success: false,
          message: 'Продажа не найдена.',
        }
      }

      if (sale.status !== 'draft') {
        return {
          success: false,
          message:
            'Можно завершить только черновик продажи.',
        }
      }

      for (const item of sale.items) {
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
      const movements = []

      for (const item of sale.items) {
        const result = issueStock(
          nextProducts,
          item.productId,
          item.quantity,
          sale.id,
          `Продажа ${sale.saleNumber}`,
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
        type: 'income',
        category: 'sale',
        amount: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
        transactionDate: sale.saleDate,
        referenceId: sale.id,
        description:
          `Продажа ${sale.saleNumber}`,
        status: 'completed',
      })

      setSales((currentSales) => {
        const nextSales =
          currentSales.map(
            (currentSale) =>
              currentSale.id === saleId
                ? {
                  ...currentSale,
                  status:
                    'completed' as SaleStatus,
                  updatedAt,
                }
                : currentSale,
          )

        saveStorage(
          STORAGE_KEY,
          nextSales,
        )

        return nextSales
      })

      return {
        success: true,
      }
    },
    [
      sales,
      products,
      replaceProducts,
      addMovement,
      addTransaction,
    ],
  )

  const cancelSale = useCallback(
    (saleId: string) => {
      setSales((currentSales) => {
        const nextSales =
          currentSales.map((sale) =>
            sale.id === saleId &&
              sale.status === 'draft'
              ? {
                ...sale,
                status:
                  'cancelled' as SaleStatus,
                updatedAt: new Date(),
              }
              : sale,
          )

        saveStorage(
          STORAGE_KEY,
          nextSales,
        )

        return nextSales
      })
    },
    [],
  )

  const value = useMemo(
    () => ({
      sales,
      addSale,
      updateSale,
      completeSale,
      cancelSale,
    }),
    [
      sales,
      addSale,
      updateSale,
      completeSale,
      cancelSale,
    ],
  )

  return (
    <SalesContext.Provider value={value}>
      {children}
    </SalesContext.Provider>
  )
}