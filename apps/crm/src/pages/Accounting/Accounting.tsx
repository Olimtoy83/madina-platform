import { useMemo, useState } from 'react'
import { useTransactions } from '../../context/useTransactions'
import {
  calculateCategoryTotals,
  filterTransactions,
  getTransactionTotals,
  type Transaction,
  type TransactionPeriod,
} from '@madina/core'
import { Select } from '@madina/ui'

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
    useState<TransactionPeriod>('all')

  const [typeFilter, setTypeFilter] =
    useState<TypeFilter>('all')

  const filteredTransactions = useMemo(
    () =>
      filterTransactions(
        transactions,
        {
          period,
          type:
            typeFilter === 'all'
              ? undefined
              : typeFilter,
          status: 'completed',
        },
      ),
    [transactions, period, typeFilter],
  )

  const {
    income: totalIncome,
    expense: totalExpense,
    balance,
  } = useMemo(
    () =>
      getTransactionTotals(
        filteredTransactions,
      ),
    [filteredTransactions],
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
                event.target.value as TransactionPeriod
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
        <article className="accounting-card">
          <span>Доход</span>
          <strong className="accounting-card__income">
            +{formatAmount(totalIncome)}
          </strong>
        </article>

        <article className="accounting-card">
          <span>Расход</span>
          <strong className="accounting-card__expense">
            -{formatAmount(totalExpense)}
          </strong>
        </article>

        <article className="accounting-card">
          <span>Чистый результат</span>
          <strong>
            {formatAmount(balance)}
          </strong>
        </article>

        <article className="accounting-card">
          <span>Операций</span>
          <strong>
            {filteredTransactions.length}
          </strong>
        </article>
      </div>

      <div className="accounting-grid">
        <section className="accounting-panel">
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
        </section>

        <section className="accounting-panel">
          <div className="accounting-panel__header">
            <h2>Финансовый результат</h2>
          </div>

          <div className="accounting-result">
            <span>
              Доход − Расход
            </span>

            <strong>
              {formatAmount(balance)}
            </strong>
          </div>
        </section>
      </div>

      <section className="accounting-panel accounting-panel--table">
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
            <table className="accounting-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Оплата</th>
                  <th>Сумма</th>
                </tr>
              </thead>

              <tbody>
                {filteredTransactions.map(
                  (transaction) => {
                    const isIncome =
                      transaction.type ===
                      'income'

                    return (
                      <tr key={transaction.id}>
                        <td>
                          {formatDate(
                            transaction.transactionDate,
                          )}
                        </td>

                        <td>
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
                          {
                            paymentMethodLabels[
                            transaction.paymentMethod
                            ]
                          }
                        </td>

                        <td>
                          <strong
                            className={
                              isIncome
                                ? 'accounting-amount accounting-amount--income'
                                : 'accounting-amount accounting-amount--expense'
                            }
                          >
                            {isIncome
                              ? '+'
                              : '-'}
                            {formatAmount(
                              transaction.amount,
                            )}
                          </strong>
                        </td>
                      </tr>
                    )
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
