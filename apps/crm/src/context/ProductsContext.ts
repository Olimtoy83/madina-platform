import { createContext } from 'react'
import type {
  Product,
} from '@madina/core'
import type { CommerceMutationResult } from '../shared/commerceState'

export interface ProductsContextValue {
  products: Product[]

  addProduct: (
    product: Product,
  ) => Promise<CommerceMutationResult<Product>>

  deactivateProduct: (
    productId: string,
  ) => Promise<CommerceMutationResult<Product>>

  updateProduct: (
    productId: string,
    updates: Partial<Product>,
  ) => Promise<CommerceMutationResult<Product>>

  adjustProductStock: (
    productId: string,
    quantity: number,
    note?: string,
  ) => Promise<CommerceMutationResult<Product>>
}

export const ProductsContext =
  createContext<ProductsContextValue | null>(null)
