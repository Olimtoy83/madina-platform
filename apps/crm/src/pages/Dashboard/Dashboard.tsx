import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCompletedTransactions,
  getCompletedSales,
  getTransactionTotals,
} from '@madina/core'
import { useProducts } from '../../context/useProducts'
import { useSales } from '../../context/useSales'
import { useTransactions } from '../../context/useTransactions'
import './Dashboard.css'

export function Dashboard() {
  const navigate = useNavigate()

  const { products } = useProducts()
  const { sales } = useSales()
  const { transactions } = useTransactions()

  const completedSales = useMemo(
    () => getCompletedSales(sales),
    [sales],
  )

  const transactionTotals = useMemo(
    () => getTransactionTotals(transactions),
    [transactions],
  )

  const {
    income,
    expense: expenses,
    balance: profit,
  } = transactionTotals

  const salesCount = completedSales.length

  const warehouseProductsCount =
    products.length

  const warehouseQuantity = useMemo(
    () =>
      products.reduce(
        (sum, product) =>
          sum + product.quantity,
        0,
      ),
    [products],
  )

  const completedTransactions = useMemo(
    () => getCompletedTransactions(transactions),
    [transactions],
  )

  const recentTransactions = useMemo(
    () =>
      [...completedTransactions]
        .sort(
          (first, second) =>
            second.transactionDate.getTime() -
            first.transactionDate.getTime(),
        )
        .slice(0, 5),
    [completedTransactions],
  )

  function formatMoney(value: number) {
    return `${value.toLocaleString('ru-RU')} SAR`
  }

  function formatDate(date: Date) {
    return date.toLocaleDateString('ru-RU')
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

      <div className="dashboard__kpi-grid">
        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Продажи
          </span>

          <strong className="dashboard__card-value">
            {salesCount}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Доход
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(income)}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Расходы
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(expenses)}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Прибыль
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(profit)}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Товарных позиций
          </span>

          <strong className="dashboard__card-value">
            {warehouseProductsCount}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Единиц на складе
          </span>

          <strong className="dashboard__card-value">
            {warehouseQuantity}
          </strong>
        </article>
      </div>

      <div className="dashboard__sections">
        <section className="dashboard__section">
          <div className="dashboard__section-header">
            <h3>Последние операции</h3>
          </div>

          {recentTransactions.length === 0 ? (
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
        </section>

        <section className="dashboard__section">
          <div className="dashboard__section-header">
            <h3>Быстрые действия</h3>
          </div>

          <div className="dashboard__quick-actions">
            <button
              type="button"
              onClick={() =>
                navigate('/sales')
              }
            >
              Новая продажа
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/purchases')
              }
            >
              Добавить поступление
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/warehouse')
              }
            >
              Открыть склад
            </button>
          </div>
        </section>
      </div>

      <section className="dashboard__section">
        <div className="dashboard__section-header">
          <h3>Склад</h3>
        </div>

        <p>
          Товарных позиций:{' '}
          <strong>
            {warehouseProductsCount}
          </strong>
        </p>

        <p>
          Общее количество единиц товара:{' '}
          <strong>
            {warehouseQuantity}
          </strong>
        </p>
      </section>
    </section>
  )
}