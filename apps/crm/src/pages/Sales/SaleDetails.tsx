import { useEffect, useRef, useState } from 'react'
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
import { useProducts } from '../../context/useProducts'
import { useSalesMutations } from '../../context/useSalesMutations'
import { useTransactionalState } from '../../context/useTransactionalState'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import { getSaleById } from '../../shared/api/commerceApi'
import { HttpError } from '../../shared/api/httpClient'
import type { Sale } from '@madina/core'

export function SaleDetails() {
  const { saleId } = useParams()
  const navigate = useNavigate()

  const {
    completeSale,
    cancelSale,
  } = useSalesMutations()
  const { snapshot } = useTransactionalState()

  const { products } = useProducts()

  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()

  const [isCancelConfirmOpen, setIsCancelConfirmOpen] =
    useState(false)

  const [sale, setSale] = useState<Sale | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isNotFound, setIsNotFound] = useState(false)
  const requestGeneration = useRef(0)

  useEffect(() => {
    if (!saleId) return
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setIsLoading(true)
    setLoadError(null)
    setIsNotFound(false)
    void getSaleById(saleId)
      .then((response) => {
        if (requestGeneration.current !== generation) return
        setSale(response)
      })
      .catch((error: unknown) => {
        if (requestGeneration.current !== generation) return
        setSale(null)
        if (error instanceof HttpError && error.status === 404) setIsNotFound(true)
        else setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить продажу.')
      })
      .finally(() => {
        if (requestGeneration.current === generation) setIsLoading(false)
      })
  }, [saleId, snapshot])

  if (isLoading) return <section><h1>Загрузка продажи…</h1></section>

  if (!sale || isNotFound) {
    return (
      <section>
        <h1>{loadError ? 'Не удалось загрузить продажу' : 'Продажа не найдена'}</h1>

        {loadError && <p>{loadError}</p>}

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

  async function handleComplete() {
    const command = await run(
      `sale.complete:${saleIdValue}`,
      () => completeSale(saleIdValue),
    )

    if (!command.started || !command.value) {
      return false
    }

    const result = command.value

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Ошибка',
        message: result.message ?? 'Не удалось завершить продажу.',
      })
      return false
    }

    showToast({
      variant: 'success',
      title: 'Продажа завершена',
    })
  }

  async function handleCancel(): Promise<boolean> {
    const command = await run(
      `sale.cancel:${saleIdValue}`,
      () => cancelSale(saleIdValue),
    )

    if (!command.started || !command.value) {
      return false
    }

    const result = command.value

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось отменить продажу',
        message:
          result.message ??
          'Не удалось сохранить изменение продажи.',
      })

      return false
    }

    showToast({
      variant: 'warning',
      title: 'Продажа отменена',
    })

    return true
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
            disabled={isPending(`sale.complete:${saleIdValue}`)}
          >
            {isPending(`sale.complete:${saleIdValue}`)
              ? 'Завершение…'
              : 'Завершить продажу'}
          </Button>

          <Button
            type="button"
            variant="danger"
            onClick={() => setIsCancelConfirmOpen(true)}
            disabled={isPending(`sale.complete:${saleIdValue}`)}
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
          loading={isPending(`sale.cancel:${saleIdValue}`)}
          onConfirm={async () => {
            const cancelled = await handleCancel()
            if (cancelled) {
              setIsCancelConfirmOpen(false)
            }
          }}
        />
      )}

    </section>
  )
}
