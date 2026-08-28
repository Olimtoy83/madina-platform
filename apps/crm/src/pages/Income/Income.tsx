import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  FinancialTransactionRowResponse,
  IncomeReportResponse,
} from '@madina/api'
import {
  Alert,
  Badge,
  Button,
  Card,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import { getIncomeReport } from '../../shared/api/reportingApi'
import { HttpError } from '../../shared/api/httpClient'

import './Income.css'

type Filter = 'all' | 'income' | 'expense'
type IncomeTransaction = FinancialTransactionRowResponse

const typeLabels: Record<IncomeTransaction['type'], string> = {
  income: 'Доход',
  expense: 'Расход',
}

const categoryLabels: Record<IncomeTransaction['category'], string> = {
  sale: 'Продажа',
  purchase: 'Закупка',
  other: 'Прочее',
}

const paymentMethodLabels: Record<
  IncomeTransaction['paymentMethod'],
  string
> = {
  cash: 'Наличные',
  card: 'Карта',
  'bank-transfer': 'Банковский перевод',
  other: 'Другое',
}

const statusLabels: Record<IncomeTransaction['status'], string> = {
  completed: 'Завершено',
}

function getReportType(filter: Filter): 'income' | 'expense' | undefined {
  return filter === 'all'
    ? undefined
    : filter
}

function getIncomeReportErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return 'Отчёт по доходам и расходам недоступен для вашей роли.'
    }

    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить отчёт. Повторите попытку.'
}

export function Income() {
  const [filter, setFilter] = useState<Filter>('all')
  const [summary, setSummary] = useState<
    IncomeReportResponse['summary'] | null
  >(null)
  const [transactions, setTransactions] = useState<IncomeTransaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation

    setTransactions([])
    setNextCursor(undefined)
    setIsInitialLoading(true)
    setInitialError(null)
    setLoadMoreError(null)

    void getIncomeReport({ type: getReportType(filter) })
      .then((response) => {
        if (requestGeneration.current !== generation) return

        setSummary(response.summary)
        setTransactions(response.transactions.items)
        setNextCursor(response.transactions.nextCursor)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return

        setInitialError(getIncomeReportErrorMessage(error))
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsInitialLoading(false)
        }
      })
  }, [filter])

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore || isInitialLoading) return

    const generation = requestGeneration.current
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await getIncomeReport({
        type: getReportType(filter),
        cursor: nextCursor,
      })

      if (requestGeneration.current !== generation) return

      setSummary(response.summary)
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...response.transactions.items,
      ])
      setNextCursor(response.transactions.nextCursor)
    } catch (error) {
      if (requestGeneration.current !== generation) return

      setLoadMoreError(getIncomeReportErrorMessage(error))
    } finally {
      if (requestGeneration.current === generation) {
        setIsLoadingMore(false)
      }
    }
  }

  function formatAmount(amount: number) {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  function formatDate(date: string) {
    return new Intl.DateTimeFormat('ru-RU').format(
      new Date(date),
    )
  }

  function renderSummaryValue(value: number | undefined) {
    if (value !== undefined) {
      return `${formatAmount(value)} SAR`
    }

    if (isInitialLoading) {
      return <Skeleton variant="text" width="70%" />
    }

    return '—'
  }

  return (
    <section className="income-page">
      <div className="income-page__header">
        <div>
          <h1>Доходы и расходы</h1>
          <p>Финансовые операции CRM</p>
        </div>
      </div>

      {initialError && (
        <Alert variant="danger" title="Не удалось загрузить отчёт">
          {initialError}
        </Alert>
      )}

      <div className="income-summary">
        <Card className="income-card">
          <span className="income-card__label">Доход</span>
          <strong className="income-card__value">
            {renderSummaryValue(summary?.totalIncome)}
          </strong>
        </Card>

        <Card className="income-card">
          <span className="income-card__label">Расход</span>
          <strong className="income-card__value">
            {renderSummaryValue(summary?.totalExpense)}
          </strong>
        </Card>

        <Card className="income-card">
          <span className="income-card__label">
            Финансовый результат
          </span>
          <strong className="income-card__value">
            {renderSummaryValue(summary?.financialBalance)}
          </strong>
        </Card>
      </div>

      <div className="income-filters">
        <Button
          type="button"
          variant={filter === 'all' ? 'primary' : 'secondary'}
          onClick={() => setFilter('all')}
          disabled={isInitialLoading && filter === 'all'}
        >
          Все
        </Button>

        <Button
          type="button"
          variant={filter === 'income' ? 'primary' : 'secondary'}
          onClick={() => setFilter('income')}
          disabled={isInitialLoading && filter === 'income'}
        >
          Доходы
        </Button>

        <Button
          type="button"
          variant={filter === 'expense' ? 'primary' : 'secondary'}
          onClick={() => setFilter('expense')}
          disabled={isInitialLoading && filter === 'expense'}
        >
          Расходы
        </Button>
      </div>

      <Card className="income-table-wrapper">
        <Table className="income-table">
          <TableHead>
            <TableRow>
              <TableHeader>Дата</TableHeader>
              <TableHeader>Тип</TableHeader>
              <TableHeader>Категория</TableHeader>
              <TableHeader>Описание</TableHeader>
              <TableHeader>Оплата</TableHeader>
              <TableHeader>Сумма</TableHeader>
              <TableHeader>Статус</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {isInitialLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="income-table__empty">
                  Загрузка операций…
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="income-table__empty">
                  {filter === 'all'
                    ? 'Операций пока нет'
                    : 'Операций по выбранному фильтру пока нет'}
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {formatDate(transaction.transactionDate)}
                  </TableCell>
                  <TableCell>{typeLabels[transaction.type]}</TableCell>
                  <TableCell>
                    {categoryLabels[transaction.category]}
                  </TableCell>
                  <TableCell>{transaction.description ?? '—'}</TableCell>
                  <TableCell>
                    {paymentMethodLabels[transaction.paymentMethod]}
                  </TableCell>
                  <TableCell>{formatAmount(transaction.amount)} SAR</TableCell>
                  <TableCell>
                    <Badge variant="success">
                      {statusLabels[transaction.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {loadMoreError && (
          <div className="income-table__load-more-error">
            <Alert
              variant="danger"
              title="Не удалось загрузить следующие операции"
            >
              {loadMoreError}
            </Alert>
          </div>
        )}

        {nextCursor && !isInitialLoading && (
          <div className="income-table__load-more">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Загрузка…' : 'Показать ещё'}
            </Button>
          </div>
        )}
      </Card>
    </section>
  )
}
