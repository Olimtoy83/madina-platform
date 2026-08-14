import {
  useCallback,
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

function hasReference(
  movement: StockMovement,
): boolean {
  return Boolean(movement.referenceId)
}

function isDuplicateMovement(
  movements: StockMovement[],
  movement: StockMovement,
): boolean {
  if (!hasReference(movement)) {
    return false
  }

  return movements.some(
    (currentMovement) =>
      currentMovement.type === movement.type &&
      currentMovement.productId ===
        movement.productId &&
      currentMovement.referenceId ===
        movement.referenceId,
  )
}

export function StockMovementsProvider({
  children,
}: StockMovementsProviderProps) {
  const [movements, setMovements] =
    useState<StockMovement[]>(
      loadMovements,
    )

  const addMovement = useCallback(
    (movement: StockMovement) => {
      setMovements((currentMovements) => {
        if (
          isDuplicateMovement(
            currentMovements,
            movement,
          )
        ) {
          return currentMovements
        }

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
    },
    [],
  )

  const getProductMovements = useCallback(
    (productId: string) =>
      movements.filter(
        (movement) =>
          movement.productId === productId,
      ),
    [movements],
  )

  const getMovementsByType = useCallback(
    (type: StockMovement['type']) =>
      movements.filter(
        (movement) =>
          movement.type === type,
      ),
    [movements],
  )

  const value = useMemo(
    () => ({
      movements,
      addMovement,
      getProductMovements,
      getMovementsByType,
    }),
    [
      movements,
      addMovement,
      getProductMovements,
      getMovementsByType,
    ],
  )

  return (
    <StockMovementsContext.Provider
      value={value}
    >
      {children}
    </StockMovementsContext.Provider>
  )
}
