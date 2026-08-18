import { createContext } from 'react'
import type {
  Product,
  Purchase,
  Sale,
} from '@madina/core'

export interface ProductsContextValue {
  products: Product[]

  addProduct: (product: Product) => void

  deactivateProduct: (
    productId: string,
  ) => Product | undefined

  updateProduct: (
    productId: string,
    updates: Partial<Product>,
    sales: Sale[],
    purchases: Purchase[],
  ) => Product | undefined

  replaceProducts: (
    products: Product[],
  ) => void
}

export const ProductsContext =
  createContext<ProductsContextValue | null>(null)
