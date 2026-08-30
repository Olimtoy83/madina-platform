import {
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import './Sales.css'
import { useProducts } from '../../context/useProducts'
import { useClients } from '../../context/useClients'
import { useSalesMutations } from '../../context/useSalesMutations'
import { useTransactionalState } from '../../context/useTransactionalState'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import { usePermissions } from '../../context/usePermissions'
import {
  getSaleItemTotal,
  getSaleItemsTotal,
  type PaymentMethod,
  type SaleItem,
} from '@madina/core'
import {
  getNextSaleNumber,
  getSalesHistory,
  type SalesHistory,
} from '../../shared/api/commerceApi'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@madina/ui'

export function Sales() {
  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()
  const { can } = usePermissions()
  const canWriteSales = can('sales:write')

  const navigate = useNavigate()

  const [searchParams] = useSearchParams()

  const {
    addSale,
    completeSale,
    cancelSale,
  } = useSalesMutations()
  const { snapshot } = useTransactionalState()

  const { products } = useProducts()

  const { clients } = useClients()

  const [clientId, setClientId] = useState('')
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('cash')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saleToCancel, setSaleToCancel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    null,
  )

  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [history, setHistory] = useState<SalesHistory | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [nextSaleNumber, setNextSaleNumber] = useState<string | null>(null)
  const [isSaleNumberLoading, setIsSaleNumberLoading] = useState(false)
  const requestGeneration = useRef(0)

  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')

  const selectedProduct = products.find(
    (product) => product.id === productId,
  )

  function refreshHistory() {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setIsHistoryLoading(true)
    setHistoryError(null)
    void getSalesHistory()
      .then((response) => {
        if (requestGeneration.current !== generation) return
        setHistory(response)
      })
      .catch((currentError: unknown) => {
        if (requestGeneration.current !== generation) return
        setHistoryError(currentError instanceof Error ? currentError.message : 'Не удалось загрузить продажи.')
      })
      .finally(() => {
        if (requestGeneration.current === generation) setIsHistoryLoading(false)
      })
  }

  useEffect(() => {
    refreshHistory()
  }, [snapshot])

  async function loadMore() {
    const cursor = history?.sales.nextCursor
    if (!cursor || isHistoryLoading || isLoadingMore) return
    const generation = requestGeneration.current
    setIsLoadingMore(true)
    try {
      const response = await getSalesHistory({ cursor })
      if (requestGeneration.current !== generation) return
      setHistory((current) => current ? {
        ...current,
        sales: {
          items: [...current.sales.items, ...response.sales.items],
          nextCursor: response.sales.nextCursor,
        },
      } : current)
    } catch (currentError) {
      if (requestGeneration.current === generation) {
        setHistoryError(currentError instanceof Error ? currentError.message : 'Не удалось загрузить следующие продажи.')
      }
    } finally {
      if (requestGeneration.current === generation) setIsLoadingMore(false)
    }
  }

  function openModal(
    initialClientId = '',
  ) {
    setError(null)
    setClientId(initialClientId)
    setPaymentMethod('cash')
    setSaleItems([])
    setProductId('')
    setQuantity('')
    setUnitPrice('')
    setNextSaleNumber(null)
    setIsSaleNumberLoading(true)
    setIsModalOpen(true)
    void getNextSaleNumber()
      .then((response) => setNextSaleNumber(response.saleNumber))
      .catch((currentError: unknown) => setError(
        currentError instanceof Error ? currentError.message : 'Не удалось получить номер продажи.',
      ))
      .finally(() => setIsSaleNumberLoading(false))
  }
  useEffect(() => {
    const initialClientId =
      searchParams.get('clientId')

    if (initialClientId) {
      openModal(initialClientId)
    }
  }, [searchParams])

  function closeModal() {
    setError(null)
    setIsModalOpen(false)
  }

  function handleProductChange(value: string) {
    setProductId(value)

    const product = products.find(
      (item) => item.id === value,
    )

    if (product) {
      setUnitPrice(String(product.salePrice))
    } else {
      setUnitPrice('')
    }
  }

  function handleAddItem() {
    if (!selectedProduct) {
      return
    }

    setError(null)

    const parsedQuantity = Number(quantity)
    const parsedUnitPrice = Number(unitPrice)

    if (
      parsedQuantity <= 0 ||
      parsedUnitPrice <= 0
    ) {
      return
    }

    if (
      parsedQuantity >
      selectedProduct.quantity
    ) {
      setError(
        'Количество товара превышает доступный остаток на складе.',
      )
      return
    }

    const existingItem = saleItems.find(
      (item) =>
        item.productId ===
        selectedProduct.id,
    )

    if (existingItem) {
      if (
        existingItem.unitPrice !==
        parsedUnitPrice
      ) {
        setError(
          'Этот товар уже добавлен с другой ценой. Добавьте его с той же ценой или удалите текущую позицию.',
        )
        return
      }

      const newQuantity =
        existingItem.quantity +
        parsedQuantity

      if (
        newQuantity >
        selectedProduct.quantity
      ) {
        setError(
          'Количество товара превышает доступный остаток на складе.',
        )
        return
      }

      setSaleItems((currentItems) =>
        currentItems.map((item) =>
          item.productId ===
            selectedProduct.id
            ? {
              ...item,
              quantity: newQuantity,
              totalAmount:
                getSaleItemTotal(
                  newQuantity,
                  item.unitPrice,),
            }
            : item,
        ),
      )
    } else {
      const item: SaleItem = {
        productId:
          selectedProduct.id,
        quantity: parsedQuantity,
        unit:
          selectedProduct.unit,
        unitPrice: parsedUnitPrice,
        totalAmount:
          getSaleItemTotal(
            parsedQuantity,
            parsedUnitPrice,),
      }

      setSaleItems(
        (currentItems) => [
          ...currentItems,
          item,
        ],
      )
    }

    setProductId('')
    setQuantity('')
    setUnitPrice('')
  }

  function handleRemoveItem(productIdToRemove: string) {
    setSaleItems((currentItems) =>
      currentItems.filter(
        (item) => item.productId !== productIdToRemove,
      ),
    )
  }

  async function handleCompleteSale(saleId: string) {
    setError(null)

    const command = await run(
      `sale.complete:${saleId}`,
      () => completeSale(saleId),
    )

    if (!command.started) {
      return
    }

    if (!command.value) {
      return
    }

    const result = command.value

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Ошибка завершения продажи',
        message: result.message ?? 'Не удалось завершить продажу.',
      })
      return
    }

    showToast({
      variant: 'success',
      title: 'Продажа завершена',
      message: 'Статус продажи изменён на завершённую',
    })
  }

  async function handleSaveDraft() {
    const selectedClient = clients.find(
      (client) => client.id === clientId,
    )

    if (
      !selectedClient ||
      saleItems.length === 0
    ) {
      return
    }

    const now = new Date()

    const totalAmount =
      getSaleItemsTotal(saleItems)

    const sale: Parameters<typeof addSale>[0] = {
      id: `sale-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      saleNumber: nextSaleNumber ?? '',
      saleDate: now,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      items: saleItems,
      totalAmount,
      paymentMethod,
      status: 'draft',
    }

    const command = await run(
      'sale.create',
      () => addSale(sale),
    )

    if (!command.started) {
      return
    }

    if (!command.value) {
      return
    }

    const result = command.value

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось создать продажу',
        message:
          result.message ??
          'Не удалось сохранить продажу.',
      })

      return
    }

    showToast({
      variant: 'success',
      title: 'Продажа создана',
      message: 'Новая продажа успешно добавлена',
    })

    closeModal()
  }

  const calculatedTotal = getSaleItemsTotal(saleItems)
  const summary = history?.summary
  const salesSummary = summary && 'totalCount' in summary ? summary : undefined
  const sales = history?.sales.items ?? []

  return (
    <section className="sales-page">
      <div className="sales-page__header">
        <div>
          <h1>Продажи</h1>
          <p>Управление продажами и заказами</p>
        </div>

        {canWriteSales && (
        <Button
          type="button"
          variant="primary"
          onClick={() => openModal()}
        >
          Новая продажа
        </Button>
        )}
      </div>

      {error && !isModalOpen && (
        <Alert
          variant="danger"
          title="Ошибка"
          dismissible
          onDismiss={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <div className="sales-page__summary">
        <Card className="sales-page__summary-card">
          <span>Всего продаж</span>
          <strong>{salesSummary?.totalCount ?? '—'}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Завершено</span>
          <strong>{salesSummary?.completedCount ?? '—'}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Черновики</span>
          <strong>{salesSummary?.draftCount ?? '—'}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Общая сумма</span>
          <strong>
            {salesSummary ? salesSummary.totalAmount.toLocaleString('ru-RU') : '—'} SAR
          </strong>
        </Card>
      </div>

      <Card className="sales-page__table-card">
        <div className="sales-page__table-header">
          <h2>Список продаж</h2>
        </div>

        {isHistoryLoading ? (
          <div className="sales-page__empty">Загрузка продаж…</div>
        ) : historyError ? (
          <div className="sales-page__empty"><Alert variant="danger" title="Не удалось загрузить продажи">{historyError}</Alert><Button type="button" variant="secondary" onClick={refreshHistory}>Повторить</Button></div>
        ) : sales.length === 0 ? (
          <EmptyState
            title="Продаж пока нет"
            description="Создайте первую продажу, чтобы она появилась в списке."
          />
        ) : (
          <div className="sales-page__table-wrapper">
            <Table className="sales-page__table">
              <TableHead>
                <TableRow>
                  <TableHeader>Номер</TableHeader>
                  <TableHeader>Дата</TableHeader>
                  <TableHeader>Клиент</TableHeader>
                  <TableHeader>Сумма</TableHeader>
                  <TableHeader>Статус</TableHeader>
                  <TableHeader>Действия</TableHeader>
                </TableRow>
              </TableHead>

              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.id}>

                    <TableCell>
                      <Button
                        type="button"
                        className="sales-page__sale-link"
                        onClick={() => navigate(`/sales/${sale.id}`)}
                      >
                        {sale.saleNumber}
                      </Button>
                    </TableCell>

                    <TableCell>
                      {sale.saleDate.toLocaleDateString(
                        'ru-RU',
                      )}
                    </TableCell>

                    <TableCell>
                      {sale.clientName}
                    </TableCell>

                    <TableCell>
                      {sale.totalAmount.toLocaleString(
                        'ru-RU',
                      )}{' '}
                      SAR
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={
                          sale.status === 'draft'
                            ? 'warning'
                            : sale.status === 'completed'
                              ? 'success'
                              : 'danger'
                        }
                      >
                        {sale.status === 'draft'
                          ? 'Черновик'
                          : sale.status === 'completed'
                            ? 'Завершено'
                            : 'Отменено'}
                      </Badge>
                    </TableCell>

                    <TableCell>
                        {canWriteSales && sale.status === 'draft' && (
                        <div className="sales-page__actions">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() =>
                              handleCompleteSale(sale.id)
                            }
                            disabled={isPending(`sale.complete:${sale.id}`)}
                          >
                            {isPending(`sale.complete:${sale.id}`)
                              ? 'Завершение…'
                              : 'Завершить'}
                          </Button>

                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => {
                              setSaleToCancel(sale.id)
                            }}
                            disabled={isPending(`sale.complete:${sale.id}`)}
                          >
                            Отменить
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {history?.sales.nextCursor && !isHistoryLoading && (
          <div className="sales-page__load-more"><Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={isLoadingMore}>{isLoadingMore ? 'Загрузка…' : 'Показать ещё'}</Button></div>
        )}
      </Card>

      {canWriteSales && isModalOpen && (
        <Modal
          open={isModalOpen}
          onClose={closeModal}
          title="Новая продажа"
          description="Создание нового черновика продажи"
          size="xl"
        >

          <div className="sales-modal__body">
            {error && (
              <Alert
                variant="danger"
                title="Ошибка"
                dismissible
                onDismiss={() => setError(null)}
              >
                {error}
              </Alert>
            )}

            <label className="sales-modal__field">
              <span>Клиент</span>

              <Select
                fullWidth
                value={clientId}
                onChange={(event) =>
                  setClientId(event.target.value)
                }
              >
                <option value="">
                  Выберите клиента
                </option>

                {clients
                  .filter(
                    (client) =>
                      client.status === 'active',
                  )
                  .map((client) => (
                    <option
                      key={client.id}
                      value={client.id}
                    >
                      {client.name}
                      {client.phone
                        ? ` — ${client.phone}`
                        : ''}
                    </option>
                  ))}
              </Select>
            </label>

            <label className="sales-modal__field">
              <span>Способ оплаты</span>

              <Select
                fullWidth
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value as PaymentMethod,
                  )
                }
              >
                <option value="cash">
                  Наличные
                </option>

                <option value="card">
                  Банковская карта
                </option>

                <option value="bank-transfer">
                  Банковский перевод
                </option>

                <option value="other">
                  Другое
                </option>
              </Select>
            </label>

            <label className="sales-modal__field">
              <span>Товар</span>

              <Select
                fullWidth
                value={productId}
                onChange={(event) =>
                  handleProductChange(
                    event.target.value,
                  )
                }
              >
                <option value="">
                  Выберите товар
                </option>

                {products
                  .filter(
                    (product) =>
                      product.status === 'active',
                  )
                  .map((product) => (
                    <option
                      key={product.id}
                      value={product.id}
                    >
                      {product.name} — остаток:{' '}
                      {product.quantity}{' '}
                      {product.unit}
                    </option>
                  ))}
              </Select>
            </label>

            {selectedProduct && (
              <div className="sales-modal__stock">
                Доступно на складе:{' '}
                <strong>
                  {selectedProduct.quantity}{' '}
                  {selectedProduct.unit}
                </strong>
              </div>
            )}

            <div className="sales-modal__row">
              <label className="sales-modal__field">
                <span>
                  Количество (
                  {selectedProduct?.unit || 'ед.'})
                </span>

                <Input
                  fullWidth
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(event.target.value)
                  }
                  placeholder="0"
                />
              </label>

              <label className="sales-modal__field">
                <span>Цена за единицу</span>

                <Input
                  fullWidth
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={unitPrice}
                  onChange={(event) =>
                    setUnitPrice(event.target.value)
                  }
                  placeholder="0"
                />
              </label>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={handleAddItem}
              disabled={
                !selectedProduct ||
                Number(quantity) <= 0 ||
                Number(unitPrice) <= 0
              }
            >
              Добавить товар
            </Button>

            {saleItems.length > 0 && (
              <div className="sales-modal__items">
                <strong>Позиции продажи</strong>

                {saleItems.map((item) => {
                  const product = products.find(
                    (currentProduct) =>
                      currentProduct.id ===
                      item.productId,
                  )

                  return (
                    <div
                      key={item.productId}
                      className="sales-modal__item"
                    >
                      <div>
                        <strong>
                          {product?.name ||
                            item.productId}
                        </strong>

                        <span>
                          {item.quantity}{' '}
                          {item.unit} ×{' '}
                          {item.unitPrice.toLocaleString(
                            'ru-RU',
                          )}{' '}
                          SAR
                        </span>
                      </div>

                      <div>
                        <strong>
                          {item.totalAmount.toLocaleString(
                            'ru-RU',
                          )}{' '}
                          SAR
                        </strong>

                        <Button
                          type="button"
                          variant="danger"
                          onClick={() =>
                            handleRemoveItem(
                              item.productId,
                            )
                          }
                        >
                          Удалить
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="sales-modal__total">
              <span>Итого</span>

              <strong>
                {calculatedTotal.toLocaleString(
                  'ru-RU',
                )}{' '}
                SAR
              </strong>
            </div>
          </div>

          <div className="sales-modal__footer">
            <Button
              type="button"
              variant="secondary"
              onClick={closeModal}
              disabled={isPending('sale.create')}
            >
              Отмена
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveDraft}
              disabled={
                !clientId ||
                saleItems.length === 0
                || !nextSaleNumber || isSaleNumberLoading
                || isPending('sale.create')
              }
            >
              {isPending('sale.create')
                ? 'Сохранение…'
                : 'Сохранить черновик'}
            </Button>
          </div>
        </Modal>
      )}

      {canWriteSales && saleToCancel && (
        <ConfirmDialog
          open={saleToCancel !== null}
          onClose={() => setSaleToCancel(null)}
          loading={isPending(`sale.cancel:${saleToCancel}`)}
          onConfirm={async () => {
            const command = await run(
              `sale.cancel:${saleToCancel}`,
              () => cancelSale(saleToCancel),
            )

            if (!command.started) {
              return
            }

            if (!command.value) {
              return
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

              return
            }

            showToast({
              variant: 'success',
              title: 'Продажа отменена',
              message: 'Статус продажи изменён на отменённую',
            })

            setSaleToCancel(null)
          }}

          title="Отменить продажу?"
          description="Продажа будет переведена в статус отменено."
          confirmLabel="Отменить продажу"
          cancelLabel="Назад"
          variant="danger"
        />
      )}

    </section>
  )
}
