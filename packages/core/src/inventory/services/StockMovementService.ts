import type { StockMovement } from '../types/stockMovement'

export interface StockMovementTotals {
  totalPurchases: number
  totalSales: number
}

export function getStockMovementTotals(
  movements: StockMovement[],
): StockMovementTotals {
  return {
    totalPurchases: movements
      .filter(
        (movement) =>
          movement.type === 'purchase',
      )
      .reduce(
        (total, movement) =>
          total + movement.quantity,
        0,
      ),

    totalSales: Math.abs(
      movements
        .filter(
          (movement) =>
            movement.type === 'sale',
        )
        .reduce(
          (total, movement) =>
            total + movement.quantity,
          0,
        ),
    ),
  }
}