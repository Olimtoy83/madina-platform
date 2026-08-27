import type {
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'
import type { CommerceAggregateResponse } from './api/commerceApi'

export interface CommerceAggregateState {
  products: Product[]
  stockMovements: StockMovement[]
  purchases: Purchase[]
  sales: Sale[]
  transactions: Transaction[]
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
    stockMovements: response.stockMovements.map((movement) => ({
      ...movement,
      createdAt: new Date(movement.createdAt),
      updatedAt: new Date(movement.updatedAt),
    })),
    purchases: response.purchases.map((purchase) => ({
      ...purchase,
      createdAt: new Date(purchase.createdAt),
      updatedAt: new Date(purchase.updatedAt),
      purchaseDate: new Date(purchase.purchaseDate),
    })),
    sales: response.sales.map((sale) => ({
      ...sale,
      createdAt: new Date(sale.createdAt),
      updatedAt: new Date(sale.updatedAt),
      saleDate: new Date(sale.saleDate),
    })),
    transactions: response.transactions.map((transaction) => ({
      ...transaction,
      createdAt: new Date(transaction.createdAt),
      updatedAt: new Date(transaction.updatedAt),
      transactionDate: new Date(transaction.transactionDate),
    })),
  }
}
