import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  completeSale as completeSaleCore,
  normalizeSale,
  type Sale,
  type SaleStatus,
} from '@madina/core'

import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { useProducts } from './useProducts'
import { useStockMovements } from './useStockMovements'
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
      const normalizedSale = normalizeSale(sale)

      setSales((currentSales) => {
        const nextSales = [
          ...currentSales,
          normalizedSale,
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

      const result = completeSaleCore(
        sale,
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

      setSales((currentSales) => {
        const nextSales =
          currentSales.map(
            (currentSale) =>
              currentSale.id === saleId
                ? result.sale!
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
