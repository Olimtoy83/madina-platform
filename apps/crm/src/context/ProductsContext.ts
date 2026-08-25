import { createContext } from 'react'
import type {
  Product,
  Purchase,
  Sale,
} from '@madina/core'

export interface ProductsContextValue {
  products: Product[]

  addProduct: (
    product: Product,
  ) => {
    success: boolean
    message?: string
  }

  deactivateProduct: (
    productId: string,
  ) => {
    success: boolean
    product?: Product
    message?: string
  }

  updateProduct: (
    productId: string,
    updates: Partial<Product>,
    sales: Sale[],
    purchases: Purchase[],
  ) => {
    success: boolean
    product?: Product
    message?: string
  }

  replaceProducts: (
    products: Product[],
  ) => void
}

export const ProductsContext =
  createContext<ProductsContextValue | null>(null)
