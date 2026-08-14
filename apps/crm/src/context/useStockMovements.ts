import { useContext } from 'react'
import { StockMovementsContext } from './StockMovementsContext'

export function useStockMovements() {
  const context = useContext(
    StockMovementsContext,
  )

  if (!context) {
    throw new Error(
      'useStockMovements must be used inside StockMovementsProvider',
    )
  }

  return context
}
