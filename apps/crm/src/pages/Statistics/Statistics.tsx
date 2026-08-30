import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  FinancialTransactionRowResponse,
  StatisticsReportPeriod,
  StatisticsReportResponse,
} from '@madina/api'
import {
  Alert,
  Button,
  Card,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import { useTasks } from '../../context/useTasks'
import { useTransactionalState } from '../../context/useTransactionalState'
import { HttpError } from '../../shared/api/httpClient'
import { getStatisticsReport } from '../../shared/api/reportingApi'

import './Statistics.css'

type StatisticsOperation = FinancialTransactionRowResponse

const categoryLabels: Record<
  StatisticsOperation['category'],
  string
> = {
  sale: 'Продажи',
  purchase: 'Поступления',
  other: 'Другое',
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

function getStatisticsReportErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return 'Статистика недоступна для вашей роли.'
    }

    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить статистику. Повторите попытку.'
}

function formatStockByUnit(
  stockByUnit: StatisticsReportResponse['inventory']['stockByUnit'],
) {
  if (stockByUnit.length === 0) {
    return 'Нет остатков'
  }

  return stockByUnit
    .map(({ quantity, unit }) =>
      `${quantity.toLocaleString('ru-RU')} ${unit}`,
    )
    .join(', ')
}

export function Statistics() {
  const { snapshot: commerceSnapshot } = useTransactionalState()
  const { tasks } = useTasks()
  const [period, setPeriod] = useState<StatisticsReportPeriod>('all')
  const [report, setReport] = useState<StatisticsReportResponse | null>(null)
  const [operations, setOperations] = useState<StatisticsOperation[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation

    setReport(null)
    setOperations([])
    setNextCursor(undefined)
    setIsInitialLoading(true)
    setIsLoadingMore(false)
    setInitialError(null)
    setLoadMoreError(null)

    void getStatisticsReport({ period })
      .then((response) => {
        if (requestGeneration.current !== generation) return

        setReport(response)
        setOperations(response.operations.items)
        setNextCursor(response.operations.nextCursor)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return

        setInitialError(getStatisticsReportErrorMessage(error))
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsInitialLoading(false)
        }
      })
  }, [period, commerceSnapshot, tasks])

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore || isInitialLoading) return

    const generation = requestGeneration.current
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await getStatisticsReport({
        period,
        cursor: nextCursor,
      })

      if (requestGeneration.current !== generation) return

      setReport(response)
      setOperations((currentOperations) => [
        ...currentOperations,
        ...response.operations.items,
      ])
      setNextCursor(response.operations.nextCursor)
    } catch (error) {
      if (requestGeneration.current !== generation) return

      setLoadMoreError(getStatisticsReportErrorMessage(error))
    } finally {
      if (requestGeneration.current === generation) {
        setIsLoadingMore(false)
      }
    }
  }

  function renderNumber(value: number | undefined) {
    if (value !== undefined) return value

    if (isInitialLoading) {
      return (
        <span
          className="mb-skeleton mb-skeleton--text"
          style={{ width: '55%' }}
          aria-busy="true"
          aria-live="polite"
        />
      )
    }

    return '—'
  }

  function renderAmount(value: number | undefined) {
    if (value !== undefined) return `${formatAmount(value)} SAR`

    if (isInitialLoading) {
      return (
        <span
          className="mb-skeleton mb-skeleton--text"
          style={{ width: '70%' }}
          aria-busy="true"
          aria-live="polite"
        />
      )
    }

    return '—'
  }

  function renderStockByUnit() {
    if (report) return formatStockByUnit(report.inventory.stockByUnit)

    if (isInitialLoading) {
      return (
        <span
          className="mb-skeleton mb-skeleton--text"
          style={{ width: '70%' }}
          aria-busy="true"
          aria-live="polite"
        />
      )
    }

    return '—'
  }

  return (
    <section className="statistics-page">
      <header className="statistics-page__header">
        <div>
          <h1>Статистика</h1>

          <p>
            Аналитика продаж, финансов,
            склада и задач.
          </p>
        </div>

        <Select
          className="statistics-page__period"
          aria-label="Период отчёта"
          value={period}
          onChange={(event) =>
            setPeriod(event.target.value as StatisticsReportPeriod)}
          disabled={isInitialLoading}
        >
          <option value="all">Всё время</option>
          <option value="today">Сегодня</option>
          <option value="7days">Последние 7 дней</option>
          <option value="month">Текущий месяц</option>
        </Select>
      </header>

      {initialError && (
        <Alert variant="danger" title="Не удалось загрузить статистику">
          {initialError}
        </Alert>
      )}

      <section className="statistics-summary-group">
        <p className="statistics-summary-group__label">Ключевые показатели</p>

        <div className="statistics-page__summary statistics-page__summary--primary">
          <Card className="statistics-card statistics-card--sales">
            <span>Завершённые продажи</span>
            <strong>{renderNumber(report?.sales.completedCount)}</strong>
          </Card>

          <Card className="statistics-card statistics-card--income">
            <span>Общий доход</span>
            <strong>{renderAmount(report?.financial.totalIncome)}</strong>
          </Card>

          <Card className="statistics-card statistics-card--expense">
            <span>Общие расходы</span>
            <strong>{renderAmount(report?.financial.totalExpense)}</strong>
          </Card>

          <Card
            className={`statistics-card statistics-card--balance ${
              (report?.financial.financialBalance ?? 0) < 0
                ? 'statistics-card--balance-negative'
                : 'statistics-card--balance-positive'
            }`}
          >
            <span>Финансовый результат</span>
            <strong>{renderAmount(report?.financial.financialBalance)}</strong>
          </Card>
        </div>
      </section>

      <section className="statistics-summary-group">
        <p className="statistics-summary-group__label">Операционные показатели</p>

        <div className="statistics-page__summary statistics-page__summary--secondary">
          <Card className="statistics-card">
            <span>Завершённые поступления</span>
            <strong>{renderNumber(report?.purchases.completedCount)}</strong>
          </Card>

          <Card className="statistics-card">
            <span>Товарных позиций</span>
            <strong>{renderNumber(report?.inventory.productCount)}</strong>
          </Card>

          <Card className="statistics-card">
            <span>Остатки на складе</span>
            <strong title={report
              ? formatStockByUnit(report.inventory.stockByUnit)
              : undefined}
            >
              {renderStockByUnit()}
            </strong>
          </Card>
        </div>
      </section>

      <div className="statistics-page__grid">
        <Card className="statistics-panel" padding="none">
          <div className="statistics-panel__header">
            <h2>Финансы по категориям</h2>
          </div>

          <div className="statistics-list">
            <div>
              <span>{categoryLabels.sale}</span>
              <strong>{renderAmount(report?.financial.categories.sale)}</strong>
            </div>

            <div>
              <span>{categoryLabels.purchase}</span>
              <strong>{renderAmount(report?.financial.categories.purchase)}</strong>
            </div>

            <div>
              <span>{categoryLabels.other}</span>
              <strong>{renderAmount(report?.financial.categories.other)}</strong>
            </div>
          </div>
        </Card>

        <Card className="statistics-panel" padding="none">
          <div className="statistics-panel__header">
            <h2>Задачи</h2>
          </div>

          <div className="statistics-list">
            <div>
              <span>Всего</span>
              <strong>{renderNumber(report?.tasks.total)}</strong>
            </div>

            <div>
              <span>К выполнению</span>
              <strong>{renderNumber(report?.tasks.todo)}</strong>
            </div>

            <div>
              <span>В работе</span>
              <strong>{renderNumber(report?.tasks.inProgress)}</strong>
            </div>

            <div>
              <span>Завершено</span>
              <strong>{renderNumber(report?.tasks.completed)}</strong>
            </div>
          </div>
        </Card>
      </div>

      <Card
        className="statistics-panel statistics-panel--table"
        padding="none"
      >
        <div className="statistics-panel__header">
          <div>
            <h2>Финансовые операции</h2>
            <span>{renderNumber(report?.financial.transactionCount)} операций</span>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="statistics-empty">Загрузка операций…</div>
        ) : operations.length === 0 ? (
          <div className="statistics-empty">
            Операций за выбранный период нет.
          </div>
        ) : (
          <div className="statistics-table-wrapper">
            <Table className="statistics-table">
              <TableHead>
                <TableRow>
                  <TableHeader>Дата</TableHeader>
                  <TableHeader>Тип</TableHeader>
                  <TableHeader>Категория</TableHeader>
                  <TableHeader>Описание</TableHeader>
                  <TableHeader>Сумма</TableHeader>
                </TableRow>
              </TableHead>

              <TableBody>
                {operations.map((operation) => (
                  <TableRow key={operation.id}>
                    <TableCell>{formatDate(operation.transactionDate)}</TableCell>
                    <TableCell>
                      {operation.type === 'income' ? 'Доход' : 'Расход'}
                    </TableCell>
                    <TableCell>{categoryLabels[operation.category]}</TableCell>
                    <TableCell>{operation.description ?? '—'}</TableCell>
                    <TableCell>{formatAmount(operation.amount)} SAR</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {loadMoreError && (
          <div className="statistics-load-more-error">
            <Alert variant="danger" title="Не удалось загрузить следующие операции">
              {loadMoreError}
            </Alert>
          </div>
        )}

        {nextCursor && !isInitialLoading && (
          <div className="statistics-load-more">
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
