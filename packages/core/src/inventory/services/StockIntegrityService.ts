import type { Product } from '../types/product'
import type { StockMovement } from '../types/stockMovement'

export const STOCK_INTEGRITY_EPSILON = 1e-9

export interface StockIntegrityDiscrepancy {
  productId: string
  productName: string
  actualQuantity: number
  calculatedQuantity: number
  difference: number
}

export function getStockIntegrityDiscrepancies(
  products: Product[],
  movements: StockMovement[],
  epsilon = STOCK_INTEGRITY_EPSILON,
): StockIntegrityDiscrepancy[] {
  const calculatedByProduct = new Map<
    string,
    number
  >()

  for (const movement of movements) {
    calculatedByProduct.set(
      movement.productId,
      (calculatedByProduct.get(
        movement.productId,
      ) ?? 0) + movement.quantity,
    )
  }

  return products.flatMap((product) => {
    const calculatedQuantity =
      calculatedByProduct.get(product.id) ?? 0

    const difference =
      product.quantity - calculatedQuantity

    if (Math.abs(difference) <= epsilon) {
      return []
    }

    return [
      {
        productId: product.id,
        productName: product.name,
        actualQuantity: product.quantity,
        calculatedQuantity,
        difference,
      },
    ]
  })
}
