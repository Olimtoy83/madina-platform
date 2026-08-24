import { useMemo, useState } from 'react'
import { useTransactions } from '../../context/useTransactions'
import {
  getFinancialKpis,
  getReportingEligibleTransactions,
  type Transaction,
} from '@madina/core'

import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'

import './Income.css'

type Filter = 'all' | 'income' | 'expense'

const typeLabels: Record<Transaction['type'], string> = {
  income: 'Доход',
  expense: 'Расход',
}

const categoryLabels: Record<
  Transaction['category'],
  string
> = {
  sale: 'Продажа',
  purchase: 'Закупка',
  other: 'Прочее',
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

const statusLabels: Record<
  Transaction['status'],
  string
> = {
  pending: 'Ожидает',
  completed: 'Завершено',
  cancelled: 'Отменено',
}

export function Income() {
  const { transactions } = useTransactions()

  const [filter, setFilter] =
    useState<Filter>('all')

  const eligibleTransactions = useMemo(
    () => getReportingEligibleTransactions(transactions, 'all'),
    [transactions],
  )

  const filteredTransactions = useMemo(
    () =>
      filter === 'all'
        ? eligibleTransactions
        : eligibleTransactions.filter(
          (transaction) => transaction.type === filter,
        ),
    [eligibleTransactions, filter],
  )

  const {
    totalIncome,
    totalExpense,
    financialBalance,
  } = useMemo(
    () => getFinancialKpis(transactions, 'all'),
    [transactions],
  )

  function formatAmount(amount: number) {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  function formatDate(date: Date) {
    return new Intl.DateTimeFormat('ru-RU').format(
      new Date(date),
    )
  }

  return (
    <section className="income-page">
      <div className="income-page__header">
        <div>
          <h1>Доходы и расходы</h1>
          <p>
            Финансовые операции CRM
          </p>
        </div>
      </div>

      <div className="income-summary">
        <Card className="income-card">
          <span className="income-card__label">
            Доход
          </span>

          <strong className="income-card__value">
            {formatAmount(totalIncome)} SAR
          </strong>
        </Card>

        <Card className="income-card">
          <span className="income-card__label">
            Расход
          </span>

          <strong className="income-card__value">
            {formatAmount(totalExpense)} SAR
          </strong>
        </Card>

        <Card className="income-card">
          <span className="income-card__label">
            Финансовый результат
          </span>

          <strong className="income-card__value">
            {formatAmount(financialBalance)} SAR
          </strong>
        </Card>
      </div>

      <div className="income-filters">
        <Button
          type="button"
          variant={
            filter === 'all'
              ? 'primary'
              : 'secondary'
          }
          onClick={() => setFilter('all')}
        >
          Все
        </Button>

        <Button
          type="button"
          variant={
            filter === 'income'
              ? 'primary'
              : 'secondary'
          }
          onClick={() => setFilter('income')}
        >
          Доходы
        </Button>

        <Button
          type="button"
          variant={
            filter === 'expense'
              ? 'primary'
              : 'secondary'
          }
          onClick={() => setFilter('expense')}
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
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="income-table__empty"
                >
                  Операций пока нет
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map(
                (transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      {formatDate(
                        transaction.transactionDate,
                      )}
                    </TableCell>

                    <TableCell>
                      {typeLabels[transaction.type]}
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
                      {formatAmount(
                        transaction.amount,
                      )}{' '}
                      SAR
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          transaction.status === 'completed'
                            ? 'success'
                            : transaction.status === 'cancelled'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {
                          statusLabels[
                          transaction.status
                          ]
                        }
                      </Badge>
                    </TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}
