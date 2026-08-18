import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getCompletedTransactions,
  getCurrentStockByUnit,
  getFinancialKpis,
  getInventoryProductSummary,
  getRecentTransactions,
  getSalesReportingSummary,
} from '@madina/core'

import { Button } from '@madina/ui'
import { useProducts } from '../../context/useProducts'
import { useSales } from '../../context/useSales'
import { useTransactions } from '../../context/useTransactions'
import './Dashboard.css'

export function Dashboard() {
  const navigate = useNavigate()

  const { products } = useProducts()
  const { sales } = useSales()
  const { transactions } = useTransactions()

  const salesSummary = useMemo(
    () => getSalesReportingSummary(sales, 'all'),
    [sales],
  )

  const financialKpis = useMemo(
    () => getFinancialKpis(transactions, 'all'),
    [transactions],
  )

  const {
    totalIncome,
    totalExpense,
    financialBalance,
  } = financialKpis

  const { completedCount: salesCount } = salesSummary

  const { productCount: warehouseProductsCount } = useMemo(
    () => getInventoryProductSummary(products),
    [products],
  )

  const stockByUnit = useMemo(
    () => getCurrentStockByUnit(products),
    [products],
  )

  const completedTransactions = useMemo(
    () => getCompletedTransactions(transactions),
    [transactions],
  )

  const recentTransactions = useMemo(
    () =>
      getRecentTransactions(
        completedTransactions,
        5,
      ),
    [completedTransactions],
  )

  function formatMoney(value: number) {
    return `${value.toLocaleString('ru-RU')} SAR`
  }

  function formatDate(date: Date) {
    return date.toLocaleDateString('ru-RU')
  }

  function formatStockByUnit() {
    if (stockByUnit.length === 0) {
      return 'Нет остатков'
    }

    return stockByUnit
      .map(({ quantity, unit }) =>
        `${quantity.toLocaleString('ru-RU')} ${unit}`,
      )
      .join(', ')
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
            Завершённые продажи
          </span>

          <strong className="dashboard__card-value">
            {salesCount}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Общий доход
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(totalIncome)}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Общие расходы
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(totalExpense)}
          </strong>
        </article>

        <article className="dashboard__card">
          <span className="dashboard__card-label">
            Финансовый результат
          </span>

          <strong className="dashboard__card-value">
            {formatMoney(financialBalance)}
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
            Остатки на складе
          </span>

          <strong className="dashboard__card-value">
            {formatStockByUnit()}
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
            <Button
              type="button"
              variant="secondary"
              fullWidth
              className="dashboard__quick-action"
              onClick={() => navigate('/sales')}
            >
              Новая продажа
            </Button>

            <Button
              type="button"
              variant="secondary"
              fullWidth
              className="dashboard__quick-action"
              onClick={() => navigate('/purchases')}
            >
              Добавить поступление
            </Button>

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
          Остатки по единицам:{' '}
          <strong>
            {formatStockByUnit()}
          </strong>
        </p>
      </section>
    </section>
  )
}
