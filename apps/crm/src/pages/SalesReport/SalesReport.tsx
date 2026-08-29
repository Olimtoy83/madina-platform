import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  SalesReportPeriod,
  SalesReportResponse,
} from '@madina/api'
import {
  Alert,
  Card,
  EmptyState,
  Select,
  Skeleton,
} from '@madina/ui'
import { HttpError } from '../../shared/api/httpClient'
import { getSalesReport } from '../../shared/api/reportingApi'
import './SalesReport.css'

const periodOptions: Array<{
  value: SalesReportPeriod
  label: string
}> = [
  { value: 'all', label: 'Всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: '7days', label: 'Последние 7 дней' },
  { value: 'month', label: 'Текущий месяц' },
]

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function getSalesReportErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return 'Отчёт по продажам недоступен для вашей роли.'
    }

    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить отчёт. Повторите попытку.'
}

export function SalesReport() {
  const [period, setPeriod] =
    useState<SalesReportPeriod>('all')
  const [summary, setSummary] = useState<SalesReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation

    setSummary(null)
    setIsLoading(true)
    setError(null)

    void getSalesReport({ period })
      .then((response) => {
        if (requestGeneration.current !== generation) return

        setSummary(response)
      })
      .catch((requestError: unknown) => {
        if (requestGeneration.current !== generation) return

        setError(getSalesReportErrorMessage(requestError))
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsLoading(false)
        }
      })
  }, [period])

  function renderCount(value: number | undefined) {
    if (value !== undefined) return value

    if (isLoading) {
      return <Skeleton variant="text" width="40%" />
    }

    return '—'
  }

  function renderAmount(value: number | undefined) {
    if (value !== undefined) return `${formatAmount(value)} SAR`

    if (isLoading) {
      return <Skeleton variant="text" width="70%" />
    }

    return '—'
  }

  const hasSales = summary
    ? summary.statusCounts.draft +
      summary.statusCounts.completed +
      summary.statusCounts.cancelled > 0
    : false

  return (
    <section className="sales-report-page">
      <header className="sales-report-page__header">
        <div>
          <h1>Отчёт по продажам</h1>

          <p>
            Сводные показатели продаж за выбранный период.
          </p>
        </div>

        <Select
          className="sales-report-page__period"
          value={period}
          onChange={(event) =>
            setPeriod(
              event.target.value as SalesReportPeriod,
            )
          }
          disabled={isLoading}
        >
          {periodOptions.map((option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </Select>
      </header>

      {error && (
        <Alert variant="danger" title="Не удалось загрузить отчёт">
          {error}
        </Alert>
      )}

      <div className="sales-report-page__summary">
        <Card className="sales-report-card">
          <span>Завершённые продажи</span>
          <strong>{renderCount(summary?.statusCounts.completed)}</strong>
        </Card>

        <Card className="sales-report-card">
          <span>Сумма завершённых продаж</span>
          <strong>
            {renderAmount(summary?.completedAmount)}
          </strong>
        </Card>
      </div>

      <Card
        className="sales-report-page__breakdown"
        padding="none"
      >
        <div className="sales-report-page__breakdown-header">
          <h2>Статусы продаж</h2>
        </div>

        {isLoading ? (
          <div className="sales-report-page__empty">Загрузка продаж…</div>
        ) : !summary ? (
          <div className="sales-report-page__empty">
            Данные отчёта недоступны.
          </div>
        ) : !hasSales ? (
          <EmptyState
            className="sales-report-page__empty"
            title="Продаж пока нет"
            description="Показатели появятся после создания продаж."
          />
        ) : (
          <div className="sales-report-page__status-list">
            <div>
              <span>Черновики</span>
              <strong>{renderCount(summary?.statusCounts.draft)}</strong>
            </div>

            <div>
              <span>Завершённые</span>
              <strong>{renderCount(summary?.statusCounts.completed)}</strong>
            </div>

            <div>
              <span>Отменённые</span>
              <strong>{renderCount(summary?.statusCounts.cancelled)}</strong>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
