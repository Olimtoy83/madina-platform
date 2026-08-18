import { useCallback, useMemo, type ReactNode } from 'react'
import type { StockMovement } from '@madina/core'
import { getNextSnapshot } from '../shared/transactionalStorage'
import { StockMovementsContext } from './StockMovementsContext'
import { useTransactionalState } from './useTransactionalState'

interface StockMovementsProviderProps { children: ReactNode }

function isDuplicateMovement(movements: StockMovement[], movement: StockMovement) {
  return Boolean(movement.referenceId) && movements.some((currentMovement) =>
    currentMovement.type === movement.type &&
    currentMovement.productId === movement.productId &&
    currentMovement.referenceId === movement.referenceId,
  )
}

export function StockMovementsProvider({ children }: StockMovementsProviderProps) {
  const { snapshot, commit } = useTransactionalState()
  const movements = snapshot.stockMovements

  const addMovement = useCallback((movement: StockMovement) => {
    if (isDuplicateMovement(movements, movement)) return
    commit(getNextSnapshot(snapshot, {
      stockMovements: [...movements, movement],
    }))
  }, [commit, movements, snapshot])

  const getProductMovements = useCallback((productId: string) =>
    movements.filter((movement) => movement.productId === productId), [movements])
  const getMovementsByType = useCallback((type: StockMovement['type']) =>
    movements.filter((movement) => movement.type === type), [movements])

  const value = useMemo(() => ({
    movements, addMovement, getProductMovements, getMovementsByType,
  }), [movements, addMovement, getProductMovements, getMovementsByType])

  return <StockMovementsContext.Provider value={value}>{children}</StockMovementsContext.Provider>
}
