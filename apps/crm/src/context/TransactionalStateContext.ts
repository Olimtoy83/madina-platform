import { createContext } from 'react'
import type { CommerceAggregateState } from '../shared/commerceState'

export interface TransactionalStateContextValue {
  snapshot: CommerceAggregateState
  isLoading: boolean
  loadError: Error | null
  reload: () => Promise<void>
}

export const TransactionalStateContext =
  createContext<TransactionalStateContextValue | null>(null)
