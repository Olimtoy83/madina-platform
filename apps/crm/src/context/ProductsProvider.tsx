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
import { getNextSnapshot } from '../shared/transactionalStorage'
import { ProductsContext } from './ProductsContext'
import { useTransactionalState } from './useTransactionalState'

interface ProductsProviderProps {
  children: ReactNode
}

export function ProductsProvider({ children }: ProductsProviderProps) {
  const { snapshot, commit } = useTransactionalState()
  const { products } = snapshot

  const addProduct = useCallback((product: Product) => {
    commit(getNextSnapshot(snapshot, { products: [...products, product] }))
  }, [commit, products, snapshot])

  const deactivateProduct = useCallback((productId: string) => {
    const product = products.find((item) => item.id === productId)
    if (!product) return undefined

    const deactivatedProduct = deactivateProductCore(product)
    const nextProducts = products.map((item) =>
      item.id === productId ? deactivatedProduct : item,
    )
    commit(getNextSnapshot(snapshot, { products: nextProducts }))
    return deactivatedProduct
  }, [commit, products, snapshot])

  const updateProduct = useCallback((
    productId: string,
    updates: Partial<Product>,
    sales: Sale[],
    purchases: Purchase[],
  ) => {
    const product = products.find((item) => item.id === productId)
    if (!product) return undefined

    const updatedProduct = updateProductCore(product, updates, sales, purchases)
    const nextProducts = products.map((item) =>
      item.id === productId ? updatedProduct : item,
    )
    commit(getNextSnapshot(snapshot, { products: nextProducts }))
    return updatedProduct
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
