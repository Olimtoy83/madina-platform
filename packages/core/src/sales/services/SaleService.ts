import type { Sale } from '../types/sale'
import type { Product } from '../../inventory/types/product'
import type { StockMovement } from '../../inventory/types/stockMovement'
import type { Transaction } from '../../transactions/types/transaction'
import { issueStock } from '../../inventory/services/StockService'
import {
  getSaleItemTotal,
  getSaleItemsTotal,
} from './SaleCalculationService'

export interface CompleteSaleResult {
  success: boolean
  message?: string
  sale?: Sale
  products: Product[]
  movements: StockMovement[]
  transaction?: Transaction
}

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleValidationError'
  }
}

export function normalizeSale(
  sale: Sale,
): Sale {
  const itemsByProduct = new Map<
    string,
    Sale['items'][number]
  >()

  for (const item of sale.items) {
    const existingItem = itemsByProduct.get(
      item.productId,
    )

    if (!existingItem) {
      itemsByProduct.set(item.productId, {
        ...item,
        totalAmount: getSaleItemTotal(
          item.quantity,
          item.unitPrice,
        ),
      })
      continue
    }

    if (existingItem.unitPrice !== item.unitPrice) {
      throw new SaleValidationError(
        'Нельзя объединить позиции продажи с разной ценой.',
      )
    }

    const quantity =
      existingItem.quantity + item.quantity

    itemsByProduct.set(item.productId, {
      ...existingItem,
      quantity,
      totalAmount: getSaleItemTotal(
        quantity,
        existingItem.unitPrice,
      ),
    })
  }

  const items = [
    ...itemsByProduct.values(),
  ]

  return {
    ...sale,
    items,
    totalAmount: getSaleItemsTotal(items),
  }
}

export function getCompletedSales(
  sales: Sale[],
): Sale[] {
  return sales.filter(
    (sale) => sale.status === 'completed',
  )
}

export interface SaleStats {
  totalCount: number
  draftCount: number
  completedCount: number
  totalAmount: number
}

export function getSaleStats(
  sales: Sale[],
): SaleStats {
  return {
    totalCount: sales.length,
    draftCount: sales.filter(
      (sale) => sale.status === 'draft',
    ).length,
    completedCount: sales.filter(
      (sale) => sale.status === 'completed',
    ).length,
    totalAmount: sales.reduce(
      (sum, sale) =>
        sum + sale.totalAmount,
      0,
    ),
  }
}

export function completeSale(
  sale: Sale,
  products: Product[],
): CompleteSaleResult {
  const normalizedSale = normalizeSale(sale)

  if (normalizedSale.status !== 'draft') {
    return {
      success: false,
      message:
        'Можно завершить только черновик продажи.',
      products,
      movements: [],
    }
  }

  if (normalizedSale.items.length === 0) {
    return {
      success: false,
      message:
        'Нельзя завершить продажу без товаров.',
      products,
      movements: [],
    }
  }

  for (const item of normalizedSale.items) {
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

  for (const item of normalizedSale.items) {
    const result = issueStock(
      nextProducts,
      item.productId,
      item.quantity,
      normalizedSale.id,
      `Продажа ${normalizedSale.saleNumber}`,
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
    ...normalizedSale,
    status: 'completed',
    updatedAt,
  }

  const transaction: Transaction = {
    id: crypto.randomUUID(),
    createdAt: updatedAt,
    updatedAt,
    type: 'income',
    category: 'sale',
    amount: normalizedSale.totalAmount,
    paymentMethod: normalizedSale.paymentMethod,
    transactionDate: normalizedSale.saleDate,
    referenceId: normalizedSale.id,
    description:
      `Продажа ${normalizedSale.saleNumber}`,
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
