import { createContext } from 'react'
import type { TransactionalSnapshot } from '../shared/transactionalStorage'

export interface TransactionalStateContextValue {
  snapshot: TransactionalSnapshot
  persistenceError: Error | null
  commit: (snapshot: TransactionalSnapshot) => void
  commitUpdate: (
    updater: TransactionalSnapshotUpdater,
  ) => void
}

export const TransactionalStateContext =
  createContext<TransactionalStateContextValue | null>(null)

export type TransactionalSnapshotUpdater = (
  snapshot: TransactionalSnapshot,
) => TransactionalSnapshot