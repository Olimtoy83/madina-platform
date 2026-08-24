import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import './Sales.css'
import { useProducts } from '../../context/useProducts'
import { useClients } from '../../context/useClients'
import { useSales } from '../../context/useSales'
import {
  getSaleStats,
  getSaleItemTotal,
  getSaleItemsTotal,
  SaleValidationError,
  type PaymentMethod,
  type SaleItem,
} from '@madina/core'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
  const navigate = useNavigate()

  const [searchParams] = useSearchParams()

  const {
    sales,
    addSale,
    completeSale,
    cancelSale,
  } = useSales()

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

  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitPrice, setUnitPrice] = useState('')

  const selectedProduct = products.find(
    (product) => product.id === productId,
  )

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
    setIsModalOpen(true)
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
      parsedUnitPrice < 0
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

  function handleCompleteSale(saleId: string) {
    setError(null)

    try {
      const result = completeSale(saleId)

      if (!result.success) {
        setError(
          result.message ??
          'Не удалось завершить продажу.',
        )
      }
    } catch (error) {
      if (error instanceof SaleValidationError) {
        setError(error.message)
        return
      }

      throw error
    }
  }

  function handleSaveDraft() {
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
      saleNumber: `SAL-${String(
        sales.length + 1,
      ).padStart(4, '0')}`,
      saleDate: now,
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      items: saleItems,
      totalAmount,
      paymentMethod,
      status: 'draft',
    }

    addSale(sale)
    closeModal()
  }

  const {
    draftCount,
    completedCount,
    totalAmount,
  } = useMemo(
    () => getSaleStats(sales),
    [sales],
  )

  const calculatedTotal = useMemo(
    () => getSaleItemsTotal(saleItems),
    [saleItems],
  )

  return (
    <section className="sales-page">
      <div className="sales-page__header">
        <div>
          <h1>Продажи</h1>
          <p>Управление продажами и заказами</p>
        </div>

        <Button
          type="button"
          variant="primary"
          onClick={() => openModal()}
        >
          Новая продажа
        </Button>
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
          <strong>{sales.length}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Завершено</span>
          <strong>{completedCount}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Черновики</span>
          <strong>{draftCount}</strong>
        </Card>

        <Card className="sales-page__summary-card">
          <span>Общая сумма</span>
          <strong>
            {totalAmount.toLocaleString('ru-RU')} SAR
          </strong>
        </Card>
      </div>

      <Card className="sales-page__table-card">
        <div className="sales-page__table-header">
          <h2>Список продаж</h2>
        </div>

        {sales.length === 0 ? (
          <div className="sales-page__empty">
            Продаж пока нет
          </div>
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
                      {sale.status === 'draft' && (
                        <div className="sales-page__actions">
                          <Button
                            type="button"
                            variant="primary"
                            onClick={() =>
                              handleCompleteSale(sale.id)
                            }
                          >
                            Завершить
                          </Button>

                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => {
                              setSaleToCancel(sale.id)
                            }}
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
      </Card>

      {isModalOpen && (
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
                  min="0"
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
                Number(unitPrice) < 0
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
              }
            >
              Сохранить черновик
            </Button>
          </div>
        </Modal>
      )}

      {saleToCancel && (
        <ConfirmDialog
          open={saleToCancel !== null}
          onClose={() => setSaleToCancel(null)}
          onConfirm={() => {
            cancelSale(saleToCancel)
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
