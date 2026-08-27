import { createContext } from 'react'
import type { StockMovement } from '@madina/core'

export interface StockMovementsContextValue {
  movements: StockMovement[]
  getProductMovements: (productId: string) => StockMovement[]
  getMovementsByType: (type: StockMovement['type']) => StockMovement[]
}

export const StockMovementsContext =
  createContext<StockMovementsContextValue | null>(null)
