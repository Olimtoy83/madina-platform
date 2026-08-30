import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'
import type { PaymentMethod, Sale } from '@madina/core'
import { useProducts } from '../../context/useProducts'
import { useSalesMutations } from '../../context/useSalesMutations'
import { useTransactionalState } from '../../context/useTransactionalState'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import { usePermissions } from '../../context/usePermissions'
import { getSaleById } from '../../shared/api/commerceApi'
import { HttpError } from '../../shared/api/httpClient'

import './SaleDetails.css'

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  card: 'Банковская карта',
  'bank-transfer': 'Банковский перевод',
  other: 'Другое',
}

export function getSaleStatusLabel(status: Sale['status']): string {
  if (status === 'draft') return 'Черновик'
  if (status === 'completed') return 'Завершено'
  return 'Отменено'
}

export function getSaleStatusVariant(status: Sale['status']) {
  if (status === 'draft') return 'warning' as const
  if (status === 'completed') return 'success' as const
  return 'danger' as const
}

export function SaleDetails() {
  const { saleId } = useParams()
  const navigate = useNavigate()
  const { completeSale, cancelSale } = useSalesMutations()
  const { snapshot } = useTransactionalState()
  const { products } = useProducts()
  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()
  const { can } = usePermissions()
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false)
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

        if (error instanceof HttpError && error.status === 404) {
          setIsNotFound(true)
          return
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить продажу.',
        )
      })
      .finally(() => {
        if (requestGeneration.current === generation) {
          setIsLoading(false)
        }
      })
  }, [saleId, snapshot])

  if (isLoading) {
    return (
      <section className="sale-details" aria-busy="true">
        <div className="sale-details__header">
          <div>
            <Skeleton variant="text" width="11rem" />
            <Skeleton variant="text" width="16rem" />
          </div>
        </div>

        <Card className="sale-details__loading-card">
          <Skeleton variant="text" lines={4} />
        </Card>
      </section>
    )
  }

  if (!sale || isNotFound) {
    return (
      <section className="sale-details">
        <div className="sale-details__header">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/sales')}
          >
            ← Назад к продажам
          </Button>
        </div>

        <Card className="sale-details__state-card">
          {loadError ? (
            <Alert variant="danger" title="Не удалось загрузить продажу">
              {loadError}
            </Alert>
          ) : (
            <EmptyState
              title="Продажа не найдена"
              description="Возможно, она была удалена или больше недоступна."
            />
          )}
        </Card>
      </section>
    )
  }

  const saleIdValue = sale.id
  const isDraft = sale.status === 'draft'
  const completeCommandKey = `sale.complete:${saleIdValue}`
  const cancelCommandKey = `sale.cancel:${saleIdValue}`

  async function handleComplete() {
    const command = await run(
      completeCommandKey,
      () => completeSale(saleIdValue),
    )

    if (!command.started || !command.value) return

    if (!command.value.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось завершить продажу',
        message: command.value.message ?? 'Не удалось сохранить изменение продажи.',
      })
      return
    }

    showToast({ variant: 'success', title: 'Продажа завершена' })
  }

  async function handleCancel(): Promise<boolean> {
    const command = await run(
      cancelCommandKey,
      () => cancelSale(saleIdValue),
    )

    if (!command.started || !command.value) return false

    if (!command.value.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось отменить продажу',
        message: command.value.message ?? 'Не удалось сохранить изменение продажи.',
      })
      return false
    }

    showToast({ variant: 'warning', title: 'Продажа отменена' })
    return true
  }

  return (
    <section className="sale-details">
      <header className="sale-details__header">
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/sales')}
          >
            ← Назад к продажам
          </Button>

          <h1>Продажа {sale.saleNumber}</h1>
          <p>{sale.clientName}</p>
        </div>

        {isDraft && can('sales:write') && (
          <div className="sale-details__actions">
            <Button
              type="button"
              variant="primary"
              onClick={handleComplete}
              disabled={isPending(completeCommandKey)}
            >
              {isPending(completeCommandKey)
                ? 'Завершение…'
                : 'Завершить продажу'}
            </Button>

            <Button
              type="button"
              variant="danger"
              onClick={() => setIsCancelConfirmOpen(true)}
              disabled={
                isPending(completeCommandKey) ||
                isPending(cancelCommandKey)
              }
            >
              Отменить продажу
            </Button>
          </div>
        )}
      </header>

      <Card className="sale-details__summary-card" padding="none">
        <div className="sale-details__summary-item">
          <span>Дата</span>
          <strong>{sale.saleDate.toLocaleDateString('ru-RU')}</strong>
        </div>

        <div className="sale-details__summary-item">
          <span>Способ оплаты</span>
          <strong>{paymentMethodLabels[sale.paymentMethod]}</strong>
        </div>

        <div className="sale-details__summary-item sale-details__summary-item--status">
          <span>Статус</span>
          <Badge variant={getSaleStatusVariant(sale.status)} size="sm" dot>
            {getSaleStatusLabel(sale.status)}
          </Badge>
        </div>

        <div className="sale-details__summary-item sale-details__summary-item--total">
          <span>Итого</span>
          <strong>{sale.totalAmount.toLocaleString('ru-RU')} SAR</strong>
        </div>
      </Card>

      <Card className="sale-details__items-card" padding="none">
        <div className="sale-details__section-header">
          <h2>Товары</h2>
          <span>{sale.items.length} поз.</span>
        </div>

        <Table className="sale-details__table">
          <TableHead>
            <TableRow>
              <TableHeader scope="col">Товар</TableHeader>
              <TableHeader scope="col" className="sale-details__number-cell">Количество</TableHeader>
              <TableHeader scope="col">Единица</TableHeader>
              <TableHeader scope="col" className="sale-details__amount-cell">Цена</TableHeader>
              <TableHeader scope="col" className="sale-details__amount-cell">Сумма</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {sale.items.map((item) => {
              const product = products.find(
                (currentProduct) => currentProduct.id === item.productId,
              )

              return (
                <TableRow key={item.productId}>
                  <TableCell>{product?.name ?? item.productId}</TableCell>
                  <TableCell className="sale-details__number-cell">{item.quantity}</TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="sale-details__amount-cell">{item.unitPrice.toLocaleString('ru-RU')} SAR</TableCell>
                  <TableCell className="sale-details__amount-cell">{item.totalAmount.toLocaleString('ru-RU')} SAR</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      {isCancelConfirmOpen && (
        <ConfirmDialog
          open={isCancelConfirmOpen}
          onClose={() => setIsCancelConfirmOpen(false)}
          title="Отмена продажи"
          description="Вы действительно хотите отменить эту продажу?"
          confirmLabel="Отменить продажу"
          cancelLabel="Назад"
          variant="danger"
          loading={isPending(cancelCommandKey)}
          onConfirm={async () => {
            if (await handleCancel()) {
              setIsCancelConfirmOpen(false)
            }
          }}
        />
      )}
    </section>
  )
}
