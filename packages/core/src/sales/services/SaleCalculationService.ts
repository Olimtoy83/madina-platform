import type { SaleItem } from '../types/sale'

export function getSaleItemTotal(
  quantity: number,
  unitPrice: number,
): number {
  return quantity * unitPrice
}

export function getSaleItemsTotal(
  items: SaleItem[],
): number {
  return items.reduce(
    (total, item) =>
      total + item.totalAmount,
    0,
  )
}