import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import { SaleValidationError } from '@madina/core'
import { useProducts } from '../../context/useProducts'
import { useSales } from '../../context/useSales'
import { useToast } from '../../context/ToastProvider'

export function SaleDetails() {
  const { saleId } = useParams()
  const navigate = useNavigate()

  const {
    sales,
    completeSale,
    cancelSale,
  } = useSales()

  const { products } = useProducts()

  const { showToast } = useToast()

  const [isCancelConfirmOpen, setIsCancelConfirmOpen] =
    useState(false)

  const sale = sales.find(
    (item) => item.id === saleId,
  )

  if (!sale) {
    return (
      <section>
        <h1>Продажа не найдена</h1>

        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate('/sales')}
        >
          ← Назад к продажам
        </Button>
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
    try {
      const result = completeSale(saleIdValue)

      if (!result.success) {
        showToast({
          variant: 'error',
          title: 'Ошибка',
          message:
            result.message ??
            'Не удалось завершить продажу.',
        })
        return
      }

      showToast({
        variant: 'success',
        title: 'Продажа завершена',
      })

    } catch (error) {
      if (error instanceof SaleValidationError) {
        showToast({
          variant: 'error',
          title: 'Ошибка',
          message: error.message,
        })
        return
      }

      throw error
    }
  }

  function handleCancel() {
    cancelSale(saleIdValue)

    showToast({
      variant: 'warning',
      title: 'Продажа отменена',
    })
  }

  return (
    <section>
      <Button
        type="button"
        variant="secondary"
        onClick={() => navigate('/sales')}
      >
        ← Назад к продажам
      </Button>

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

      {isDraft && (
        <div>
          <Button
            type="button"
            variant="primary"
            onClick={handleComplete}
          >
            Завершить продажу
          </Button>

          <Button
            type="button"
            variant="danger"
            onClick={() => setIsCancelConfirmOpen(true)}
          >
            Отменить продажу
          </Button>
        </div>
      )}

      <h2>Товары</h2>

      <Table>
        <TableHead>
          <TableRow>
            <TableHeader>Товар</TableHeader>
            <TableHeader>Количество</TableHeader>
            <TableHeader>Единица</TableHeader>
            <TableHeader>Цена</TableHeader>
            <TableHeader>Сумма</TableHeader>
          </TableRow>
        </TableHead>

        <TableBody>
          {sale.items.map((item) => {
            const product = products.find(
              (currentProduct) =>
                currentProduct.id === item.productId,
            )

            return (
              <TableRow key={item.productId}>
                <TableCell>
                  {product?.name ?? item.productId}
                </TableCell>

                <TableCell>
                  {item.quantity}
                </TableCell>

                <TableCell>
                  {item.unit}
                </TableCell>

                <TableCell>
                  {item.unitPrice.toLocaleString('ru-RU')} SAR
                </TableCell>

                <TableCell>
                  {item.totalAmount.toLocaleString('ru-RU')} SAR
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <h2>
        Итого:{' '}
        {sale.totalAmount.toLocaleString('ru-RU')} SAR
      </h2>

      {isCancelConfirmOpen && (
        <ConfirmDialog
          open={isCancelConfirmOpen}
          onClose={() => setIsCancelConfirmOpen(false)}
          title="Отмена продажи"
          description="Вы действительно хотите отменить эту продажу?"
          confirmLabel="Отменить продажу"
          cancelLabel="Назад"
          variant="danger"
          onConfirm={() => {
            handleCancel()
            setIsCancelConfirmOpen(false)
          }}
        />
      )}

    </section>
  )
}
