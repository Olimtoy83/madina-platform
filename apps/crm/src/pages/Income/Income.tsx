import { useMemo, useState } from 'react'
import { useTransactions } from '../../context/useTransactions'
import type { Transaction } from '../../entities/transaction'

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

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((transaction) =>
        filter === 'all'
          ? true
          : transaction.type === filter,
      ),
    [transactions, filter],
  )

  const totalIncome = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            transaction.type === 'income' &&
            transaction.status === 'completed',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),
    [transactions],
  )

  const totalExpense = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            transaction.type === 'expense' &&
            transaction.status === 'completed',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),
    [transactions],
  )

  const balance = totalIncome - totalExpense

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
        <article className="income-card">
          <span className="income-card__label">
            Доход
          </span>

          <strong className="income-card__value">
            {formatAmount(totalIncome)} SAR
          </strong>
        </article>

        <article className="income-card">
          <span className="income-card__label">
            Расход
          </span>

          <strong className="income-card__value">
            {formatAmount(totalExpense)} SAR
          </strong>
        </article>

        <article className="income-card">
          <span className="income-card__label">
            Баланс
          </span>

          <strong className="income-card__value">
            {formatAmount(balance)} SAR
          </strong>
        </article>
      </div>

      <div className="income-filters">
        <button
          type="button"
          className={
            filter === 'all'
              ? 'income-filter income-filter--active'
              : 'income-filter'
          }
          onClick={() => setFilter('all')}
        >
          Все
        </button>

        <button
          type="button"
          className={
            filter === 'income'
              ? 'income-filter income-filter--active'
              : 'income-filter'
          }
          onClick={() => setFilter('income')}
        >
          Доходы
        </button>

        <button
          type="button"
          className={
            filter === 'expense'
              ? 'income-filter income-filter--active'
              : 'income-filter'
          }
          onClick={() => setFilter('expense')}
        >
          Расходы
        </button>
      </div>

      <div className="income-table-wrapper">
        <table className="income-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Категория</th>
              <th>Описание</th>
              <th>Оплата</th>
              <th>Сумма</th>
              <th>Статус</th>
            </tr>
          </thead>

          <tbody>
            {filteredTransactions.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="income-table__empty"
                >
                  Операций пока нет
                </td>
              </tr>
            ) : (
              filteredTransactions.map(
                (transaction) => (
                  <tr key={transaction.id}>
                    <td>
                      {formatDate(
                        transaction.transactionDate,
                      )}
                    </td>

                    <td>
                      {typeLabels[transaction.type]}
                    </td>

                    <td>
                      {
                        categoryLabels[
                          transaction.category
                        ]
                      }
                    </td>

                    <td>
                      {transaction.description ?? '—'}
                    </td>

                    <td>
                      {
                        paymentMethodLabels[
                          transaction.paymentMethod
                        ]
                      }
                    </td>

                    <td>
                      {formatAmount(
                        transaction.amount,
                      )}{' '}
                      SAR
                    </td>

                    <td>
                      {
                        statusLabels[
                          transaction.status
                        ]
                      }
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
