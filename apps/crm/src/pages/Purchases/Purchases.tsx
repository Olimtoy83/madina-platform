import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  getPurchaseItemTotal,
  resolveBusinessDateStart,
  type Purchase,
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
import { usePurchasesMutations } from '../../context/usePurchasesMutations'
import { useTransactionalState } from '../../context/useTransactionalState'
import { useToast } from '../../context/ToastProvider'
import {
  getNextPurchaseNumber,
  getPurchaseById,
  getPurchasesHistory,
  type PurchasesHistory,
} from '../../shared/api/commerceApi'
import { HttpError } from '../../shared/api/httpClient'

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

function getPurchasesErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось загрузить поступления. Повторите попытку.'
}

export function Purchases() {
  const { showToast } = useToast()

  const { products } = useProducts()

  const activeProducts = products.filter(
    (product) => product.status === 'active',
  )

  const {
    addPurchase,
    completePurchase,
    cancelPurchase,
  } = usePurchasesMutations()
  const { snapshot } = useTransactionalState()

  const [selectedPurchaseId, setSelectedPurchaseId] =
    useState<string | null>(null)
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [isDetailsNotFound, setIsDetailsNotFound] = useState(false)

  const [history, setHistory] = useState<PurchasesHistory | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const historyRequestGeneration = useRef(0)
  const detailsRequestGeneration = useRef(0)

  const [isCreateOpen, setIsCreateOpen] =
    useState(false)

  const [purchaseToCancel, setPurchaseToCancel] =
    useState<string | null>(null)

  const [error, setError] = useState<string | null>(
    null,
  )

  const [purchaseDate, setPurchaseDate] =
    useState('')
  const [nextPurchaseNumber, setNextPurchaseNumber] = useState<string | null>(null)
  const [isPurchaseNumberLoading, setIsPurchaseNumberLoading] = useState(false)

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

  function refreshHistory() {
    const generation = historyRequestGeneration.current + 1
    historyRequestGeneration.current = generation
    setHistory(null)
    setIsHistoryLoading(true)
    setHistoryError(null)
    setLoadMoreError(null)

    void getPurchasesHistory()
      .then((response) => {
        if (historyRequestGeneration.current !== generation) return
        setHistory(response)
      })
      .catch((currentError: unknown) => {
        if (historyRequestGeneration.current !== generation) return
        setHistoryError(getPurchasesErrorMessage(currentError))
      })
      .finally(() => {
        if (historyRequestGeneration.current === generation) {
          setIsHistoryLoading(false)
        }
      })
  }

  function requestPurchaseDetails(purchaseId: string) {
    const generation = detailsRequestGeneration.current + 1
    detailsRequestGeneration.current = generation
    setIsDetailsLoading(true)
    setDetailsError(null)
    setIsDetailsNotFound(false)
    setSelectedPurchase(null)

    void getPurchaseById(purchaseId)
      .then((purchase) => {
        if (detailsRequestGeneration.current !== generation) return
        setSelectedPurchase(purchase)
      })
      .catch((currentError: unknown) => {
        if (detailsRequestGeneration.current !== generation) return
        setSelectedPurchase(null)
        if (currentError instanceof HttpError && currentError.status === 404) {
          setIsDetailsNotFound(true)
          return
        }
        setDetailsError(getPurchasesErrorMessage(currentError))
      })
      .finally(() => {
        if (detailsRequestGeneration.current === generation) {
          setIsDetailsLoading(false)
        }
      })
  }

  function openPurchaseDetails(purchaseId: string) {
    setSelectedPurchaseId(purchaseId)
    requestPurchaseDetails(purchaseId)
  }

  function closePurchaseDetails() {
    detailsRequestGeneration.current += 1
    setSelectedPurchaseId(null)
    setSelectedPurchase(null)
    setDetailsError(null)
    setIsDetailsNotFound(false)
    setIsDetailsLoading(false)
  }

  useEffect(() => {
    refreshHistory()
  }, [snapshot])

  useEffect(() => {
    if (selectedPurchaseId) requestPurchaseDetails(selectedPurchaseId)
  }, [snapshot])

  async function loadMore(): Promise<void> {
    const cursor = history?.purchases.nextCursor
    if (!cursor || isHistoryLoading || isLoadingMore) return

    const generation = historyRequestGeneration.current
    setIsLoadingMore(true)
    setLoadMoreError(null)
    try {
      const response = await getPurchasesHistory({ cursor })
      if (historyRequestGeneration.current !== generation) return
      setHistory((current) => current
        ? {
          purchases: {
            items: [...current.purchases.items, ...response.purchases.items],
            nextCursor: response.purchases.nextCursor,
          },
        }
        : current)
    } catch (currentError) {
      if (historyRequestGeneration.current !== generation) return
      setLoadMoreError(getPurchasesErrorMessage(currentError))
    } finally {
      if (historyRequestGeneration.current === generation) {
        setIsLoadingMore(false)
      }
    }
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

  async function savePurchase() {
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

    if (!nextPurchaseNumber) {
      setError('Не удалось получить номер поступления с сервера.')
      return
    }

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

    const newPurchase: Parameters<typeof addPurchase>[0] = {
      id: `purchase-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      purchaseNumber: nextPurchaseNumber,
      purchaseDate: resolveBusinessDateStart(purchaseDate),
      supplierName: supplierName.trim(),
      items: purchaseItems,
      totalAmount,
      paymentMethod,
      status: 'draft',
      note: note.trim() || undefined,
    }

    const result = await addPurchase(newPurchase)

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось создать закупку',
        message:
          result.message ??
          'Не удалось сохранить закупку.',
      })

      return
    }

    showToast({
      variant: 'success',
      title: 'Закупка создана',
      message: 'Новая закупка успешно добавлена',
    })

    setError(null)
    if (result.value?.id) openPurchaseDetails(result.value.id)

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
    setNextPurchaseNumber(null)
    setIsPurchaseNumberLoading(true)

    setFormItems([
      {
        productId:
          firstProduct?.id ?? '',
        quantity: 1,
        unitCost: 0,
      },
    ])

    setIsCreateOpen(true)

    void getNextPurchaseNumber()
      .then((response) => setNextPurchaseNumber(response.purchaseNumber))
      .catch((currentError: unknown) => setError(getPurchasesErrorMessage(currentError)))
      .finally(() => setIsPurchaseNumberLoading(false))
  }

  const purchases = history?.purchases.items ?? []

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
            {isHistoryLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="purchases__empty">
                  Загрузка поступлений…
                </TableCell>
              </TableRow>
            ) : historyError ? (
              <TableRow>
                <TableCell colSpan={7} className="purchases__empty">
                  <Alert variant="danger" title="Не удалось загрузить поступления">
                    {historyError}
                  </Alert>
                  <Button type="button" variant="secondary" onClick={refreshHistory}>
                    Повторить
                  </Button>
                </TableCell>
              </TableRow>
            ) : purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    title="Поступлений пока нет"
                    description="Создайте первое поступление товара, чтобы оно появилось в списке."
                  />
                </TableCell>
              </TableRow>
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
                    {purchase.itemCount}
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
                        openPurchaseDetails(purchase.id)
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

      {loadMoreError && (
        <div className="purchases__load-more-error">
          <Alert variant="danger" title="Не удалось загрузить следующие поступления">
            {loadMoreError}
          </Alert>
        </div>
      )}

      {history?.purchases.nextCursor && !isHistoryLoading && (
        <div className="purchases__load-more">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Загрузка…' : 'Показать ещё'}
          </Button>
        </div>
      )}

      {selectedPurchaseId && (
        <Card
          className="purchases__purchase-card"
          padding="lg"
        >
          <div className="purchases__purchase-card-header">
            <div>
              <h2>{selectedPurchase?.purchaseNumber ?? 'Поступление'}</h2>

              <p>
                {selectedPurchase?.supplierName ?? ''}
              </p>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setError(null)
                closePurchaseDetails()
              }}
              aria-label="Закрыть карточку"
            >
              ×
            </Button>
          </div>

          {isDetailsLoading ? (
            <div className="purchases__empty">Загрузка поступления…</div>
          ) : detailsError ? (
            <>
              <Alert variant="danger" title="Не удалось загрузить поступление">
                {detailsError}
              </Alert>
              <div className="purchases__purchase-card-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => requestPurchaseDetails(selectedPurchaseId)}
                >
                  Повторить
                </Button>
              </div>
            </>
          ) : isDetailsNotFound ? (
            <Alert variant="danger" title="Поступление не найдено">
              Возможно, оно было удалено или недоступно.
            </Alert>
          ) : selectedPurchase && <>
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
                  onClick={async () => {
                    setError(null)
                    const result = await completePurchase(selectedPurchase.id)

                    if (!result.success) {
                      showToast({
                        variant: 'error',
                        title: 'Ошибка завершения поступления',
                        message: result.message ?? 'Не удалось завершить поступление.',
                      })
                      return
                    }

                    showToast({
                      variant: 'success',
                      title: 'Закупка завершена',
                      message: 'Товары добавлены на склад',
                    })
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
                closePurchaseDetails()
              }}
            >
              Закрыть
            </Button>
          </div>
          </>}
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
              <span>Номер поступления</span>
              <Input fullWidth value={nextPurchaseNumber ?? ''} readOnly placeholder={isPurchaseNumberLoading ? 'Загрузка…' : 'Номер недоступен'} />
            </label>

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
              disabled={!nextPurchaseNumber || isPurchaseNumberLoading}
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
        onConfirm={async () => {
          if (!purchaseToCancel) {
            return
          }

          setError(null)

          const result = await cancelPurchase(purchaseToCancel)

          if (!result.success) {
            showToast({
              variant: 'error',
              title: 'Не удалось отменить закупку',
              message:
                result.message ??
                'Не удалось сохранить изменение закупки.',
            })

            return
          }

          showToast({
            variant: 'success',
            title: 'Закупка отменена',
            message: 'Статус закупки изменён на отменённую',
          })

          setPurchaseToCancel(null)
        }}
      />
    </section >
  )
}
