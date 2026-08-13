import { createContext } from 'react'
import type { StockMovement } from '../entities/stockMovement'

export interface StockMovementsContextValue {
  movements: StockMovement[]

  addMovement: (
    movement: StockMovement,
  ) => void

  getProductMovements: (
    productId: string,
  ) => StockMovement[]

  getMovementsByType: (
    type: StockMovement['type'],
  ) => StockMovement[]
}

export const StockMovementsContext =
  createContext<StockMovementsContextValue | null>(null)
