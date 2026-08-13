import { useMemo, useState } from 'react'
import { useStockMovements } from '../../context/useStockMovements'
import { useProducts } from '../../context/useProducts'

import './StockMovements.css'

type MovementFilter =
  | 'all'
  | 'purchase'
  | 'sale'
  | 'adjustment'

const movementTypeLabels: Record<MovementFilter, string> = {
  all: 'Все',
  purchase: 'Приход',
  sale: 'Продажа',
  adjustment: 'Корректировка',
}

const unitLabels: Record<string, string> = {
  kg: 'кг',
  piece: 'шт.',
  liter: 'л',
  box: 'кор.',
}

export function StockMovements() {
  const { movements } = useStockMovements()
  const { products } = useProducts()

  const [typeFilter, setTypeFilter] =
    useState<MovementFilter>('all')

  const [productFilter, setProductFilter] =
    useState('all')

  const [dateFrom, setDateFrom] =
    useState('')

  const [dateTo, setDateTo] =
    useState('')

  const filteredMovements = useMemo(() => {
    return movements.filter((movement) => {
      const matchesType =
        typeFilter === 'all' ||
        movement.type === typeFilter

      const matchesProduct =
        productFilter === 'all' ||
        movement.productId === productFilter

      const movementDate =
        movement.createdAt.getTime()

      const matchesDateFrom =
        !dateFrom ||
        movementDate >=
        new Date(
          `${dateFrom}T00:00:00`,
        ).getTime()

      const matchesDateTo =
        !dateTo ||
        movementDate <=
        new Date(
          `${dateTo}T23:59:59.999`,
        ).getTime()

      return (
        matchesType &&
        matchesProduct &&
        matchesDateFrom &&
        matchesDateTo
      )
    })
  }, [
    movements,
    typeFilter,
    productFilter,
    dateFrom,
    dateTo,
  ])

  const totalPurchases = movements
    .filter(
      (movement) =>
        movement.type === 'purchase',
    )
    .reduce(
      (total, movement) =>
        total + movement.quantity,
      0,
    )

  const totalSales = movements
    .filter(
      (movement) =>
        movement.type === 'sale',
    )
    .reduce(
      (total, movement) =>
        total + movement.quantity,
      0,
    )

  function getMovementType(
    type: string,
  ) {
    if (type === 'purchase') {
      return 'Приход'
    }

    if (type === 'sale') {
      return 'Продажа'
    }

    return 'Корректировка'
  }

  function getMovementTypeClass(
    type: string,
  ) {
    if (type === 'purchase') {
      return 'stock-movements__badge stock-movements__badge--income'
    }

    if (type === 'sale') {
      return 'stock-movements__badge stock-movements__badge--expense'
    }

    return 'stock-movements__badge stock-movements__badge--adjustment'
  }

  function getUnitLabel(unit: string) {
    return unitLabels[unit] ?? unit
  }

  return (
    <section className="stock-movements">
      <div className="stock-movements__header">
        <div>
          <h1>Движение склада</h1>

          <p>
            История поступлений, продаж и
            корректировок товаров.
          </p>
        </div>
      </div>

      <div className="stock-movements__summary">
        <div className="stock-movements__summary-card">
          <span>Всего движений</span>

          <strong>
            {movements.length}
          </strong>
        </div>

        <div className="stock-movements__summary-card stock-movements__summary-card--income">
          <span>Приход</span>

          <strong>
            {totalPurchases}
          </strong>
        </div>

        <div className="stock-movements__summary-card stock-movements__summary-card--expense">
          <span>Расход</span>

          <strong>
            {totalSales}
          </strong>
        </div>
      </div>

      <div className="stock-movements__filters">
        <div className="stock-movements__filter">
          <label htmlFor="movement-type">
            Тип движения
          </label>

          <select
            id="movement-type"
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value as MovementFilter,
              )
            }
          >
            {(
              Object.entries(
                movementTypeLabels,
              ) as [
                MovementFilter,
                string,
              ][]
            ).map(([value, label]) => (
              <option
                key={value}
                value={value}
              >
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="stock-movements__filter">
          <label htmlFor="movement-product">
            Товар
          </label>

          <select
            id="movement-product"
            value={productFilter}
            onChange={(event) =>
              setProductFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              Все товары
            </option>

            {products.map((product) => (
              <option
                key={product.id}
                value={product.id}
              >
                {product.name}
              </option>
            ))}
          </select>
        </div>

        <div className="stock-movements__filter">
          <label htmlFor="movement-date-from">
            Дата от
          </label>

          <input
            id="movement-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) =>
              setDateFrom(
                event.target.value,
              )
            }
          />
        </div>

        <div className="stock-movements__filter">
          <label htmlFor="movement-date-to">
            Дата до
          </label>

          <input
            id="movement-date-to"
            type="date"
            value={dateTo}
            onChange={(event) =>
              setDateTo(
                event.target.value,
              )
            }
          />
        </div>
      </div>

      <div className="stock-movements__table-card">
        <div className="stock-movements__table-header">
          <div>
            <h2>История движений</h2>

            <p>
              Найдено:{' '}
              {filteredMovements.length}
            </p>
          </div>
        </div>

        {filteredMovements.length === 0 ? (
          <div className="stock-movements__empty">
            Движений по выбранному фильтру
            нет.
          </div>
        ) : (
          <div className="stock-movements__table-wrapper">
            <table className="stock-movements__table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Товар</th>
                  <th>Количество</th>
                  <th>Единица</th>
                  <th>Основание</th>
                </tr>
              </thead>

              <tbody>
                {filteredMovements.map(
                  (movement) => {
                    const product =
                      products.find(
                        (item) =>
                          item.id ===
                          movement.productId,
                      )

                    return (
                      <tr
                        key={movement.id}
                      >
                        <td>
                          {movement.createdAt.toLocaleDateString(
                            'ru-RU',
                          )}
                        </td>

                        <td>
                          <span
                            className={getMovementTypeClass(
                              movement.type,
                            )}
                          >
                            {getMovementType(
                              movement.type,
                            )}
                          </span>
                        </td>

                        <td>
                          <span className="stock-movements__product-name">
                            {product?.name ??
                              movement.productId}
                          </span>
                        </td>

                        <td>
                          <strong
                            className={
                              movement.type ===
                                'sale'
                                ? 'stock-movements__quantity stock-movements__quantity--expense'
                                : 'stock-movements__quantity stock-movements__quantity--income'
                            }
                          >
                            {movement.type ===
                              'sale'
                              ? `-${movement.quantity}`
                              : `+${movement.quantity}`}
                          </strong>
                        </td>

                        <td>
                          {getUnitLabel(
                            movement.unit,
                          )}
                        </td>

                        <td>
                          <span className="stock-movements__reference">
                            {movement.note ??
                              movement.referenceId ??
                              '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}