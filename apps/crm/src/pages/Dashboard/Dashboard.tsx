import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

import {
  Alert,
  Button,
  Card,
  Skeleton,
} from '@madina/ui'
import type {
  FinancialTransactionRowResponse,
  ReportingSummaryResponse,
} from '@madina/api'
import { useTransactionalState } from '../../context/useTransactionalState'
import { usePermissions } from '../../context/usePermissions'
import {
  getIncomeReport,
  getReportingSummary,
} from '../../shared/api/reportingApi'
import { toDashboardKpis } from './dashboardSummary'
import './Dashboard.css'

export function Dashboard() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { snapshot } = useTransactionalState()
  const [summary, setSummary] =
    useState<ReportingSummaryResponse | null>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<Error | null>(null)
  const [recentTransactions, setRecentTransactions] = useState<
    FinancialTransactionRowResponse[]
  >([])
  const [isRecentTransactionsLoading, setIsRecentTransactionsLoading] =
    useState(true)
  const [recentTransactionsError, setRecentTransactionsError] =
    useState<Error | null>(null)
  const recentTransactionsRequestGeneration = useRef(0)

  useEffect(() => {
    let isCurrent = true

    setIsSummaryLoading(true)

    void getReportingSummary()
      .then((nextSummary) => {
        if (!isCurrent) return

        setSummary(nextSummary)
        setSummaryError(null)
      })
      .catch((error: unknown) => {
        if (!isCurrent) return

        setSummaryError(error instanceof Error
          ? error
          : new Error('Не удалось загрузить показатели Dashboard.'))
      })
      .finally(() => {
        if (isCurrent) setIsSummaryLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [snapshot])

  useEffect(() => {
    const generation = recentTransactionsRequestGeneration.current + 1
    recentTransactionsRequestGeneration.current = generation

    setRecentTransactions([])
    setIsRecentTransactionsLoading(true)
    setRecentTransactionsError(null)

    void getIncomeReport({ limit: 5 })
      .then((response) => {
        if (recentTransactionsRequestGeneration.current !== generation) return

        setRecentTransactions(response.transactions.items)
      })
      .catch((error: unknown) => {
        if (recentTransactionsRequestGeneration.current !== generation) return

        setRecentTransactionsError(error instanceof Error
          ? error
          : new Error('Не удалось загрузить последние операции.'))
      })
      .finally(() => {
        if (recentTransactionsRequestGeneration.current === generation) {
          setIsRecentTransactionsLoading(false)
        }
      })
  }, [snapshot])

  const kpis = useMemo(
    () => summary && toDashboardKpis(summary),
    [summary],
  )

  function formatMoney(value: number) {
    return `${value.toLocaleString('ru-RU')} SAR`
  }

  function formatDate(date: string) {
    return new Intl.DateTimeFormat('ru-RU').format(new Date(date))
  }

  function formatStockByUnit() {
    if (!kpis || kpis.stockByUnit.length === 0) {
      return 'Нет остатков'
    }

    return kpis.stockByUnit
      .map(({ quantity, unit }) =>
        `${quantity.toLocaleString('ru-RU')} ${unit}`,
      )
      .join(', ')
  }

  function renderKpiValue(value: string | number) {
    if (kpis) return value

    if (isSummaryLoading) {
      return <Skeleton variant="text" width="70%" />
    }

    return '—'
  }

  function getTransactionLabel(
    type: 'income' | 'expense',
    category:
      | 'sale'
      | 'purchase'
      | 'other',
  ) {
    if (
      type === 'income' &&
      category === 'sale'
    ) {
      return 'Продажа'
    }

    if (
      type === 'expense' &&
      category === 'purchase'
    ) {
      return 'Поступление'
    }

    return 'Прочее'
  }

  return (
    <section className="dashboard">
      <div className="dashboard__intro">
        <div>
          <h2>Dashboard</h2>

          <p>
            Обзор текущего состояния бизнеса
          </p>
        </div>
      </div>

      {summaryError && (
        <Alert
          variant="danger"
          title="Не удалось загрузить показатели Dashboard"
        >
          {summaryError.message}
        </Alert>
      )}

      <div className="dashboard__kpi-grid">
        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Завершённые продажи
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis?.completedSalesCount ?? '—')}
          </strong>
        </Card>

        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Общий доход
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis
              ? formatMoney(kpis.totalIncome)
              : '—')}
          </strong>
        </Card>

        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Общие расходы
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis
              ? formatMoney(kpis.totalExpense)
              : '—')}
          </strong>
        </Card>

        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Финансовый результат
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis
              ? formatMoney(kpis.financialBalance)
              : '—')}
          </strong>
        </Card>

        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Товарных позиций
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis?.productCount ?? '—')}
          </strong>
        </Card>

        <Card className="dashboard__card">
          <span className="dashboard__card-label">
            Остатки на складе
          </span>

          <strong className="dashboard__card-value">
            {renderKpiValue(kpis
              ? formatStockByUnit()
              : '—')}
          </strong>
        </Card>
      </div>

      <div className="dashboard__sections">
        <Card className="dashboard__section">
          <div className="dashboard__section-header">
            <h3>Последние операции</h3>
          </div>

          {recentTransactionsError && (
            <Alert
              variant="danger"
              title="Не удалось загрузить последние операции"
            >
              {recentTransactionsError.message}
            </Alert>
          )}

          {isRecentTransactionsLoading ? (
            <p>Загрузка операций…</p>
          ) : recentTransactionsError ? (
            <p>Данные операций недоступны.</p>
          ) : recentTransactions.length === 0 ? (
            <p>
              Финансовых операций пока нет.
            </p>
          ) : (
            <div className="dashboard__sales-list">
              {recentTransactions.map(
                (transaction) => (
                  <div
                    key={transaction.id}
                    className="dashboard__sale-row"
                  >
                    <div>
                      <strong>
                        {getTransactionLabel(
                          transaction.type,
                          transaction.category,
                        )}
                      </strong>

                      <p>
                        {transaction.description ??
                          'Без описания'}
                      </p>
                    </div>

                    <div>
                      <strong>
                        {formatMoney(
                          transaction.amount,
                        )}
                      </strong>

                      <p>
                        {formatDate(
                          transaction.transactionDate,
                        )}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </Card>

        <Card className="dashboard__section">
          <div className="dashboard__section-header">
            <h3>Быстрые действия</h3>
          </div>

          <div className="dashboard__quick-actions">
            {can('sales:write') && (
            <Button
              type="button"
              variant="secondary"
              fullWidth
              className="dashboard__quick-action"
              onClick={() => navigate('/sales')}
            >
              Новая продажа
            </Button>
            )}

            {can('purchases:write') && (
            <Button
              type="button"
              variant="secondary"
              fullWidth
              className="dashboard__quick-action"
              onClick={() => navigate('/purchases')}
            >
              Добавить поступление
            </Button>
            )}

            <Button
              type="button"
              variant="secondary"
              fullWidth
              className="dashboard__quick-action"
              onClick={() => navigate('/warehouse')}
            >
              Открыть склад
            </Button>
          </div>
        </Card>
      </div>

      <Card className="dashboard__section">
        <div className="dashboard__section-header">
          <h3>Склад</h3>
        </div>

        <p>
          Товарных позиций:{' '}
          <strong>
            {renderKpiValue(kpis?.productCount ?? '—')}
          </strong>
        </p>

        <p>
          Остатки по единицам:{' '}
          <strong>
            {renderKpiValue(kpis
              ? formatStockByUnit()
              : '—')}
          </strong>
        </p>
      </Card>
    </section >
  )
}
