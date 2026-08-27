import { useCallback, useMemo, type ReactNode } from 'react'
import type { StockMovement } from '@madina/core'
import { StockMovementsContext } from './StockMovementsContext'
import { useTransactionalState } from './useTransactionalState'

interface StockMovementsProviderProps { children: ReactNode }

export function StockMovementsProvider({ children }: StockMovementsProviderProps) {
  const { snapshot } = useTransactionalState()
  const movements = snapshot.stockMovements

  const getProductMovements = useCallback((productId: string) =>
    movements.filter((movement) => movement.productId === productId), [movements])
  const getMovementsByType = useCallback((type: StockMovement['type']) =>
    movements.filter((movement) => movement.type === type), [movements])

  const value = useMemo(() => ({
    movements,
    getProductMovements,
    getMovementsByType,
  }), [movements, getProductMovements, getMovementsByType])

  return <StockMovementsContext.Provider value={value}>{children}</StockMovementsContext.Provider>
}
