import { useMemo, useState } from 'react'
import {
  getSalesReportingSummary,
  type PresetReportingPeriod,
} from '@madina/core'
import {
  Card,
  EmptyState,
  Select,
} from '@madina/ui'
import { useSales } from '../../context/useSales'
import './SalesReport.css'

const periodOptions: Array<{
  value: PresetReportingPeriod
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

export function SalesReport() {
  const { sales } = useSales()
  const [period, setPeriod] =
    useState<PresetReportingPeriod>('all')

  const summary = useMemo(
    () => getSalesReportingSummary(sales, period),
    [sales, period],
  )

  const { statusBreakdown } = summary

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
              event.target.value as PresetReportingPeriod,
            )
          }
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

      <div className="sales-report-page__summary">
        <Card className="sales-report-card">
          <span>Завершённые продажи</span>
          <strong>{summary.completedCount}</strong>
        </Card>

        <Card className="sales-report-card">
          <span>Сумма завершённых продаж</span>
          <strong>
            {formatAmount(summary.completedAmount)} SAR
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

        {sales.length === 0 ? (
          <EmptyState
            className="sales-report-page__empty"
            title="Продаж пока нет"
            description="Показатели появятся после создания продаж."
          />
        ) : (
          <div className="sales-report-page__status-list">
            <div>
              <span>Черновики</span>
              <strong>{statusBreakdown.draft}</strong>
            </div>

            <div>
              <span>Завершённые</span>
              <strong>{statusBreakdown.completed}</strong>
            </div>

            <div>
              <span>Отменённые</span>
              <strong>{statusBreakdown.cancelled}</strong>
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
