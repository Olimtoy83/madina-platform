import { useMemo, useState } from 'react'
import {
  calculateCategoryCounts,
  calculateCategoryTotals,
  filterTransactions,
  getTaskStats,
  getTotalStockQuantity,
  getTransactionTotals,
  type Transaction,
  type TransactionPeriod,
} from '@madina/core'

import { Select } from '@madina/ui'
import { useProducts } from '../../context/useProducts'
import { useTasks } from '../../context/useTasks'
import { useTransactions } from '../../context/useTransactions'

import './Statistics.css'

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
    useState<TransactionPeriod>('all')

  const filteredTransactions = useMemo(
    () =>
      filterTransactions(
        transactions,
        {
          status: 'completed',
          period,
        },
      ),
    [transactions, period],
  )

  const transactionTotals = useMemo(
    () =>
      getTransactionTotals(
        filteredTransactions,
      ),
    [filteredTransactions],
  )

  const {
    income: totalIncome,
    expense: totalExpense,
    balance: profit,
  } = transactionTotals

  const {
    sales: salesCount,
    purchases: purchasesCount,
  } =
    calculateCategoryCounts(
      filteredTransactions,
    )

  const warehouseQuantity =
    getTotalStockQuantity(products)

  const categoryTotals = useMemo(
    () =>
      calculateCategoryTotals(
        filteredTransactions,
      ),
    [filteredTransactions],
  )

  const taskStats = useMemo(
    () => getTaskStats(tasks),
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

        <Select
          className="statistics-page__period"
          value={period}
          onChange={(event) =>
            setPeriod(
              event.target.value as TransactionPeriod,
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
