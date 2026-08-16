import type { Purchase } from '../types/purchase'

export function getPurchaseItemTotal(
  quantity: number,
  unitCost: number,
): number {
  return quantity * unitCost
}

export function getPurchaseTotal(
  purchase: Pick<Purchase, 'items'>,
): number {
  return purchase.items.reduce(
    (total, item) =>
      total + getPurchaseItemTotal(
        item.quantity,
        item.unitCost,
      ),
    0,
  )
}

export function getNextPurchaseNumber(
  purchases: Purchase[],
): string {
  const lastPurchaseNumber = purchases.reduce(
    (max, purchase) => {
      const number = Number(
        purchase.purchaseNumber.replace('PUR-', ''),
      )

      return Number.isFinite(number)
        ? Math.max(max, number)
        : max
    },
    0,
  )

  return `PUR-${String(
    lastPurchaseNumber + 1,
  ).padStart(4, '0')}`
}
