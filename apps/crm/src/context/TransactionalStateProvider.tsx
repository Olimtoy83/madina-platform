import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Alert } from '@madina/ui'
import { getCommerceAggregate } from '../shared/api/commerceApi'
import {
  toCommerceAggregateState,
  type CommerceAggregateState,
} from '../shared/commerceState'
import { TransactionalStateContext } from './TransactionalStateContext'

interface TransactionalStateProviderProps {
  children: ReactNode
}

const emptySnapshot: CommerceAggregateState = {
  products: [],
}

export function TransactionalStateProvider({
  children,
}: TransactionalStateProviderProps) {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const response = await getCommerceAggregate()
      setSnapshot(toCommerceAggregateState(response))
      setLoadError(null)
      setHasLoaded(true)
    } catch (error) {
      setLoadError(error instanceof Error
        ? error
        : new Error('Не удалось загрузить commerce state с сервера.'))
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload().catch(() => {})
  }, [reload])

  const value = useMemo(() => ({
    snapshot,
    isLoading,
    loadError,
    reload,
  }), [
    snapshot,
    isLoading,
    loadError,
    reload,
  ])

  if (isLoading && !hasLoaded) {
    return <section>Загрузка commerce данных…</section>
  }

  if (loadError && !hasLoaded) {
    return (
      <section>
        <Alert variant="danger" title="Ошибка загрузки commerce данных">
          {loadError.message}
        </Alert>
      </section>
    )
  }

  return (
    <TransactionalStateContext.Provider value={value}>
      {loadError && (
        <Alert variant="danger" title="Не удалось обновить commerce данные">
          {loadError.message}
        </Alert>
      )}
      {children}
    </TransactionalStateContext.Provider>
  )
}
