import {
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import {
  normalizeSale,
  updateSale as updateSaleCore,
  type Sale,
  type SaleStatus,
} from '@madina/core'
import {
  getNextSnapshot,
  TransactionalPersistenceError,
} from '../shared/transactionalStorage'
import { SalesContext } from './SalesContext'
import { useTransactionalState } from './useTransactionalState'
import {
  completeSaleSnapshot,
  createCompletionGuard,
} from '../shared/transactionalCompletion'

interface SalesProviderProps { children: ReactNode }

export function SalesProvider({ children }: SalesProviderProps) {
  const { snapshot, commit, persistenceError } = useTransactionalState()
  const { sales } = snapshot
  const completionGuard = useRef(createCompletionGuard())

  const addSale = useCallback((sale: Sale) => {
    try {
      const normalizedSale = normalizeSale(sale)

      commit(
        getNextSnapshot(snapshot, {
          sales: [...sales, normalizedSale],
        }),
      )

      return {
        success: true,
      }
    } catch (error) {
      if (error instanceof TransactionalPersistenceError) {
        return {
          success: false,
          message: error.message,
        }
      }

      throw error
    }
  }, [commit, sales, snapshot])

  const updateSale = useCallback((saleId: string, updates: Partial<Sale>) => {
    const nextSales = sales.map((sale) => sale.id === saleId
      ? updateSaleCore(sale, updates)
      : sale)
    commit(getNextSnapshot(snapshot, { sales: nextSales }))
  }, [commit, sales, snapshot])

  const completeSale = useCallback((saleId: string) => {
    if (persistenceError) {
      return { success: false, message: persistenceError.message }
    }
    if (!completionGuard.current.begin(saleId)) {
      return { success: false, message: 'Завершение продажи уже выполняется.' }
    }
    try {
      const result = completeSaleSnapshot(snapshot, saleId)
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
      completionGuard.current.finish(saleId)
    }
  }, [commit, persistenceError, snapshot])

  const cancelSale = useCallback((saleId: string) => {
    try {
      const nextSales = sales.map((sale) =>
        sale.id === saleId &&
          sale.status === 'draft'
          ? {
            ...sale,
            status: 'cancelled' as SaleStatus,
            updatedAt: new Date(),
          }
          : sale,
      )

      commit(
        getNextSnapshot(snapshot, {
          sales: nextSales,
        }),
      )

      return {
        success: true,
      }
    } catch (error) {
      if (error instanceof TransactionalPersistenceError) {
        return {
          success: false,
          message: error.message,
        }
      }

      throw error
    }
  }, [commit, sales, snapshot])

  const value = useMemo(() => ({ sales, addSale, updateSale, completeSale, cancelSale }), [sales, addSale, updateSale, completeSale, cancelSale])
  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
}
