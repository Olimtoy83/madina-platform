import {
  useMemo,
  useState,
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
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { ProductsContext } from './ProductsContext'

interface ProductsProviderProps {
  children: ReactNode
}

type StoredProduct = Omit<
  Product,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'products'

function restoreProduct(
  product: StoredProduct,
): Product {
  return {
    ...product,
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
  }
}

function loadProducts(): Product[] {
  const storedProducts =
    loadStorage<StoredProduct[]>(
      STORAGE_KEY,
      [],
    )

  return storedProducts.map(
    restoreProduct,
  )
}

export function ProductsProvider({
  children,
}: ProductsProviderProps) {
  const [products, setProducts] =
    useState<Product[]>(loadProducts)

  function addProduct(product: Product) {
    setProducts((currentProducts) => {
      const nextProducts = [
        ...currentProducts,
        product,
      ]

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
  }

  function deactivateProduct(productId: string) {
    const product = products.find(
      (currentProduct) =>
        currentProduct.id === productId,
    )

    if (!product) {
      return undefined
    }

    const deactivatedProduct =
      deactivateProductCore(product)

    const nextProducts = products.map(
      (currentProduct) =>
        currentProduct.id === productId
          ? deactivatedProduct
          : currentProduct,
    )

    setProducts(nextProducts)
    saveStorage(STORAGE_KEY, nextProducts)

    return deactivatedProduct
  }

  function updateProduct(
    productId: string,
    updates: Partial<Product>,
    sales: Sale[],
    purchases: Purchase[],
  ) {
    const product = products.find(
      (currentProduct) =>
        currentProduct.id === productId,
    )

    if (!product) {
      return undefined
    }

    const updatedProduct = updateProductCore(
      product,
      updates,
      sales,
      purchases,
    )

    const nextProducts = products.map(
      (currentProduct) =>
        currentProduct.id === productId
          ? updatedProduct
          : currentProduct,
    )

    setProducts(nextProducts)
    saveStorage(STORAGE_KEY, nextProducts)

    return updatedProduct
  }

  function replaceProducts(
    nextProducts: Product[],
  ) {
    setProducts(nextProducts)

    saveStorage(
      STORAGE_KEY,
      nextProducts,
    )
  }

  const value = useMemo(
    () => ({
      products,
      addProduct,
      deactivateProduct,
      updateProduct,
      replaceProducts,
    }),
    [products],
  )

  return (
    <ProductsContext.Provider value={value}>
      {children}
    </ProductsContext.Provider>
  )
}
