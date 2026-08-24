import { useMemo, useState } from 'react'
import { useTransactions } from '../../context/useTransactions'
import {
  calculateCategoryTotals,
  getFinancialKpis,
  getReportingEligibleTransactions,
  type PresetReportingPeriod,
  type Transaction,
} from '@madina/core'
import {
  Card,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import './Accounting.css'

type TypeFilter = 'all' | Transaction['type']

const categoryLabels: Record<
  Transaction['category'],
  string
> = {
  sale: 'Продажа',
  purchase: 'Поступление',
  other: 'Другое',
}

const paymentMethodLabels: Record<
  Transaction['paymentMethod'],
  string
> = {
  cash: 'Наличные',
  card: 'Карта',
  'bank-transfer': 'Банковский перевод',
  other: 'Другое',
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export function Accounting() {
  const { transactions } = useTransactions()

  const [period, setPeriod] =
    useState<PresetReportingPeriod>('all')

  const [typeFilter, setTypeFilter] =
    useState<TypeFilter>('all')

  const eligibleTransactions = useMemo(
    () => getReportingEligibleTransactions(transactions, period),
    [transactions, period],
  )

  const filteredTransactions = useMemo(
    () =>
      typeFilter === 'all'
        ? eligibleTransactions
        : eligibleTransactions.filter(
          (transaction) => transaction.type === typeFilter,
        ),
    [eligibleTransactions, typeFilter],
  )

  const {
    totalIncome,
    totalExpense,
    financialBalance,
  } = useMemo(
    () => getFinancialKpis(filteredTransactions, period),
    [filteredTransactions, period],
  )

  const categoryTotals = useMemo(
    () =>
      calculateCategoryTotals(
        filteredTransactions,
      ),
    [filteredTransactions],
  )

  return (
    <section className="accounting-page">
      <header className="accounting-page__header">
        <div>
          <h1>Бухгалтерия</h1>
          <p>
            Управленческий анализ финансовых
            операций CRM.
          </p>
        </div>

        <div className="accounting-filters">
          <Select
            value={period}
            onChange={(event) =>
              setPeriod(
                event.target.value as PresetReportingPeriod
              )
            }
          >
            <option value="all">
              Всё время
            </option>
            <option value="today">
              Сегодня
            </option>
            <option value="7days">
              Последние 7 дней
            </option>
            <option value="month">
              Текущий месяц
            </option>
          </Select>

          <Select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value as TypeFilter,
              )
            }
          >
            <option value="all">
              Все операции
            </option>
            <option value="income">
              Только доходы
            </option>
            <option value="expense">
              Только расходы
            </option>
          </Select>
        </div>
      </header>

      <div className="accounting-summary">
        <Card className="accounting-card">
          <span>Общий доход</span>
          <strong className="accounting-card__income">
            +{formatAmount(totalIncome)}
          </strong>
        </Card>

        <Card className="accounting-card">
          <span>Общие расходы</span>
          <strong className="accounting-card__expense">
            -{formatAmount(totalExpense)}
          </strong>
        </Card>

        <Card className="accounting-card">
          <span>Финансовый результат</span>
          <strong>
            {formatAmount(financialBalance)}
          </strong>
        </Card>

        <Card className="accounting-card">
          <span>Операций</span>
          <strong>
            {filteredTransactions.length}
          </strong>
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
              <strong>
                {formatAmount(
                  categoryTotals.sale,
                )}
              </strong>
            </div>

            <div>
              <span>Поступления</span>
              <strong>
                {formatAmount(
                  categoryTotals.purchase,
                )}
              </strong>
            </div>

            <div>
              <span>Другое</span>
              <strong>
                {formatAmount(
                  categoryTotals.other,
                )}
              </strong>
            </div>
          </div>
        </Card>

        <Card className="accounting-panel">
          <div className="accounting-panel__header">
            <h2>Финансовый результат</h2>
          </div>

          <div className="accounting-result">
            <span>
              Доход − Расход
            </span>

            <strong>
              {formatAmount(financialBalance)}
            </strong>
          </div>
        </Card>
      </div>

      <Card className="accounting-panel accounting-panel--table">
        <div className="accounting-panel__header">
          <div>
            <h2>Операции</h2>
            <span>
              {filteredTransactions.length}{' '}
              операций
            </span>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="accounting-empty">
            Нет операций за выбранный период.
          </div>
        ) : (
          <div className="accounting-table-wrapper">
            <Table className="accounting-table">
              <TableHead>
                <TableRow>
                  <TableHeader>Дата</TableHeader>
                  <TableHeader>Тип</TableHeader>
                  <TableHeader>Категория</TableHeader>
                  <TableHeader>Описание</TableHeader>
                  <TableHeader>Оплата</TableHeader>
                  <TableHeader>Сумма</TableHeader>
                </TableRow>
              </TableHead>

              <TableBody>
                {filteredTransactions.map(
                  (transaction) => {
                    const isIncome =
                      transaction.type === 'income'

                    return (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {formatDate(
                            transaction.transactionDate,
                          )}
                        </TableCell>

                        <TableCell>
                          <span
                            className={
                              isIncome
                                ? 'accounting-type accounting-type--income'
                                : 'accounting-type accounting-type--expense'
                            }
                          >
                            {isIncome
                              ? 'Доход'
                              : 'Расход'}
                          </span>
                        </TableCell>

                        <TableCell>
                          {
                            categoryLabels[
                            transaction.category
                            ]
                          }
                        </TableCell>

                        <TableCell>
                          {transaction.description ?? '—'}
                        </TableCell>

                        <TableCell>
                          {
                            paymentMethodLabels[
                            transaction.paymentMethod
                            ]
                          }
                        </TableCell>

                        <TableCell>
                          <strong
                            className={
                              isIncome
                                ? 'accounting-amount accounting-amount--income'
                                : 'accounting-amount accounting-amount--expense'
                            }
                          >
                            {isIncome ? '+' : '-'}
                            {formatAmount(
                              transaction.amount,
                            )}
                          </strong>
                        </TableCell>
                      </TableRow>
                    )
                  },
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  )
}
