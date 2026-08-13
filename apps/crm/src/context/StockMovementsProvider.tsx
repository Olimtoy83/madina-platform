import {
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { StockMovement } from '../entities/stockMovement'
import {
  loadStorage,
  saveStorage,
} from '../shared/storage'
import { StockMovementsContext } from './StockMovementsContext'

interface StockMovementsProviderProps {
  children: ReactNode
}

type StoredStockMovement = Omit<
  StockMovement,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'stock-movements'

function restoreMovement(
  movement: StoredStockMovement,
): StockMovement {
  return {
    ...movement,
    createdAt: new Date(movement.createdAt),
    updatedAt: new Date(movement.updatedAt),
  }
}

function loadMovements(): StockMovement[] {
  const storedMovements =
    loadStorage<StoredStockMovement[]>(
      STORAGE_KEY,
      [],
    )

  return storedMovements.map(
    restoreMovement,
  )
}

export function StockMovementsProvider({
  children,
}: StockMovementsProviderProps) {
  const [movements, setMovements] =
    useState<StockMovement[]>(
      loadMovements,
    )

  function addMovement(
    movement: StockMovement,
  ) {
    setMovements((currentMovements) => {
      const nextMovements = [
        ...currentMovements,
        movement,
      ]

      saveStorage(
        STORAGE_KEY,
        nextMovements,
      )

      return nextMovements
    })
  }

  function getProductMovements(
    productId: string,
  ) {
    return movements.filter(
      (movement) =>
        movement.productId === productId,
    )
  }

  function getMovementsByType(
    type: StockMovement['type'],
  ) {
    return movements.filter(
      (movement) =>
        movement.type === type,
    )
  }

  const value = useMemo(
    () => ({
      movements,
      addMovement,
      getProductMovements,
      getMovementsByType,
    }),
    [movements],
  )

  return (
    <StockMovementsContext.Provider
      value={value}
    >
      {children}
    </StockMovementsContext.Provider>
  )
}
