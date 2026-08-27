import {
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import type { Product } from '@madina/core'
import {
  adjustProductStock as adjustProductStockApi,
  createProduct as createProductApi,
  deactivateProduct as deactivateProductApi,
  updateProduct as updateProductApi,
} from '../shared/api/commerceApi'
import {
  toCommerceMutationFailure,
  type CommerceMutationResult,
} from '../shared/commerceState'
import { ProductsContext } from './ProductsContext'
import { useTransactionalState } from './useTransactionalState'

interface ProductsProviderProps {
  children: ReactNode
}

export function ProductsProvider({ children }: ProductsProviderProps) {
  const { snapshot, reload } = useTransactionalState()
  const { products } = snapshot

  const addProduct = useCallback(async (
    product: Product,
  ): Promise<CommerceMutationResult<Product>> => {
    try {
      const savedProduct = await createProductApi({
        name: product.name,
        category: product.category,
        unit: product.unit,
        costPrice: product.costPrice,
        salePrice: product.salePrice,
        status: product.status,
        initialQuantity: product.quantity,
      })
      await reload()

      return {
        success: true,
        value: {
          ...savedProduct,
          createdAt: new Date(savedProduct.createdAt),
          updatedAt: new Date(savedProduct.updatedAt),
        },
      }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const deactivateProduct = useCallback(async (
    productId: string,
  ): Promise<CommerceMutationResult<Product>> => {
    try {
      const savedProduct = await deactivateProductApi(productId)
      await reload()

      return {
        success: true,
        value: {
          ...savedProduct,
          createdAt: new Date(savedProduct.createdAt),
          updatedAt: new Date(savedProduct.updatedAt),
        },
      }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const updateProduct = useCallback(async (
    productId: string,
    updates: Partial<Product>,
  ): Promise<CommerceMutationResult<Product>> => {
    try {
      const savedProduct = await updateProductApi(productId, {
        name: updates.name,
        category: updates.category,
        unit: updates.unit,
        costPrice: updates.costPrice,
        salePrice: updates.salePrice,
        status: updates.status,
      })
      await reload()

      return {
        success: true,
        value: {
          ...savedProduct,
          createdAt: new Date(savedProduct.createdAt),
          updatedAt: new Date(savedProduct.updatedAt),
        },
      }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const adjustProductStock = useCallback(async (
    productId: string,
    quantity: number,
    note?: string,
  ): Promise<CommerceMutationResult<Product>> => {
    try {
      const result = await adjustProductStockApi(productId, { quantity, note })
      await reload()
      return {
        success: true,
        value: {
          ...result.product,
          createdAt: new Date(result.product.createdAt),
          updatedAt: new Date(result.product.updatedAt),
        },
      }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const value = useMemo(() => ({
    products,
    addProduct,
    deactivateProduct,
    updateProduct,
    adjustProductStock,
  }), [products, addProduct, deactivateProduct, updateProduct, adjustProductStock])

  return (
    <ProductsContext.Provider value={value}>
      {children}
    </ProductsContext.Provider>
  )
}
