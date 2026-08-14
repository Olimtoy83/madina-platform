import { useMemo, useState } from 'react'
import { useProducts } from '../../context/useProducts'
import { useTasks } from '../../context/useTasks'
import { useTransactions } from '../../context/useTransactions'
import type { Transaction } from '@madina/core'
import type { TaskStatus } from '@madina/core'

import './Statistics.css'

type Period =
  | 'all'
  | 'today'
  | '7days'
  | 'month'

function isWithinPeriod(
  date: Date,
  period: Period,
) {
  if (period === 'all') {
    return true
  }

  const transactionDate = new Date(date)
  const now = new Date()

  if (period === 'today') {
    return (
      transactionDate.getFullYear() ===
        now.getFullYear() &&
      transactionDate.getMonth() ===
        now.getMonth() &&
      transactionDate.getDate() ===
        now.getDate()
    )
  }

  if (period === '7days') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)

    return transactionDate >= start
  }

  if (period === 'month') {
    return (
      transactionDate.getFullYear() ===
        now.getFullYear() &&
      transactionDate.getMonth() ===
        now.getMonth()
    )
  }

  return true
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const categoryLabels: Record<
  Transaction['category'],
  string
> = {
  sale: 'Продажи',
  purchase: 'Поступления',
  other: 'Другое',
}

export function Statistics() {
  const { transactions } = useTransactions()
  const { products } = useProducts()
  const { tasks } = useTasks()

  const [period, setPeriod] =
    useState<Period>('all')

  const filteredTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          transaction.status === 'completed' &&
          isWithinPeriod(
            transaction.transactionDate,
            period,
          ),
      ),
    [transactions, period],
  )

  const totalIncome = useMemo(
    () =>
      filteredTransactions
        .filter(
          (transaction) =>
            transaction.type === 'income',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),
    [filteredTransactions],
  )

  const totalExpense = useMemo(
    () =>
      filteredTransactions
        .filter(
          (transaction) =>
            transaction.type === 'expense',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),
    [filteredTransactions],
  )

  const profit =
    totalIncome - totalExpense

  const salesCount = filteredTransactions.filter(
    (transaction) =>
      transaction.type === 'income' &&
      transaction.category === 'sale',
  ).length

  const purchasesCount =
    filteredTransactions.filter(
      (transaction) =>
        transaction.type === 'expense' &&
        transaction.category === 'purchase',
    ).length

  const warehouseQuantity = products.reduce(
    (total, product) =>
      total + product.quantity,
    0,
  )

  const categoryTotals = useMemo(
    () => ({
      sale: filteredTransactions
        .filter(
          (transaction) =>
            transaction.category === 'sale',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),

      purchase: filteredTransactions
        .filter(
          (transaction) =>
            transaction.category === 'purchase',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),

      other: filteredTransactions
        .filter(
          (transaction) =>
            transaction.category === 'other',
        )
        .reduce(
          (total, transaction) =>
            total + transaction.amount,
          0,
        ),
    }),
    [filteredTransactions],
  )

  const taskStats = useMemo(
    () => ({
      total: tasks.length,

      todo: tasks.filter(
        (task) =>
          task.status ===
          ('todo' as TaskStatus),
      ).length,

      inProgress: tasks.filter(
        (task) =>
          task.status ===
          ('in-progress' as TaskStatus),
      ).length,

      completed: tasks.filter(
        (task) =>
          task.status ===
          ('completed' as TaskStatus),
      ).length,
    }),
    [tasks],
  )

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

        <select
          className="statistics-page__period"
          value={period}
          onChange={(event) =>
            setPeriod(
              event.target.value as Period,
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
        </select>
      </header>

      <div className="statistics-page__summary">
        <article className="statistics-card">
          <span>Продажи</span>
          <strong>{salesCount}</strong>
        </article>

        <article className="statistics-card">
          <span>Доход</span>
          <strong>
            {formatAmount(totalIncome)} SAR
          </strong>
        </article>

        <article className="statistics-card">
          <span>Расход</span>
          <strong>
            {formatAmount(totalExpense)} SAR
          </strong>
        </article>

        <article className="statistics-card">
          <span>Результат</span>
          <strong>
            {formatAmount(profit)} SAR
          </strong>
        </article>

        <article className="statistics-card">
          <span>Поступления</span>
          <strong>{purchasesCount}</strong>
        </article>

        <article className="statistics-card">
          <span>Товаров на складе</span>
          <strong>{warehouseQuantity}</strong>
        </article>
      </div>

      <div className="statistics-page__grid">
        <section className="statistics-panel">
          <div className="statistics-panel__header">
            <h2>Финансы по категориям</h2>
          </div>

          <div className="statistics-list">
            <div>
              <span>
                {categoryLabels.sale}
              </span>

              <strong>
                {formatAmount(
                  categoryTotals.sale,
                )}{' '}
                SAR
              </strong>
            </div>

            <div>
              <span>
                {categoryLabels.purchase}
              </span>

              <strong>
                {formatAmount(
                  categoryTotals.purchase,
                )}{' '}
                SAR
              </strong>
            </div>

            <div>
              <span>
                {categoryLabels.other}
              </span>

              <strong>
                {formatAmount(
                  categoryTotals.other,
                )}{' '}
                SAR
              </strong>
            </div>
          </div>
        </section>

        <section className="statistics-panel">
          <div className="statistics-panel__header">
            <h2>Задачи</h2>
          </div>

          <div className="statistics-list">
            <div>
              <span>Всего</span>
              <strong>
                {taskStats.total}
              </strong>
            </div>

            <div>
              <span>К выполнению</span>
              <strong>
                {taskStats.todo}
              </strong>
            </div>

            <div>
              <span>В работе</span>
              <strong>
                {taskStats.inProgress}
              </strong>
            </div>

            <div>
              <span>Завершено</span>
              <strong>
                {taskStats.completed}
              </strong>
            </div>
          </div>
        </section>
      </div>

      <section className="statistics-panel statistics-panel--table">
        <div className="statistics-panel__header">
          <div>
            <h2>Финансовые операции</h2>

            <span>
              {filteredTransactions.length}{' '}
              операций
            </span>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="statistics-empty">
            Операций за выбранный период нет.
          </div>
        ) : (
          <div className="statistics-table-wrapper">
            <table className="statistics-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Сумма</th>
                </tr>
              </thead>

              <tbody>
                {filteredTransactions.map(
                  (transaction) => (
                    <tr
                      key={transaction.id}
                    >
                      <td>
                        {new Date(
                          transaction.transactionDate,
                        ).toLocaleDateString(
                          'ru-RU',
                        )}
                      </td>

                      <td>
                        {transaction.type ===
                        'income'
                          ? 'Доход'
                          : 'Расход'}
                      </td>

                      <td>
                        {
                          categoryLabels[
                            transaction.category
                          ]
                        }
                      </td>

                      <td>
                        {transaction.description ??
                          '—'}
                      </td>

                      <td>
                        {formatAmount(
                          transaction.amount,
                        )}{' '}
                        SAR
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
