import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProducts } from '../../context/useProducts'
import { useSales } from '../../context/useSales'

export function SaleDetails() {
  const { saleId } = useParams()
  const navigate = useNavigate()

  const {
    sales,
    completeSale,
    cancelSale,
  } = useSales()

  const { products } = useProducts()

  const [actionMessage, setActionMessage] =
    useState<string | null>(null)

  const sale = sales.find(
    (item) => item.id === saleId,
  )

  if (!sale) {
    return (
      <section>
        <h1>Продажа не найдена</h1>

        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/sales')}
        >
          ← Назад к продажам
        </button>
      </section>
    )
  }

  const saleIdValue = sale.id
  const isDraft = sale.status === 'draft'

  const paymentMethodLabels = {
    cash: 'Наличные',
    card: 'Банковская карта',
    'bank-transfer': 'Банковский перевод',
    other: 'Другое',
  }

  function handleComplete() {
    const result = completeSale(saleIdValue)

    if (!result.success) {
      setActionMessage(
        result.message ?? 'Не удалось завершить продажу.',
      )
      return
    }

    setActionMessage(null)
  }

  function handleCancel() {
    cancelSale(saleIdValue)
  }

  return (
    <section>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => navigate('/sales')}
      >
        ← Назад к продажам
      </button>

      <h1>Продажа {sale.saleNumber}</h1>

      <p>Клиент: {sale.clientName}</p>

      <p>
        Дата:{' '}
        {sale.saleDate.toLocaleDateString('ru-RU')}
      </p>

      <p>
        Способ оплаты:{' '}
        {paymentMethodLabels[sale.paymentMethod]}
      </p>

      <p>
        Статус:{' '}
        {sale.status === 'draft'
          ? 'Черновик'
          : sale.status === 'completed'
            ? 'Завершено'
            : 'Отменено'}
      </p>

      {actionMessage && (
        <p>
          {actionMessage}
        </p>
      )}

      {isDraft && (
        <div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleComplete}
          >
            Завершить продажу
          </button>

          <button
            type="button"
            className="btn-danger"
            onClick={handleCancel}
          >
            Отменить продажу
          </button>
        </div>
      )}

      <h2>Товары</h2>

      <table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Количество</th>
            <th>Единица</th>
            <th>Цена</th>
            <th>Сумма</th>
          </tr>
        </thead>

        <tbody>
          {sale.items.map((item) => {
            const product = products.find(
              (currentProduct) =>
                currentProduct.id === item.productId,
            )

            return (
              <tr key={item.productId}>
                <td>
                  {product?.name ?? item.productId}
                </td>

                <td>{item.quantity}</td>

                <td>{item.unit}</td>

                <td>
                  {item.unitPrice.toLocaleString('ru-RU')} SAR
                </td>

                <td>
                  {item.totalAmount.toLocaleString('ru-RU')} SAR
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2>
        Итого:{' '}
        {sale.totalAmount.toLocaleString('ru-RU')} SAR
      </h2>
    </section>
  )
}
