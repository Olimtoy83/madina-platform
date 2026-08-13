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

  return storedSales.map(restoreSale)
}

export function SalesProvider({
  children,
}: SalesProviderProps) {
  const [sales, setSales] =
    useState<Sale[]>(loadSales)

  const { products, decreaseProductQuantity } =
    useProducts()

  const { addMovement } =
    useStockMovements()

  const { addTransaction } =
    useTransactions()

  function addSale(sale: Sale) {
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
  }

  function updateSale(
    saleId: string,
    updates: Partial<Sale>,
  ) {
    setSales((currentSales) => {
      const nextSales =
        currentSales.map((sale) =>
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
  }

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
          (itemProduct) =>
            itemProduct.id === item.productId,
        )

        if (!product) {
          return {
            success: false,
            message:
              `Товар не найден на складе: ${item.productId}.`,
          }
        }

        if (
          product.quantity <
          item.quantity
        ) {
          return {
            success: false,
            message:
              `Недостаточно товара "${product.name}". ` +
              `Доступно: ${product.quantity} ${product.unit}, ` +
              `требуется: ${item.quantity} ${item.unit}.`,
          }
        }
      }

      for (const item of sale.items) {
        decreaseProductQuantity(
          item.productId,
          item.quantity,
        )
      }

      for (const item of sale.items) {
        addMovement({
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          productId: item.productId,
          type: 'sale',
          quantity: item.quantity,
          unit: item.unit,
          referenceId: sale.id,
          note: `Продажа ${sale.saleNumber}`,
        })
      }

      addTransaction({
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        type: 'income',
        category: 'sale',
        amount: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
        transactionDate: sale.saleDate,
        referenceId: sale.id,
        description: `Продажа ${sale.saleNumber}`,
        status: 'completed',
      })

      setSales((currentSales) => {
        const nextSales =
          currentSales.map(
            (currentSale) =>
              currentSale.id === saleId
                ? {
                  ...currentSale,
                  status: 'completed' as SaleStatus,
                  updatedAt: new Date(),
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
      decreaseProductQuantity,
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
                status: 'cancelled' as SaleStatus,
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
      completeSale,
      cancelSale,
    ],
  )

  return (
    <SalesContext.Provider
      value={value}
    >
      {children}
    </SalesContext.Provider>
  )
}
