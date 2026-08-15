import type { Purchase } from '../types/purchase'
import type { Product } from '../../inventory/types/product'
import type { StockMovement } from '../../inventory/types/stockMovement'
import type { Transaction } from '../../transactions/types/transaction'
import { receiveStock } from '../../inventory/services/StockService'

export interface CompletePurchaseResult {
  success: boolean
  message?: string
  purchase?: Purchase
  products: Product[]
  movements: StockMovement[]
  transaction?: Transaction
}

export function completePurchase(
  purchase: Purchase,
  products: Product[],
): CompletePurchaseResult {
  if (purchase.status !== 'draft') {
    return {
      success: false,
      message:
        'Можно завершить только черновик поступления.',
      products,
      movements: [],
    }
  }

  for (const item of purchase.items) {
    const product = products.find(
      (currentProduct) =>
        currentProduct.id === item.productId,
    )

    if (!product) {
      return {
        success: false,
        message:
          `Товар не найден на складе: ${item.productId}.`,
        products,
        movements: [],
      }
    }
  }

  const updatedAt = new Date()

  let nextProducts = products
  const movements: StockMovement[] = []

  for (const item of purchase.items) {
    const result = receiveStock(
      nextProducts,
      item.productId,
      item.quantity,
      purchase.id,
      `Поступление ${purchase.purchaseNumber}`,
    )

    if (!result.success) {
      return {
        success: false,
        message:
          result.message ??
          'Не удалось изменить остаток товара.',
        products,
        movements: [],
      }
    }

    if (!result.product || !result.movement) {
      return {
        success: false,
        message:
          'StockService не вернул обновлённый товар или движение.',
        products,
        movements: [],
      }
    }

    nextProducts = result.products
    movements.push(result.movement)
  }

  const completedPurchase: Purchase = {
    ...purchase,
    status: 'completed',
    updatedAt,
  }

  const transaction: Transaction = {
    id: crypto.randomUUID(),
    createdAt: updatedAt,
    updatedAt,
    type: 'expense',
    category: 'purchase',
    amount: purchase.totalAmount,
    paymentMethod: purchase.paymentMethod,
    transactionDate: purchase.purchaseDate,
    referenceId: purchase.id,
    description:
      `Поступление ${purchase.purchaseNumber}`,
    status: 'completed',
  }

  return {
    success: true,
    products: nextProducts,
    movements,
    purchase: completedPurchase,
    transaction,
  }
}