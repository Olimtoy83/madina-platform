import type { SaleItem } from '../types/sale'

export function getSaleItemsTotal(
  items: SaleItem[],
): number {
  return items.reduce(
    (total, item) =>
      total + item.totalAmount,
    0,
  )
}
