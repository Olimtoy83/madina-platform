import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  AccountingReportPeriod,
  AccountingReportResponse,
  FinancialTransactionRowResponse,
} from '@madina/api'
import {
  Alert,
  Button,
  Card,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import { getAccountingReport } from '../../shared/api/reportingApi'
import { HttpError } from '../../shared/api/httpClient'
import './Accounting.css'

type TypeFilter = 'all' | FinancialTransactionRowResponse['type']
type AccountingTransaction = FinancialTransactionRowResponse

const categoryLabels: Record<AccountingTransaction['category'], string> = {
  sale: 'Продажа',
  purchase: 'Поступление',
  other: 'Другое',
}

const paymentMethodLabels: Record<
  AccountingTransaction['paymentMethod'],
  string
> = {
  cash: 'Наличные',
  card: 'Карта',
  'bank-transfer': 'Банковский перевод',
  other: 'Другое',
}

function getReportType(
  typeFilter: TypeFilter,
): 'income' | 'expense' | undefined {
  return typeFilter === 'all'
    ? undefined
    : typeFilter
}

function getAccountingReportErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return 'Отчёт по бухгалтерии недоступен для вашей роли.'
    }

    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить отчёт. Повторите попытку.'
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

export function Accounting() {
  const [period, setPeriod] = useState<AccountingReportPeriod>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [summary, setSummary] = useState<
    AccountingReportResponse['summary'] | null
  >(null)
  const [categories, setCategories] = useState<
    AccountingReportResponse['categories'] | null
  >(null)
  const [transactions, setTransactions] = useState<AccountingTransaction[]>([])
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

    void getAccountingReport({
      period,
      type: getReportType(typeFilter),
    })
      .then((response) => {
        if (requestGeneration.current !== generation) return

        setSummary(response.summary)
        setCategories(response.categories)
        setTransactions(response.transactions.items)
        setNextCursor(response.transactions.nextCursor)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return

        setInitialError(getAccountingReportErrorMessage(error))
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsInitialLoading(false)
        }
      })
  }, [period, typeFilter])

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore || isInitialLoading) return

    const generation = requestGeneration.current
    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const response = await getAccountingReport({
        period,
        type: getReportType(typeFilter),
        cursor: nextCursor,
      })

      if (requestGeneration.current !== generation) return

      setSummary(response.summary)
      setCategories(response.categories)
      setTransactions((currentTransactions) => [
        ...currentTransactions,
        ...response.transactions.items,
      ])
      setNextCursor(response.transactions.nextCursor)
    } catch (error) {
      if (requestGeneration.current !== generation) return

      setLoadMoreError(getAccountingReportErrorMessage(error))
    } finally {
      if (requestGeneration.current === generation) {
        setIsLoadingMore(false)
      }
    }
  }

  function renderSummaryValue(value: number | undefined) {
    if (value !== undefined) return formatAmount(value)

    if (isInitialLoading) {
      return <Skeleton variant="text" width="70%" />
    }

    return '—'
  }

  return (
    <section className="accounting-page">
      <header className="accounting-page__header">
        <div>
          <h1>Бухгалтерия</h1>
          <p>Управленческий анализ финансовых операций CRM.</p>
        </div>

        <div className="accounting-filters" aria-label="Фильтры учёта">
          <Select
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as AccountingReportPeriod)}
            disabled={isInitialLoading}
          >
            <option value="all">Всё время</option>
            <option value="today">Сегодня</option>
            <option value="7days">Последние 7 дней</option>
            <option value="month">Текущий месяц</option>
          </Select>

          <Select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as TypeFilter)}
            disabled={isInitialLoading}
          >
            <option value="all">Все операции</option>
            <option value="income">Только доходы</option>
            <option value="expense">Только расходы</option>
          </Select>
        </div>
      </header>

      {initialError && (
        <Alert variant="danger" title="Не удалось загрузить отчёт">
          {initialError}
        </Alert>
      )}

      <div className="accounting-summary">
        <Card className="accounting-card">
          <span>Общий доход</span>
          <strong className="accounting-card__income">
            +{renderSummaryValue(summary?.totalIncome)}
          </strong>
        </Card>

        <Card className="accounting-card">
          <span>Общие расходы</span>
          <strong className="accounting-card__expense">
            -{renderSummaryValue(summary?.totalExpense)}
          </strong>
        </Card>

        <Card className="accounting-card">
          <span>Финансовый результат</span>
          <strong>{renderSummaryValue(summary?.financialBalance)}</strong>
        </Card>

        <Card className="accounting-card">
          <span>Операций</span>
          <strong>{renderSummaryValue(summary?.transactionCount)}</strong>
        </Card>
      </div>

      <div className="accounting-grid">
        <Card className="accounting-panel">
          <div className="accounting-panel__header">
            <h2>По категориям</h2>
          </div>

          <div className="accounting-category-list">
            <div>
              <span>Продажи</span>
              <strong>{renderSummaryValue(categories?.sale)}</strong>
            </div>

            <div>
              <span>Поступления</span>
              <strong>{renderSummaryValue(categories?.purchase)}</strong>
            </div>

            <div>
              <span>Другое</span>
              <strong>{renderSummaryValue(categories?.other)}</strong>
            </div>
          </div>
        </Card>

        <Card className="accounting-panel">
          <div className="accounting-panel__header">
            <h2>Финансовый результат</h2>
          </div>

          <div className="accounting-result">
            <span>Доход − Расход</span>
            <strong>{renderSummaryValue(summary?.financialBalance)}</strong>
          </div>
        </Card>
      </div>

      <Card className="accounting-panel accounting-panel--table" padding="none">
        <div className="accounting-panel__header">
          <div>
            <h2>Операции</h2>
            <span>
              {summary?.transactionCount ?? '—'} операций
            </span>
          </div>
        </div>

        {isInitialLoading ? (
          <div className="accounting-empty">Загрузка операций…</div>
        ) : transactions.length === 0 ? (
          <div className="accounting-empty">
            Нет операций за выбранный период.
          </div>
        ) : (
          <div className="accounting-table-wrapper">
            <Table className="accounting-table">
              <TableHead>
                <TableRow>
                  <TableHeader scope="col">Дата</TableHeader>
                  <TableHeader scope="col">Тип</TableHeader>
                  <TableHeader scope="col">Категория</TableHeader>
                  <TableHeader scope="col">Описание</TableHeader>
                  <TableHeader scope="col">Оплата</TableHeader>
                  <TableHeader scope="col" className="accounting-table__amount-cell">Сумма</TableHeader>
                </TableRow>
              </TableHead>

              <TableBody>
                {transactions.map((transaction) => {
                  const isIncome = transaction.type === 'income'

                  return (
                    <TableRow key={transaction.id}>
                      <TableCell>{formatDate(transaction.transactionDate)}</TableCell>
                      <TableCell>
                        <span className={isIncome
                          ? 'accounting-type accounting-type--income'
                          : 'accounting-type accounting-type--expense'}
                        >
                          {isIncome ? 'Доход' : 'Расход'}
                        </span>
                      </TableCell>
                      <TableCell>{categoryLabels[transaction.category]}</TableCell>
                      <TableCell>{transaction.description ?? '—'}</TableCell>
                      <TableCell>
                        {paymentMethodLabels[transaction.paymentMethod]}
                      </TableCell>
                      <TableCell className="accounting-table__amount-cell">
                        <strong className={isIncome
                          ? 'accounting-amount accounting-amount--income'
                          : 'accounting-amount accounting-amount--expense'}
                        >
                          {isIncome ? '+' : '-'}{formatAmount(transaction.amount)}
                        </strong>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {loadMoreError && (
          <div className="accounting-load-more-error">
            <Alert
              variant="danger"
              title="Не удалось загрузить следующие операции"
            >
              {loadMoreError}
            </Alert>
          </div>
        )}

        {nextCursor && !isInitialLoading && (
          <div className="accounting-load-more">
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
