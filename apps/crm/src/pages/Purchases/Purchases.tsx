import {
  useMemo,
  useState,
} from 'react'

import {
  getNextPurchaseNumber,
  getPurchaseItemTotal,
  normalizePurchase,
  PurchaseValidationError,
  type PurchaseItem,
  type PurchasePaymentMethod,
  type PurchaseStatus,
} from '@madina/core'
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
  Textarea,
} from '@madina/ui'
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

  const activeProducts = products.filter(
    (product) => product.status === 'active',
  )

  const {
    purchases,
    addPurchase,
    completePurchase,
    cancelPurchase,
  } = usePurchases()

  const [selectedPurchaseId, setSelectedPurchaseId] =
    useState<string | null>(null)

  const selectedPurchase = selectedPurchaseId
    ? purchases.find(
      (purchase) =>
        purchase.id === selectedPurchaseId,
    ) ?? null
    : null

  const [isCreateOpen, setIsCreateOpen] =
    useState(false)

  const [purchaseToCancel, setPurchaseToCancel] =
    useState<string | null>(null)

  const [error, setError] = useState<string | null>(
    null,
  )

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
        productId: activeProducts[0]?.id ?? '',
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
    setError(null)

    const firstProduct = activeProducts.find(
      (product) =>
        !formItems.some(
          (item) =>
            item.productId === product.id,
        ),
    )

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
    setError(null)

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
    setError(null)

    const currentItem = formItems[index]

    if (!currentItem) {
      return
    }

    const duplicateItem = updates.productId
      ? formItems.find(
        (item, itemIndex) =>
          itemIndex !== index &&
          item.productId === updates.productId,
      )
      : undefined

    if (
      duplicateItem &&
      duplicateItem.unitCost !== currentItem.unitCost
    ) {
      setError(
        'Этот товар уже добавлен с другой ценой закупки. Добавьте его с той же ценой или удалите текущую позицию.',
      )
      return
    }

    setFormItems((currentItems) => {
      const itemToUpdate = currentItems[index]

      if (!itemToUpdate) {
        return currentItems
      }

      const nextItem = {
        ...itemToUpdate,
        ...updates,
      }

      const duplicateIndex =
        updates.productId
          ? currentItems.findIndex(
            (item, itemIndex) =>
              itemIndex !== index &&
              item.productId === updates.productId,
          )
          : -1

      if (duplicateIndex >= 0) {
        return currentItems
          .filter((_, itemIndex) => itemIndex !== index)
          .map((item, itemIndex) =>
            itemIndex ===
              (duplicateIndex > index
                ? duplicateIndex - 1
                : duplicateIndex)
              ? {
                ...item,
                quantity:
                  item.quantity +
                  itemToUpdate.quantity,
              }
              : item,
          )
      }

      return currentItems.map((item, itemIndex) =>
        itemIndex === index
          ? nextItem
          : item,
      )
    })
  }

  function savePurchase() {
    if (!purchaseDate) {
      setError('Укажите дату поступления.')
      return
    }

    if (!supplierName.trim()) {
      setError('Укажите поставщика.')
      return
    }

    if (formItems.length === 0) {
      setError('Добавьте хотя бы один товар.')
      return
    }

    const invalidItem = formItems.find(
      (item) =>
        item.quantity <= 0 ||
        item.unitCost <= 0,
    )

    if (invalidItem) {
      setError(
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

    const newPurchase = normalizePurchase({
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
    })

    addPurchase(newPurchase)

    setError(null)
    setSelectedPurchaseId(newPurchase.id)

    setIsCreateOpen(false)

    setPurchaseDate('')
    setSupplierName('')
    setNote('')

    setFormItems([
      {
        productId:
          activeProducts[0]?.id ?? '',
        quantity: 1,
        unitCost: 0,
      },
    ])
  }

  function openCreateForm() {
    const firstProduct = activeProducts[0]

    setError(null)
    setPurchaseDate('')
    setSupplierName('')
    setPaymentMethod('cash')
    setNote('')

    setFormItems([
      {
        productId:
          firstProduct?.id ?? '',
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

        <Button
          type="button"
          variant="primary"
          onClick={openCreateForm}
        >
          Добавить поступление
        </Button>
      </div>

      {error && !isCreateOpen && (
        <Alert
          variant="danger"
          title="Ошибка"
          dismissible
          onDismiss={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      <Card className="purchases__table-wrapper">
        <Table className="purchases__table">
          <TableHead>
            <TableRow>
              <TableHeader>Номер</TableHeader>
              <TableHeader>Дата</TableHeader>
              <TableHeader>Поставщик</TableHeader>
              <TableHeader>Товаров</TableHeader>
              <TableHeader>Сумма</TableHeader>
              <TableHeader>Статус</TableHeader>
              <TableHeader>Действие</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {purchases.length === 0 ? (
              <EmptyState
                title="Поступлений пока нет"
                description="Создайте первое поступление товара, чтобы оно появилось в списке."
              />
            ) : (
              purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell>
                    {purchase.purchaseNumber}
                  </TableCell>

                  <TableCell>
                    {purchase.purchaseDate.toLocaleDateString(
                      'ru-RU',
                    )}
                  </TableCell>

                  <TableCell>
                    {purchase.supplierName}
                  </TableCell>

                  <TableCell>
                    {purchase.items.length}
                  </TableCell>

                  <TableCell>
                    {purchase.totalAmount} SAR
                  </TableCell>

                  <TableCell>
                    {statusLabels[purchase.status]}
                  </TableCell>

                  <TableCell>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setError(null)
                        setSelectedPurchaseId(
                          purchase.id,
                        )
                      }}
                    >
                      Открыть
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {selectedPurchase && (
        <Card
          className="purchases__purchase-card"
          padding="lg"
        >
          <div className="purchases__purchase-card-header">
            <div>
              <h2>
                {selectedPurchase.purchaseNumber}
              </h2>

              <p>
                {selectedPurchase.supplierName}
              </p>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setError(null)
                setSelectedPurchaseId(null)
              }}
              aria-label="Закрыть карточку"
            >
              ×
            </Button>
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
              <Badge
                variant={
                  selectedPurchase.status === 'draft'
                    ? 'warning'
                    : selectedPurchase.status === 'completed'
                      ? 'success'
                      : 'danger'
                }
              >
                {statusLabels[selectedPurchase.status]}
              </Badge>
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
              <Table className="purchases__items-table">
                <TableHead>
                  <TableRow>
                    <TableHeader>Товар</TableHeader>
                    <TableHeader>Количество</TableHeader>
                    <TableHeader>Цена закупки</TableHeader>
                    <TableHeader>Сумма</TableHeader>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {selectedPurchase.items.map(
                    (item, index) => (
                      <TableRow
                        key={`${item.productId}-${index}`}
                      >
                        <TableCell>
                          {getProductName(
                            item.productId,
                          )}
                        </TableCell>

                        <TableCell>
                          {item.quantity}{' '}
                          {unitLabels[item.unit]}
                        </TableCell>

                        <TableCell>
                          {item.unitCost} SAR
                        </TableCell>

                        <TableCell>
                          {
                            getPurchaseItemTotal(
                              item.quantity,
                              item.unitCost,
                            )
                          }{' '}
                          SAR
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="purchases__purchase-card-actions">
            {selectedPurchase.status ===
              'draft' && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setError(null)

                    try {
                      const result = completePurchase(
                        selectedPurchase.id,
                      )

                      if (!result.success) {
                        setError(
                          result.message ??
                          'Не удалось завершить поступление.',
                        )
                      }
                    } catch (error) {
                      if (
                        error instanceof
                        PurchaseValidationError
                      ) {
                        setError(error.message)
                        return
                      }

                      throw error
                    }
                  }}
                >
                  Завершить поступление
                </Button>
              )}

            {selectedPurchase.status === 'draft' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPurchaseToCancel(selectedPurchase.id)
                }}
              >
                Отменить поступление
              </Button>
            )}

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setError(null)
                setSelectedPurchaseId(null)
              }}
            >
              Закрыть
            </Button>
          </div>
        </Card>
      )}

      {isCreateOpen && (
        <Modal
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Новое поступление"
          description="Создайте черновик поступления."
          size="xl"
        >
          <div className="purchases__form">
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

            <label>
              <span>Дата поступления</span>

              <Input
                fullWidth
                type="date"
                value={purchaseDate}
                onChange={(event) => {
                  setError(null)
                  setPurchaseDate(
                    event.target.value,
                  )
                }}
              />
            </label>

            <label>
              <span>Поставщик</span>

              <Input
                fullWidth
                type="text"
                value={supplierName}
                onChange={(event) => {
                  setError(null)
                  setSupplierName(
                    event.target.value,
                  )
                }}
                placeholder="Введите поставщика"
              />
            </label>

            <div className="purchases__form-items">
              <div className="purchases__form-items-header">
                <h3>Товары</h3>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={addFormItem}
                >
                  Добавить товар
                </Button>
              </div>

              {formItems.map(
                (item, index) => (
                  <div
                    className="purchases__form-item"
                    key={index}
                  >
                    <label>
                      <span>Товар</span>

                      <Select
                        fullWidth
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
                        {activeProducts.map(
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
                      </Select>
                    </label>

                    <label>
                      <span>
                        Количество
                      </span>

                      <Input
                        fullWidth
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

                      <Input
                        fullWidth
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

                    <Button
                      type="button"
                      variant="danger"
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
                    </Button>
                  </div>
                ),
              )}
            </div>

            <label>
              <span>Примечание</span>

              <Textarea
                fullWidth
                value={note}
                onChange={(event) => {
                  setError(null)
                  setNote(
                    event.target.value,
                  )
                }}
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
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setIsCreateOpen(false)
              }
            >
              Отмена
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={savePurchase}
            >
              Создать поступление
            </Button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(purchaseToCancel)}
        onClose={() => setPurchaseToCancel(null)}
        title="Отмена поступления"
        description="Вы действительно хотите отменить это поступление?"
        confirmLabel="Отменить поступление"
        cancelLabel="Назад"
        variant="danger"
        onConfirm={() => {
          if (!purchaseToCancel) {
            return
          }

          setError(null)
          cancelPurchase(purchaseToCancel)
          setPurchaseToCancel(null)
        }}
      />
    </section >
  )
}
