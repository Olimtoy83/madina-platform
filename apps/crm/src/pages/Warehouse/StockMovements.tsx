import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type { StockMovement } from '@madina/core'
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import { useProducts } from '../../context/useProducts'
import { useTransactionalState } from '../../context/useTransactionalState'
import {
  getStockMovementHistory,
  type StockMovementHistory,
} from '../../shared/api/commerceApi'
import { HttpError } from '../../shared/api/httpClient'

import './StockMovements.css'

type MovementFilter =
  | 'all'
  | 'purchase'
  | 'sale'
  | 'adjustment'

const movementTypeLabels: Record<MovementFilter, string> = {
  all: 'Все',
  purchase: 'Приход',
  sale: 'Продажа',
  adjustment: 'Корректировка',
}

const unitLabels: Record<string, string> = {
  kg: 'кг',
  piece: 'шт.',
  liter: 'л',
  box: 'кор.',
}

function getHistoryErrorMessage(error: unknown): string {
  if (error instanceof HttpError && error.status === 403) {
    return 'История движений склада недоступна для вашей роли.'
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить историю движений. Повторите попытку.'
}

export function StockMovements() {
  const { products } = useProducts()
  const { snapshot } = useTransactionalState()
  const [typeFilter, setTypeFilter] = useState<MovementFilter>('all')
  const [productFilter, setProductFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [summary, setSummary] = useState<
    StockMovementHistory['summary'] | null
  >(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    const query = getHistoryQuery(
      typeFilter,
      productFilter,
      dateFrom,
      dateTo,
    )

    setMovements([])
    setSummary(null)
    setNextCursor(undefined)
    setIsInitialLoading(true)
    setInitialError(null)
    setLoadMoreError(null)

    void getStockMovementHistory(query)
      .then((response) => {
        if (requestGeneration.current !== generation) return

        setSummary(response.summary)
        setMovements(response.stockMovements.items)
        setNextCursor(response.stockMovements.nextCursor)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return

        setInitialError(getHistoryErrorMessage(error))
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsInitialLoading(false)
        }
      })
  }, [snapshot, typeFilter, productFilter, dateFrom, dateTo])

  async function loadMore(): Promise<void> {
    if (!nextCursor || isInitialLoading || isLoadingMore) return

    const generation = requestGeneration.current
    const cursor = nextCursor
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await getStockMovementHistory({
        ...getHistoryQuery(
          typeFilter,
          productFilter,
          dateFrom,
          dateTo,
        ),
        cursor,
      })

      if (requestGeneration.current !== generation) return

      setSummary(response.summary)
      setMovements((current) => [
        ...current,
        ...response.stockMovements.items,
      ])
      setNextCursor(response.stockMovements.nextCursor)
    } catch (error) {
      if (requestGeneration.current !== generation) return

      setLoadMoreError(getHistoryErrorMessage(error))
    } finally {
      if (requestGeneration.current === generation) {
        setIsLoadingMore(false)
      }
    }
  }

  function getMovementType(type: StockMovement['type']) {
    return movementTypeLabels[type]
  }

  function getUnitLabel(unit: string) {
    return unitLabels[unit] ?? unit
  }

  return (
    <section className="stock-movements">
      <div className="stock-movements__header">
        <div>
          <h1>Движение склада</h1>
          <p>История поступлений, продаж и корректировок товаров.</p>
        </div>
      </div>

      {initialError && (
        <Alert variant="danger" title="Не удалось загрузить историю движений">
          {initialError}
        </Alert>
      )}

      <div className="stock-movements__summary">
        <Card className="stock-movements__summary-card">
          <span>Всего движений</span>
          <strong>{summary?.totalMovements ?? '—'}</strong>
        </Card>
        <Card className="stock-movements__summary-card stock-movements__summary-card--income">
          <span>Приход</span>
          <strong>{summary?.totalPurchases ?? '—'}</strong>
        </Card>
        <Card className="stock-movements__summary-card stock-movements__summary-card--expense">
          <span>Расход</span>
          <strong>{summary?.totalSales ?? '—'}</strong>
        </Card>
      </div>

      <div className="stock-movements__filters">
        <div className="stock-movements__filter">
          <label htmlFor="movement-type">Тип движения</label>
          <Select fullWidth id="movement-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as MovementFilter)}>
            {(Object.entries(movementTypeLabels) as [MovementFilter, string][]).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </div>
        <div className="stock-movements__filter">
          <label htmlFor="movement-product">Товар</label>
          <Select fullWidth id="movement-product" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
            <option value="all">Все товары</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </Select>
        </div>
        <div className="stock-movements__filter">
          <label htmlFor="movement-date-from">Дата от</label>
          <Input fullWidth id="movement-date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </div>
        <div className="stock-movements__filter">
          <label htmlFor="movement-date-to">Дата до</label>
          <Input fullWidth id="movement-date-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
      </div>

      <Card className="stock-movements__table-card">
        <div className="stock-movements__table-header">
          <div>
            <h2>История движений</h2>
            <p>Загружено: {movements.length}</p>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="stock-movements__empty">Загрузка движений…</div>
        ) : movements.length === 0 ? (
          <div className="stock-movements__empty">Движений по выбранному фильтру нет.</div>
        ) : (
          <div className="stock-movements__table-wrapper">
            <Table className="stock-movements__table">
              <TableHead><TableRow><TableHeader>Дата</TableHeader><TableHeader>Тип</TableHeader><TableHeader>Товар</TableHeader><TableHeader>Количество</TableHeader><TableHeader>Единица</TableHeader><TableHeader>Основание</TableHeader></TableRow></TableHead>
              <TableBody>
                {movements.map((movement) => {
                  const product = products.find((item) => item.id === movement.productId)
                  return <TableRow key={movement.id}>
                    <TableCell>{movement.createdAt.toLocaleDateString('ru-RU')}</TableCell>
                    <TableCell><Badge size="sm" variant={movement.type === 'purchase' ? 'success' : movement.type === 'sale' ? 'danger' : 'default'}>{getMovementType(movement.type)}</Badge></TableCell>
                    <TableCell><span className="stock-movements__product-name">{product?.name ?? movement.productId}</span></TableCell>
                    <TableCell><strong className={movement.type === 'sale' ? 'stock-movements__quantity stock-movements__quantity--expense' : 'stock-movements__quantity stock-movements__quantity--income'}>{movement.type === 'sale' ? movement.quantity : `+${movement.quantity}`}</strong></TableCell>
                    <TableCell>{getUnitLabel(movement.unit)}</TableCell>
                    <TableCell><span className="stock-movements__reference">{movement.note ?? movement.referenceId ?? '—'}</span></TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {loadMoreError && <div className="stock-movements__load-more-error"><Alert variant="danger" title="Не удалось загрузить следующие движения">{loadMoreError}</Alert></div>}
        {nextCursor && !isInitialLoading && <div className="stock-movements__load-more"><Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={isLoadingMore}>{isLoadingMore ? 'Загрузка…' : 'Показать ещё'}</Button></div>}
      </Card>
    </section>
  )
}

function getHistoryQuery(
  type: MovementFilter,
  productId: string,
  dateFrom: string,
  dateTo: string,
) {
  return {
    ...(type !== 'all' ? { type } : {}),
    ...(productId !== 'all' ? { productId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }
}
