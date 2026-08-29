import type {
  Product,
} from '@madina/core'
import type { CommerceAggregateResponse } from './api/commerceApi'

export interface CommerceAggregateState {
  products: Product[]
}

export interface CommerceMutationResult<T> {
  success: boolean
  value?: T
  message?: string
}

export function toCommerceMutationFailure(
  error: unknown,
): CommerceMutationResult<never> {
  return {
    success: false,
    message: error instanceof Error
      ? error.message
      : 'Не удалось выполнить операцию на сервере.',
  }
}

export function toCommerceAggregateState(
  response: CommerceAggregateResponse,
): CommerceAggregateState {
  return {
    products: response.products.map((product) => ({
      ...product,
      createdAt: new Date(product.createdAt),
      updatedAt: new Date(product.updatedAt),
    })),
  }
}
