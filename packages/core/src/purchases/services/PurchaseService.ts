import type { Purchase } from '../types/purchase'
import type { Product } from '../../inventory/types/product'
import type { StockMovement } from '../../inventory/types/stockMovement'
import type { Transaction } from '../../transactions/types/transaction'
import { receiveStock } from '../../inventory/services/StockService'
import {
  getPurchaseItemTotal,
  getPurchaseTotal,
} from './PurchaseCalculationService'

export interface CompletePurchaseResult {
  success: boolean
  message?: string
  purchase?: Purchase
  products: Product[]
  movements: StockMovement[]
  transaction?: Transaction
}

export class PurchaseValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PurchaseValidationError'
  }
}

const restrictedPurchaseUpdateFields: (keyof Purchase)[] = [
  'id',
  'purchaseNumber',
  'createdAt',
  'updatedAt',
  'status',
  'totalAmount',
]

export function updatePurchase(
  purchase: Purchase,
  updates: Partial<Purchase>,
): Purchase {
  if (purchase.status !== 'draft') {
    throw new PurchaseValidationError(
      'Нельзя изменять завершённое или отменённое поступление.',
    )
  }

  const restrictedField =
    restrictedPurchaseUpdateFields.find((field) =>
      Object.hasOwn(updates, field),
    )

  if (restrictedField) {
    throw new PurchaseValidationError(
      `Нельзя напрямую изменять поле поступления: ${restrictedField}.`,
    )
  }

  return normalizePurchase({
    ...purchase,
    ...updates,
    updatedAt: new Date(),
  })
}

export function normalizePurchase(
  purchase: Purchase,
): Purchase {
  const itemsByProduct = new Map<
    string,
    Purchase['items'][number]
  >()

  for (const item of purchase.items) {
    validatePurchaseItem(item)

    const existingItem = itemsByProduct.get(
      item.productId,
    )

    if (!existingItem) {
      itemsByProduct.set(item.productId, {
        ...item,
        totalCost: getPurchaseItemTotal(
          item.quantity,
          item.unitCost,
        ),
      })
      continue
    }

    if (existingItem.unitCost !== item.unitCost) {
      throw new PurchaseValidationError(
        'Нельзя объединить позиции поступления с разной ценой закупки.',
      )
    }

    if (existingItem.unit !== item.unit) {
      throw new PurchaseValidationError(
        'Нельзя объединить позиции поступления с разными единицами измерения.',
      )
    }

    const quantity =
      existingItem.quantity + item.quantity

    itemsByProduct.set(item.productId, {
      ...existingItem,
      quantity,
      totalCost: getPurchaseItemTotal(
        quantity,
        existingItem.unitCost,
      ),
    })
  }

  const items = [
    ...itemsByProduct.values(),
  ]

  return {
    ...purchase,
    items,
    totalAmount: getPurchaseTotal({ items }),
  }
}

function validatePurchaseItem(
  item: Purchase['items'][number],
) {
  if (
    !Number.isFinite(item.quantity) ||
    item.quantity <= 0
  ) {
    throw new PurchaseValidationError(
      'Количество позиции поступления должно быть конечным числом больше нуля.',
    )
  }

  if (
    !Number.isFinite(item.unitCost) ||
    item.unitCost <= 0
  ) {
    throw new PurchaseValidationError(
      'Цена закупки позиции поступления должна быть конечным числом больше нуля.',
    )
  }
}

export function completePurchase(
  purchase: Purchase,
  products: Product[],
): CompletePurchaseResult {
  const normalizedPurchase = normalizePurchase(
    purchase,
  )

  if (normalizedPurchase.status !== 'draft') {
    return {
      success: false,
      message:
        'Можно завершить только черновик поступления.',
      products,
      movements: [],
    }
  }

  if (normalizedPurchase.items.length === 0) {
    return {
      success: false,
      message:
        'Нельзя завершить поступление без товаров.',
      products,
      movements: [],
    }
  }

  for (const item of normalizedPurchase.items) {
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

    if (item.unit !== product.unit) {
      throw new PurchaseValidationError(
        'Единица измерения позиции поступления должна совпадать с единицей товара.',
      )
    }
  }

  const updatedAt = new Date()

  let nextProducts = products
  const movements: StockMovement[] = []

  for (const item of normalizedPurchase.items) {
    const result = receiveStock(
      nextProducts,
      item.productId,
      item.quantity,
      normalizedPurchase.id,
      `Поступление ${normalizedPurchase.purchaseNumber}`,
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
    ...normalizedPurchase,
    status: 'completed',
    updatedAt,
  }

  const transaction: Transaction = {
    id: crypto.randomUUID(),
    createdAt: updatedAt,
    updatedAt,
    type: 'expense',
    category: 'purchase',
    amount: normalizedPurchase.totalAmount,
    paymentMethod: normalizedPurchase.paymentMethod,
    transactionDate: normalizedPurchase.purchaseDate,
    referenceId: normalizedPurchase.id,
    description:
      `Поступление ${normalizedPurchase.purchaseNumber}`,
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
