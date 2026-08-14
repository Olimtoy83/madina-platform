import { createContext } from 'react'
import type { Product } from '@madina/core'

export interface ProductsContextValue {
  products: Product[]

  addProduct: (product: Product) => void

  removeProduct: (productId: string) => void

  updateProduct: (
    productId: string,
    updates: Partial<Product>,
  ) => void

  updateProductQuantity: (
    productId: string,
    quantity: number,
  ) => void

  increaseProductQuantity: (
    productId: string,
    quantity: number,
  ) => void

  decreaseProductQuantity: (
    productId: string,
    quantity: number,
  ) => void

  replaceProducts: (
    products: Product[],
  ) => void
}

export const ProductsContext =
  createContext<ProductsContextValue | null>(null)
