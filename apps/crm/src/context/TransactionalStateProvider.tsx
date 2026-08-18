import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Alert } from '@madina/ui'
import {
  commitTransactionalSnapshot,
  loadTransactionalSnapshot,
  type TransactionalSnapshot,
} from '../shared/transactionalStorage'
import { TransactionalStateContext } from './TransactionalStateContext'

interface TransactionalStateProviderProps {
  children: ReactNode
}

const emptySnapshot: TransactionalSnapshot = {
  schemaVersion: 2,
  revision: 0,
  products: [],
  sales: [],
  purchases: [],
  stockMovements: [],
  transactions: [],
}

function loadInitialState() {
  try {
    return {
      snapshot: loadTransactionalSnapshot().snapshot,
      persistenceError: null,
    }
  } catch (error) {
    return {
      snapshot: emptySnapshot,
      persistenceError: error instanceof Error ? error : new Error('Не удалось восстановить transactional snapshot.'),
    }
  }
}

export function TransactionalStateProvider({
  children,
}: TransactionalStateProviderProps) {
  const [state, setState] = useState(loadInitialState)

  const commit = useCallback((snapshot: TransactionalSnapshot) => {
    if (state.persistenceError) {
      throw state.persistenceError
    }

    commitTransactionalSnapshot(snapshot)
    setState({ snapshot, persistenceError: null })
  }, [state.persistenceError])

  const value = useMemo(() => ({
    snapshot: state.snapshot,
    persistenceError: state.persistenceError,
    commit,
  }), [state, commit])

  if (state.persistenceError) {
    return (
      <section>
        <Alert variant="danger" title="Ошибка хранилища">
          {state.persistenceError.message}
        </Alert>
      </section>
    )
  }

  return (
    <TransactionalStateContext.Provider value={value}>
      {children}
    </TransactionalStateContext.Provider>
  )
}
