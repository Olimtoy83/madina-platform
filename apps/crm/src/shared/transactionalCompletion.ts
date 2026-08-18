import {
  completePurchase,
  completeSale,
} from '@madina/core'
import type { TransactionalSnapshot } from './transactionalStorage'
import { getNextSnapshot } from './transactionalStorage'

export interface CompletionResult {
  success: boolean
  message?: string
  snapshot?: TransactionalSnapshot
}

export function completeSaleSnapshot(
  snapshot: TransactionalSnapshot,
  saleId: string,
): CompletionResult {
  const sale = snapshot.sales.find((item) => item.id === saleId)
  if (!sale) return { success: false, message: 'Продажа не найдена.' }

  const result = completeSale(sale, snapshot.products)
  if (!result.success || !result.sale || !result.transaction) {
    return { success: false, message: result.message }
  }

  return {
    success: true,
    snapshot: getNextSnapshot(snapshot, {
      products: result.products,
      sales: snapshot.sales.map((currentSale) =>
        currentSale.id === saleId ? result.sale! : currentSale),
      stockMovements: [...snapshot.stockMovements, ...result.movements],
      transactions: [result.transaction, ...snapshot.transactions],
    }),
  }
}

export function completePurchaseSnapshot(
  snapshot: TransactionalSnapshot,
  purchaseId: string,
): CompletionResult {
  const purchase = snapshot.purchases.find((item) => item.id === purchaseId)
  if (!purchase) return { success: false, message: 'Поступление не найдено.' }

  const result = completePurchase(purchase, snapshot.products)
  if (!result.success || !result.purchase || !result.transaction) {
    return { success: false, message: result.message }
  }

  return {
    success: true,
    snapshot: getNextSnapshot(snapshot, {
      products: result.products,
      purchases: snapshot.purchases.map((currentPurchase) =>
        currentPurchase.id === purchaseId ? result.purchase! : currentPurchase),
      stockMovements: [...snapshot.stockMovements, ...result.movements],
      transactions: [result.transaction, ...snapshot.transactions],
    }),
  }
}

export function createCompletionGuard() {
  const inFlightIds = new Set<string>()

  return {
    begin(id: string): boolean {
      if (inFlightIds.has(id)) return false
      inFlightIds.add(id)
      return true
    },
    finish(id: string): void {
      inFlightIds.delete(id)
    },
  }
}
