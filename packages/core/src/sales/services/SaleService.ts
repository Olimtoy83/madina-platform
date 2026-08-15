import type { Sale } from '../types/sale'
import type { Product } from '../../inventory/types/product'
import type { StockMovement } from '../../inventory/types/stockMovement'
import type { Transaction } from '../../transactions/types/transaction'
import { issueStock } from '../../inventory/services/StockService'

export interface CompleteSaleResult {
  success: boolean
  message?: string
  sale?: Sale
  products: Product[]
  movements: StockMovement[]
  transaction?: Transaction
}

export function completeSale(
  sale: Sale,
  products: Product[],
): CompleteSaleResult {
  if (sale.status !== 'draft') {
    return {
      success: false,
      message:
        'Можно завершить только черновик продажи.',
      products,
      movements: [],
    }
  }

  for (const item of sale.items) {
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

  for (const item of sale.items) {
    const result = issueStock(
      nextProducts,
      item.productId,
      item.quantity,
      sale.id,
      `Продажа ${sale.saleNumber}`,
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

  const completedSale: Sale = {
    ...sale,
    status: 'completed',
    updatedAt,
  }

  const transaction: Transaction = {
    id: crypto.randomUUID(),
    createdAt: updatedAt,
    updatedAt,
    type: 'income',
    category: 'sale',
    amount: sale.totalAmount,
    paymentMethod: sale.paymentMethod,
    transactionDate: sale.saleDate,
    referenceId: sale.id,
    description:
      `Продажа ${sale.saleNumber}`,
    status: 'completed',
  }

  return {
    success: true,
    products: nextProducts,
    movements,
    sale: completedSale,
    transaction,
  }
}