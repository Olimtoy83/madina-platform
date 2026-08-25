import {
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'

import {
  deactivateProduct as deactivateProductCore,
  updateProduct as updateProductCore,
  type Product,
  type Purchase,
  type Sale,
} from '@madina/core'

import {
  getNextSnapshot,
  TransactionalPersistenceError,
} from '../shared/transactionalStorage'

import { ProductsContext } from './ProductsContext'
import { useTransactionalState } from './useTransactionalState'

interface ProductsProviderProps {
  children: ReactNode
}

export function ProductsProvider({ children }: ProductsProviderProps) {
  const { snapshot, commit } = useTransactionalState()
  const { products } = snapshot

  const addProduct = useCallback((product: Product) => {
    try {
      commit(
        getNextSnapshot(snapshot, {
          products: [...products, product],
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
  }, [commit, products, snapshot])

  const deactivateProduct = useCallback((productId: string) => {
    const product = products.find((item) => item.id === productId)

    if (!product) {
      return {
        success: false,
        message: 'Товар не найден.',
      }
    }

    try {
      const deactivatedProduct = deactivateProductCore(product)
      const nextProducts = products.map((item) =>
        item.id === productId ? deactivatedProduct : item,
      )

      commit(
        getNextSnapshot(snapshot, {
          products: nextProducts,
        }),
      )

      return {
        success: true,
        product: deactivatedProduct,
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
  }, [commit, products, snapshot])

  const updateProduct = useCallback((
    productId: string,
    updates: Partial<Product>,
    sales: Sale[],
    purchases: Purchase[],
  ) => {
    const product = products.find((item) => item.id === productId)

    if (!product) {
      return {
        success: false,
        message: 'Товар не найден.',
      }
    }

    try {
      const updatedProduct = updateProductCore(
        product,
        updates,
        sales,
        purchases,
      )

      const nextProducts = products.map((item) =>
        item.id === productId ? updatedProduct : item,
      )

      commit(
        getNextSnapshot(snapshot, {
          products: nextProducts,
        }),
      )

      return {
        success: true,
        product: updatedProduct,
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
  }, [commit, products, snapshot])

  const replaceProducts = useCallback((nextProducts: Product[]) => {
    commit(getNextSnapshot(snapshot, { products: nextProducts }))
  }, [commit, snapshot])

  const value = useMemo(() => ({
    products,
    addProduct,
    deactivateProduct,
    updateProduct,
    replaceProducts,
  }), [products, addProduct, deactivateProduct, updateProduct, replaceProducts])

  return (
    <ProductsContext.Provider value={value}>
      {children}
    </ProductsContext.Provider>
  )
}
