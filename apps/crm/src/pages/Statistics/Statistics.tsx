import { useMemo, useState } from 'react'
import {
  calculateCategoryTotals,
  getCurrentStockByUnit,
  getFinancialKpis,
  getInventoryProductSummary,
  getPurchasesReportingSummary,
  getReportingEligibleTransactions,
  getSalesReportingSummary,
  getTaskStats,
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
import { useProducts } from '../../context/useProducts'
import { usePurchases } from '../../context/usePurchases'
import { useSales } from '../../context/useSales'
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
  const { sales } = useSales()
  const { purchases } = usePurchases()
  const { tasks } = useTasks()

  const [period, setPeriod] =
    useState<PresetReportingPeriod>('all')

  const eligibleTransactions = useMemo(
    () => getReportingEligibleTransactions(transactions, period),
    [transactions, period],
  )

  const financialKpis = useMemo(
    () => getFinancialKpis(transactions, period),
    [transactions, period],
  )

  const {
    totalIncome,
    totalExpense,
    financialBalance,
  } = financialKpis

  const salesSummary = useMemo(
    () => getSalesReportingSummary(sales, period),
    [sales, period],
  )

  const purchasesSummary = useMemo(
    () => getPurchasesReportingSummary(purchases, period),
    [purchases, period],
  )

  const productSummary = useMemo(
    () => getInventoryProductSummary(products),
    [products],
  )

  const stockByUnit = useMemo(
    () => getCurrentStockByUnit(products),
    [products],
  )

  const categoryTotals = useMemo(
    () =>
      calculateCategoryTotals(
        eligibleTransactions,
      ),
    [eligibleTransactions],
  )

  const taskStats = useMemo(
    () => getTaskStats(tasks),
    [tasks],
  )

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
              event.target.value as PresetReportingPeriod,
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
        <Card className="statistics-card">
          <span>Завершённые продажи</span>
          <strong>{salesSummary.completedCount}</strong>
        </Card>

        <Card className="statistics-card">
          <span>Общий доход</span>
          <strong>
            {formatAmount(totalIncome)} SAR
          </strong>
        </Card>

        <Card className="statistics-card">
          <span>Общие расходы</span>
          <strong>
            {formatAmount(totalExpense)} SAR
          </strong>
        </Card>

        <Card className="statistics-card">
          <span>Финансовый результат</span>
          <strong>
            {formatAmount(financialBalance)} SAR
          </strong>
        </Card>

        <Card className="statistics-card">
          <span>Завершённые поступления</span>
          <strong>
            {purchasesSummary.completedCount}
          </strong>
        </Card>

        <Card className="statistics-card">
          <span>Товарных позиций</span>
          <strong>{productSummary.productCount}</strong>
        </Card>

        <Card className="statistics-card">
          <span>Остатки на складе</span>
          <strong title={formatStockByUnit()}>
            {formatStockByUnit()}
          </strong>
        </Card>
      </div>

      <div className="statistics-page__grid">
        <Card className="statistics-panel">
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
        </Card>

        <Card className="statistics-panel">
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
        </Card>
      </div>

      <Card className="statistics-panel statistics-panel--table">
        <div className="statistics-panel__header">
          <div>
            <h2>Финансовые операции</h2>

            <span>
              {eligibleTransactions.length}{' '}
              операций
            </span>
          </div>
        </div>

        {eligibleTransactions.length === 0 ? (
          <div className="statistics-empty">
            Операций за выбранный период нет.
          </div>
        ) : (
          <div className="statistics-table-wrapper">
            <Table className="statistics-table">
              <TableHead>
                <TableRow>
                  <TableHeader>Дата</TableHeader>
                  <TableHeader>Тип</TableHeader>
                  <TableHeader>Категория</TableHeader>
                  <TableHeader>Описание</TableHeader>
                  <TableHeader>Сумма</TableHeader>
                </TableRow>
              </TableHead>

              <TableBody>
                {eligibleTransactions.map(
                  (transaction) => (
                    <TableRow
                      key={transaction.id}
                    >
                      <TableCell>
                        {new Date(
                          transaction.transactionDate,
                        ).toLocaleDateString(
                          'ru-RU',
                        )}
                      </TableCell>

                      <TableCell>
                        {transaction.type === 'income'
                          ? 'Доход'
                          : 'Расход'}
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
                        {formatAmount(
                          transaction.amount,
                        )}{' '}
                        SAR
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  )
}
