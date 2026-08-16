import {
  useMemo,
  useState,
} from 'react'

import {
  getNextPurchaseNumber,
  getPurchaseItemTotal,
  type Purchase,
  type PurchaseItem,
  type PurchasePaymentMethod,
  type PurchaseStatus,
} from '@madina/core'

import { useProducts } from '../../context/useProducts'
import { usePurchases } from '../../context/usePurchases'

import './Purchases.css'


const statusLabels: Record<PurchaseStatus, string> = {
  draft: 'Черновик',
  completed: 'Завершено',
  cancelled: 'Отменено',
}

const unitLabels = {
  kg: 'кг',
  piece: 'шт.',
  liter: 'л',
  box: 'кор.',
} as const

interface FormItem {
  productId: string
  quantity: number
  unitCost: number
}

export function Purchases() {

  const { products } = useProducts()

  const {
    purchases,
    addPurchase,
    completePurchase,
    cancelPurchase,
  } = usePurchases()

  const [selectedPurchase, setSelectedPurchase] =
    useState<Purchase | null>(null)

  const [isCreateOpen, setIsCreateOpen] =
    useState(false)

  const [purchaseDate, setPurchaseDate] =
    useState('')

  const [supplierName, setSupplierName] =
    useState('')

  const [paymentMethod, setPaymentMethod] =
    useState<PurchasePaymentMethod>('cash')

  const [note, setNote] =
    useState('')

  const [formItems, setFormItems] =
    useState<FormItem[]>([
      {
        productId: 'product-001',
        quantity: 1,
        unitCost: 0,
      },
    ])

  const totalAmount = useMemo(
    () =>
      formItems.reduce(
        (total, item) =>
          total +
          getPurchaseItemTotal(
            item.quantity,
            item.unitCost,
          ),
        0,
      ),
    [formItems],
  )

  function getProductName(productId: string) {
    return (
      products.find(
        (product) => product.id === productId,
      )?.name ?? 'Неизвестный товар'
    )
  }

  function addFormItem() {
    const firstProduct = products[0]

    if (!firstProduct) {
      return
    }

    setFormItems((currentItems) => [
      ...currentItems,
      {
        productId: firstProduct.id,
        quantity: 1,
        unitCost: 0,
      },
    ])
  }

  function removeFormItem(index: number) {
    setFormItems((currentItems) =>
      currentItems.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    )
  }

  function updateFormItem(
    index: number,
    updates: Partial<FormItem>,
  ) {
    setFormItems((currentItems) =>
      currentItems.map((item, itemIndex) =>
        itemIndex === index
          ? {
            ...item,
            ...updates,
          }
          : item,
      ),
    )
  }

  function savePurchase() {
    if (!purchaseDate) {
      window.alert('Укажите дату поступления.')
      return
    }

    if (!supplierName.trim()) {
      window.alert('Укажите поставщика.')
      return
    }

    if (formItems.length === 0) {
      window.alert('Добавьте хотя бы один товар.')
      return
    }

    const invalidItem = formItems.find(
      (item) =>
        item.quantity <= 0 ||
        item.unitCost <= 0,
    )

    if (invalidItem) {
      window.alert(
        'Количество и цена закупки должны быть больше нуля.',
      )
      return
    }

    const purchaseNumber =
      getNextPurchaseNumber(purchases)

    const now = new Date()

    const purchaseItems: PurchaseItem[] =
      formItems.map((item) => {
        const product = products.find(
          (entry) =>
            entry.id === item.productId,
        )

        if (!product) {
          throw new Error(
            'Товар не найден.',
          )
        }

        return {
          productId: item.productId,
          quantity: item.quantity,
          unit: product.unit,
          unitCost: item.unitCost,
          totalCost:
            getPurchaseItemTotal(
              item.quantity,
              item.unitCost,
            ),
        }
      })

    const newPurchase: Purchase = {
      id: `purchase-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      purchaseNumber,
      purchaseDate: new Date(
        `${purchaseDate}T00:00:00`,
      ),
      supplierName: supplierName.trim(),
      items: purchaseItems,
      totalAmount,
      paymentMethod,
      status: 'draft',
      note: note.trim() || undefined,
    }

    addPurchase(newPurchase)

    setSelectedPurchase(newPurchase)

    setIsCreateOpen(false)

    setPurchaseDate('')
    setSupplierName('')
    setNote('')

    setFormItems([
      {
        productId:
          products[0]?.id ?? 'product-001',
        quantity: 1,
        unitCost: 0,
      },
    ])
  }

  function openCreateForm() {
    const firstProduct = products[0]

    setPurchaseDate('')
    setSupplierName('')
    setPaymentMethod('cash')
    setNote('')

    setFormItems([
      {
        productId:
          firstProduct?.id ??
          'product-001',
        quantity: 1,
        unitCost: 0,
      },
    ])

    setIsCreateOpen(true)
  }

  return (
    <section className="purchases">
      <div className="purchases__header">
        <div>
          <h1>Поступления</h1>
          <p>
            Управление закупками и
            поступлением товаров на склад.
          </p>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={openCreateForm}
        >
          Добавить поступление
        </button>
      </div>

      <div className="purchases__table-wrapper">
        <table className="purchases__table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Поставщик</th>
              <th>Товаров</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Действие</th>
            </tr>
          </thead>

          <tbody>
            {purchases.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="purchases__empty"
                >
                  Поступлений пока нет.
                </td>
              </tr>
            ) : (
              purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>
                    {purchase.purchaseNumber}
                  </td>

                  <td>
                    {purchase.purchaseDate.toLocaleDateString(
                      'ru-RU',
                    )}
                  </td>

                  <td>
                    {purchase.supplierName}
                  </td>

                  <td>
                    {purchase.items.length}
                  </td>

                  <td>
                    {purchase.totalAmount} SAR
                  </td>

                  <td>
                    {statusLabels[
                      purchase.status
                    ]}
                  </td>

                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPurchase(
                          purchase,
                        )
                      }
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedPurchase && (
        <div className="purchases__purchase-card">
          <div className="purchases__purchase-card-header">
            <div>
              <h2>
                {selectedPurchase.purchaseNumber}
              </h2>

              <p>
                {selectedPurchase.supplierName}
              </p>
            </div>

            <button
              type="button"
              className="purchases__purchase-card-close"
              onClick={() =>
                setSelectedPurchase(null)
              }
              aria-label="Закрыть карточку"
            >
              ×
            </button>
          </div>

          <div className="purchases__purchase-details">
            <div className="purchases__detail">
              <span>Дата</span>
              <strong>
                {selectedPurchase.purchaseDate.toLocaleDateString(
                  'ru-RU',
                )}
              </strong>
            </div>

            <div className="purchases__detail">
              <span>Поставщик</span>
              <strong>
                {selectedPurchase.supplierName}
              </strong>
            </div>

            <div className="purchases__detail">
              <span>Количество позиций</span>
              <strong>
                {selectedPurchase.items.length}
              </strong>
            </div>

            <div className="purchases__detail">
              <span>Сумма</span>
              <strong>
                {selectedPurchase.totalAmount} SAR
              </strong>
            </div>

            <div className="purchases__detail">
              <span>Статус</span>
              <strong>
                {
                  statusLabels[
                  selectedPurchase.status
                  ]
                }
              </strong>
            </div>

            <div className="purchases__detail">
              <span>Примечание</span>
              <strong>
                {selectedPurchase.note ||
                  '—'}
              </strong>
            </div>
          </div>

          <div className="purchases__items">
            <h3>Товары</h3>

            <div className="purchases__items-table-wrapper">
              <table className="purchases__items-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Количество</th>
                    <th>Цена закупки</th>
                    <th>Сумма</th>
                  </tr>
                </thead>

                <tbody>
                  {selectedPurchase.items.map(
                    (item, index) => (
                      <tr key={`${item.productId}-${index}`}>
                        <td>
                          {getProductName(
                            item.productId,
                          )}
                        </td>

                        <td>
                          {item.quantity}{' '}
                          {unitLabels[
                            item.unit
                          ]}
                        </td>

                        <td>
                          {item.unitCost} SAR
                        </td>

                        <td>
                          {
                            getPurchaseItemTotal(
                              item.quantity,
                              item.unitCost,
                            )}{' '}
                          SAR
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="purchases__purchase-card-actions">
            {selectedPurchase.status ===
              'draft' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const result = completePurchase(
                      selectedPurchase.id,
                    )

                    if (!result.success) {
                      window.alert(
                        result.message ??
                        'Не удалось завершить поступление.',
                      )
                      return
                    }

                    setSelectedPurchase((currentPurchase) =>
                      currentPurchase
                        ? {
                          ...currentPurchase,
                          status: 'completed',
                          updatedAt: new Date(),
                        }
                        : currentPurchase,
                    )
                  }}
                >
                  Завершить поступление
                </button>
              )}

            {selectedPurchase.status === 'draft' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (
                    !window.confirm(
                      'Отменить это поступление?',
                    )
                  ) {
                    return
                  }

                  cancelPurchase(selectedPurchase.id)

                  setSelectedPurchase((currentPurchase) =>
                    currentPurchase
                      ? {
                        ...currentPurchase,
                        status: 'cancelled',
                        updatedAt: new Date(),
                      }
                      : currentPurchase,
                  )
                }}
              >
                Отменить поступление
              </button>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setSelectedPurchase(null)
              }
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {isCreateOpen && (
        <div className="purchases__modal-backdrop">
          <div className="purchases__modal">
            <div className="purchases__modal-header">
              <div>
                <h2>
                  Новое поступление
                </h2>

                <p>
                  Создайте черновик поступления.
                </p>
              </div>

              <button
                type="button"
                className="purchases__purchase-card-close"
                onClick={() =>
                  setIsCreateOpen(false)
                }
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="purchases__form">
              <label>
                <span>Дата поступления</span>

                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(event) =>
                    setPurchaseDate(
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                <span>Поставщик</span>

                <input
                  type="text"
                  value={supplierName}
                  onChange={(event) =>
                    setSupplierName(
                      event.target.value,
                    )
                  }
                  placeholder="Введите поставщика"
                />
              </label>

              <div className="purchases__form-items">
                <div className="purchases__form-items-header">
                  <h3>Товары</h3>

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={addFormItem}
                  >
                    Добавить товар
                  </button>
                </div>

                {formItems.map(
                  (item, index) => (
                    <div
                      className="purchases__form-item"
                      key={index}
                    >
                      <label>
                        <span>Товар</span>

                        <select
                          value={item.productId}
                          onChange={(event) =>
                            updateFormItem(
                              index,
                              {
                                productId:
                                  event.target
                                    .value,
                              },
                            )
                          }
                        >
                          {products.map(
                            (product) => (
                              <option
                                key={
                                  product.id
                                }
                                value={
                                  product.id
                                }
                              >
                                {
                                  product.name
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <label>
                        <span>
                          Количество
                        </span>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            item.quantity
                          }
                          onChange={(event) =>
                            updateFormItem(
                              index,
                              {
                                quantity:
                                  Number(
                                    event
                                      .target
                                      .value,
                                  ),
                              },
                            )
                          }
                        />
                      </label>

                      <label>
                        <span>
                          Цена закупки
                        </span>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            item.unitCost
                          }
                          onChange={(event) =>
                            updateFormItem(
                              index,
                              {
                                unitCost:
                                  Number(
                                    event
                                      .target
                                      .value,
                                  ),
                              },
                            )
                          }
                        />
                      </label>

                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() =>
                          removeFormItem(
                            index,
                          )
                        }
                        disabled={
                          formItems.length ===
                          1
                        }
                      >
                        Удалить
                      </button>
                    </div>
                  ),
                )}
              </div>

              <label>
                <span>Примечание</span>

                <textarea
                  value={note}
                  onChange={(event) =>
                    setNote(
                      event.target.value,
                    )
                  }
                  placeholder="Дополнительная информация"
                  rows={4}
                />
              </label>

              <div className="purchases__form-total">
                <span>
                  Итого
                </span>

                <strong>
                  {totalAmount} SAR
                </strong>
              </div>
            </div>

            <div className="purchases__modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setIsCreateOpen(false)
                }
              >
                Отмена
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={savePurchase}
              >
                Создать поступление
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
