import {
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Product } from '@madina/core'

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

  function removeProduct(productId: string) {
    setProducts((currentProducts) => {
      const nextProducts =
        currentProducts.filter(
          (product) =>
            product.id !== productId,
        )

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
  }

  function updateProduct(
    productId: string,
    updates: Partial<Product>,
  ) {
    setProducts((currentProducts) => {
      const nextProducts =
        currentProducts.map((product) =>
          product.id === productId
            ? {
              ...product,
              ...updates,
              updatedAt: new Date(),
            }
            : product,
        )

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
  }

  function updateProductQuantity(
    productId: string,
    quantity: number,
  ) {
    setProducts((currentProducts) => {
      const nextProducts =
        currentProducts.map((product) =>
          product.id === productId
            ? {
              ...product,
              quantity,
              updatedAt: new Date(),
            }
            : product,
        )

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
  }

  function increaseProductQuantity(
    productId: string,
    quantity: number,
  ) {
    if (quantity <= 0) {
      return
    }

    setProducts((currentProducts) => {
      const nextProducts =
        currentProducts.map((product) =>
          product.id === productId
            ? {
              ...product,
              quantity:
                product.quantity + quantity,
              updatedAt: new Date(),
            }
            : product,
        )

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
  }

  function decreaseProductQuantity(
    productId: string,
    quantity: number,
  ) {
    if (quantity <= 0) {
      return
    }

    setProducts((currentProducts) => {
      const nextProducts =
        currentProducts.map((product) => {
          if (product.id !== productId) {
            return product
          }

          const newQuantity =
            product.quantity - quantity

          if (newQuantity < 0) {
            return product
          }

          return {
            ...product,
            quantity: newQuantity,
            updatedAt: new Date(),
          }
        })

      saveStorage(
        STORAGE_KEY,
        nextProducts,
      )

      return nextProducts
    })
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
      removeProduct,
      updateProduct,
      updateProductQuantity,
      increaseProductQuantity,
      decreaseProductQuantity,
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
