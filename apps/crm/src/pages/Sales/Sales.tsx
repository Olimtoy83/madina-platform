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
  type PaymentMethod,
  type SaleItem,
} from '@madina/core'
import {
  Button,
  Input,
  Select,
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
        return
      }

      const newQuantity =
        existingItem.quantity +
        parsedQuantity

      if (
        newQuantity >
        selectedProduct.quantity
      ) {
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
          className="sales-page__cancel-button"
          onClick={() => openModal()}
        >
          Новая продажа
        </Button>
      </div>

      <div className="sales-page__summary">
        <div className="sales-page__summary-card">
          <span>Всего продаж</span>
          <strong>{sales.length}</strong>
        </div>

        <div className="sales-page__summary-card">
          <span>Завершено</span>
          <strong>{completedCount}</strong>
        </div>

        <div className="sales-page__summary-card">
          <span>Черновики</span>
          <strong>{draftCount}</strong>
        </div>

        <div className="sales-page__summary-card">
          <span>Общая сумма</span>
          <strong>
            {totalAmount.toLocaleString('ru-RU')} SAR
          </strong>
        </div>
      </div>

      <div className="sales-page__table-card">
        <div className="sales-page__table-header">
          <h2>Список продаж</h2>
        </div>

        {sales.length === 0 ? (
          <div className="sales-page__empty">
            Продаж пока нет
          </div>
        ) : (
          <div className="sales-page__table-wrapper">
            <table className="sales-page__table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>

              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>

                    <td>
                      <Button
                        type="button"
                        className="sales-page__sale-link"
                        onClick={() => navigate(`/sales/${sale.id}`)}
                      >
                        {sale.saleNumber}
                      </Button>
                    </td>

                    <td>
                      {sale.saleDate.toLocaleDateString(
                        'ru-RU',
                      )}
                    </td>

                    <td>{sale.clientName}</td>

                    <td>
                      {sale.totalAmount.toLocaleString(
                        'ru-RU',
                      )}{' '}
                      SAR
                    </td>

                    <td>
                      <span
                        className={`sales-page__status sales-page__status--${sale.status}`}
                      >
                        {sale.status === 'draft'
                          ? 'Черновик'
                          : sale.status === 'completed'
                            ? 'Завершено'
                            : 'Отменено'}
                      </span>
                    </td>

                    <td>
                      {sale.status === 'draft' && (
                        <div className="sales-page__actions">
                          <Button
                            type="button"
                            className="sales-page__cancel-button"
                            onClick={() =>
                              completeSale(sale.id)
                            }
                          >
                            Завершить
                          </Button>

                          <Button
                            type="button"
                            className="sales-page__cancel-button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Отменить эту продажу?',
                                )
                              ) {
                                cancelSale(sale.id)
                              }
                            }}
                          >
                            Отменить
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div
          className="sales-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              closeModal()
            }
          }}
        >
          <div
            className="sales-modal__content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-sale-title"
          >
            <div className="sales-modal__header">
              <div>
                <h2 id="new-sale-title">
                  Новая продажа
                </h2>

                <p>
                  Создание нового черновика продажи
                </p>
              </div>

              <Button
                type="button"
                className="sales-modal__close"
                onClick={closeModal}
                aria-label="Закрыть"
              >
                ×
              </Button>
            </div>

            <div className="sales-modal__body">
              <label className="sales-modal__field">
                <span>Клиент</span>

                <Select
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
          </div>
        </div>
      )}
    </section>
  )
}
