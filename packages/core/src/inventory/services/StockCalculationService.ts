import type { Product } from '../types/product'

export function getTotalStockQuantity(
  products: Product[],
): number {
  return products.reduce(
    (total, product) =>
      total + product.quantity,
    0,
  )
}
