import { useState } from 'react'
import { useProducts } from '../../context/useProducts'
import { usePurchases } from '../../context/usePurchases'
import { useSales } from '../../context/useSales'
import { useStockMovements } from '../../context/useStockMovements'

import {
  adjustStock,
  ProductValidationError,
  type Product,
  type ProductCategory,
  type ProductUnit,
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
} from '@madina/ui'

import './Warehouse.css'

const categoryLabels: Record<ProductCategory, string> = {
  'dry-fruits': 'Сухофрукты',
  dates: 'Финики',
  perfume: 'Парфюмерия',
  carpets: 'Ковры',
}

const unitLabels: Record<ProductUnit, string> = {
  kg: 'кг',
  piece: 'шт.',
  liter: 'л',
  box: 'кор.',
}

export function Warehouse() {

  const {
    products,
    addProduct,
    deactivateProduct,
    updateProduct,
    replaceProducts,
  } = useProducts()

  const { addMovement } =
    useStockMovements()

  const { sales } = useSales()
  const { purchases } = usePurchases()

  const [search, setSearch] = useState('')
  const [category, setCategory] =
    useState<ProductCategory | ''>('')

  const [selectedProduct, setSelectedProduct] =
    useState<Product | null>(null)

  const [isEditing, setIsEditing] =
    useState(false)

  const [isAdding, setIsAdding] =
    useState(false)

  const [isDeactivateConfirmOpen, setIsDeactivateConfirmOpen] =
    useState(false)

  const [validationError, setValidationError] =
    useState<string | null>(null)

  const [isAdjustmentOpen, setIsAdjustmentOpen] =
    useState(false)

  const [adjustmentType, setAdjustmentType] =
    useState<'increase' | 'decrease'>('increase')

  const [adjustmentQuantity, setAdjustmentQuantity] =
    useState('')

  const [adjustmentNote, setAdjustmentNote] =
    useState('')

  const [editForm, setEditForm] = useState({
    name: '',
    category: 'dry-fruits' as ProductCategory,
    unit: 'kg' as ProductUnit,
    costPrice: 0,
    salePrice: 0,
    status: 'active' as 'active' | 'inactive',
  })

  const [addForm, setAddForm] = useState({
    name: '',
    category: 'dry-fruits' as ProductCategory,
    quantity: 0,
    unit: 'kg' as ProductUnit,
    costPrice: 0,
    salePrice: 0,
    status: 'active' as 'active' | 'inactive',
  })

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name
      .toLowerCase()
      .includes(search.toLowerCase())

    const matchesCategory =
      category === '' ||
      product.category === category

    return matchesSearch && matchesCategory
  })

  function openProduct(product: Product) {
    setSelectedProduct(product)
    setIsEditing(false)
    setIsAdding(false)
    setIsDeactivateConfirmOpen(false)
  }

  function closeProduct() {
    setSelectedProduct(null)
    setIsEditing(false)
    setIsDeactivateConfirmOpen(false)
  }

  function startAdjustment() {
    if (!selectedProduct) return

    setAdjustmentType('increase')
    setAdjustmentQuantity('')
    setAdjustmentNote('')
    setIsAdjustmentOpen(true)
  }

  function cancelAdjustment() {
    setIsAdjustmentOpen(false)
    setAdjustmentQuantity('')
    setAdjustmentNote('')
  }

  function handleAdjustment() {
    if (!selectedProduct) return

    const quantity = Number(adjustmentQuantity)

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return
    }

    const signedQuantity =
      adjustmentType === 'increase'
        ? quantity
        : -quantity

    const result = adjustStock(
      products,
      selectedProduct.id,
      signedQuantity,
      undefined,
      adjustmentNote.trim() ||
      'Корректировка остатка',
    )

    if (!result.success || !result.product || !result.movement) {
      return
    }

    const updatedProduct = result.product

    replaceProducts(result.products)
    addMovement(result.movement)

    setSelectedProduct(updatedProduct)

    cancelAdjustment()
  }

  function startEditing() {
    if (!selectedProduct) return

    setEditForm({
      name: selectedProduct.name,
      category: selectedProduct.category,
      unit: selectedProduct.unit,
      costPrice: selectedProduct.costPrice,
      salePrice: selectedProduct.salePrice,
      status: selectedProduct.status,
    })

    setIsEditing(true)
  }

  function handleSaveEdit() {
    if (!selectedProduct) return

    const updatedProduct: Product = {
      ...selectedProduct,
      name: editForm.name.trim(),
      category: editForm.category,
      unit: editForm.unit,
      costPrice: editForm.costPrice,
      salePrice: editForm.salePrice,
      status: editForm.status,
      updatedAt: new Date(),
    }

    if (!updatedProduct.name) {
      return
    }

    try {
      const savedProduct = updateProduct(
        updatedProduct.id,
        {
          name: updatedProduct.name,
          category: updatedProduct.category,
          unit: updatedProduct.unit,
          costPrice: updatedProduct.costPrice,
          salePrice: updatedProduct.salePrice,
          status: updatedProduct.status,
        },
        sales,
        purchases,
      )

      if (!savedProduct) {
        return
      }

      setSelectedProduct(savedProduct)
      setValidationError(null)
      setIsEditing(false)
    } catch (error) {
      if (error instanceof ProductValidationError) {
        setValidationError(error.message)
        return
      }

      throw error
    }
  }

  function startAdding() {
    setSelectedProduct(null)
    setIsEditing(false)
    setIsDeactivateConfirmOpen(false)
    setIsAdding(true)

    setAddForm({
      name: '',
      category: 'dry-fruits',
      quantity: 0,
      unit: 'kg',
      costPrice: 0,
      salePrice: 0,
      status: 'active',
    })
  }

  function cancelAdding() {
    setIsAdding(false)
  }

  function handleAddProduct() {
    const name = addForm.name.trim()

    if (!name) {
      return
    }

    const now = new Date()

    const newProduct: Product = {
      id: `product-${Date.now()}`,
      name,
      category: addForm.category,
      quantity: addForm.quantity,
      unit: addForm.unit,
      costPrice: addForm.costPrice,
      salePrice: addForm.salePrice,
      status: addForm.status,
      createdAt: now,
      updatedAt: now,
    }

    addProduct(newProduct)

    setIsAdding(false)
  }

  function startDeactivation() {
    setIsDeactivateConfirmOpen(true)
  }

  function cancelDeactivation() {
    setIsDeactivateConfirmOpen(false)
  }

  function confirmDeactivation() {
    if (!selectedProduct) return

    const deactivatedProduct = deactivateProduct(
      selectedProduct.id,
    )

    if (!deactivatedProduct) {
      return
    }

    setSelectedProduct(deactivatedProduct)
    setIsDeactivateConfirmOpen(false)
  }

  return (
    <section className="warehouse">
      <div className="warehouse__header">
        <div>
          <h1>Warehouse</h1>

          <p>
            Управление товарами и остатками на складе
          </p>
        </div>

        <Button
          type="button"
          className="warehouse__add-button"
          onClick={startAdding}
        >
          Добавить товар
        </Button>
      </div>

      {validationError && (
        <Alert
          variant="danger"
          title="Нельзя изменить единицу товара"
          dismissible
          onDismiss={() => setValidationError(null)}
        >
          {validationError}
        </Alert>
      )}

      <div className="warehouse__toolbar">
        <Input
          type="search"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Поиск товара..."
          aria-label="Поиск товара"
        />

        <Select
          value={category}
          onChange={(event) =>
            setCategory(
              event.target.value as ProductCategory | '',
            )
          }
          aria-label="Фильтр по категории"
        >
          <option value="">Все категории</option>

          <option value="dry-fruits">
            Сухофрукты
          </option>

          <option value="dates">
            Финики
          </option>

          <option value="perfume">
            Парфюмерия
          </option>

          <option value="carpets">
            Ковры
          </option>
        </Select>
      </div>

      <Card className="warehouse__table-wrapper">
        <Table className="warehouse__table">
          <TableHead>
            <TableRow>
              <TableHeader>Товар</TableHeader>
              <TableHeader>Категория</TableHeader>
              <TableHeader>Количество</TableHeader>
              <TableHeader>Единица</TableHeader>
              <TableHeader>Себестоимость</TableHeader>
              <TableHeader>Цена продажи</TableHeader>
              <TableHeader>Статус</TableHeader>
              <TableHeader>Действия</TableHeader>
            </TableRow>
          </TableHead>

          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    title="Товары не найдены"
                    description="Добавьте первый товар, чтобы он появился в складе."
                  />
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    {product.name}
                  </TableCell>

                  <TableCell>
                    {categoryLabels[product.category]}
                  </TableCell>

                  <TableCell>
                    {product.quantity}
                  </TableCell>

                  <TableCell>
                    {unitLabels[product.unit]}
                  </TableCell>

                  <TableCell>
                    {product.costPrice} SAR
                  </TableCell>

                  <TableCell>
                    {product.salePrice} SAR
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={
                        product.status === 'active'
                          ? 'success'
                          : 'danger'
                      }
                    >
                      {product.status === 'active'
                        ? 'Активен'
                        : 'Неактивен'}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        openProduct(product)
                      }
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

      {isAdding && (
        <Modal
          open={isAdding}
          onClose={cancelAdding}
          title="Добавить товар"
          description="Создание нового товара на складе"
          size="lg"
        >
          <div className="warehouse__product-card-header">
            <div>
              <h2>Добавить товар</h2>

              <p>
                Создание нового товара на складе
              </p>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={cancelAdding}
              aria-label="Закрыть форму"
            >
              ×
            </Button>
          </div>

          <div className="warehouse__edit-form">
            <div className="warehouse__form-field">
              <label htmlFor="add-product-name">
                Название товара
              </label>

              <Input
                id="add-product-name"
                type="text"
                value={addForm.name}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    name: event.target.value,
                  })
                }
                placeholder="Например: Финики Аджва"
              />
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-category">
                Категория
              </label>

              <Select
                id="add-product-category"
                value={addForm.category}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    category:
                      event.target
                        .value as ProductCategory,
                  })
                }
              >
                <option value="dry-fruits">
                  Сухофрукты
                </option>

                <option value="dates">
                  Финики
                </option>

                <option value="perfume">
                  Парфюмерия
                </option>

                <option value="carpets">
                  Ковры
                </option>
              </Select>
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-quantity">
                Количество
              </label>

              <Input
                id="add-product-quantity"
                type="number"
                min="0"
                value={addForm.quantity}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    quantity: Number(
                      event.target.value,
                    ),
                  })
                }
              />
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-unit">
                Единица
              </label>

              <Select
                id="add-product-unit"
                value={addForm.unit}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    unit: event.target
                      .value as ProductUnit,
                  })
                }
              >
                <option value="kg">кг</option>
                <option value="piece">шт.</option>
                <option value="liter">л</option>
                <option value="box">кор.</option>
              </Select>
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-cost">
                Себестоимость
              </label>

              <Input
                id="add-product-cost"
                type="number"
                min="0"
                step="0.01"
                value={addForm.costPrice}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    costPrice: Number(
                      event.target.value,
                    ),
                  })
                }
              />
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-sale">
                Цена продажи
              </label>

              <Input
                id="add-product-sale"
                type="number"
                min="0"
                step="0.01"
                value={addForm.salePrice}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    salePrice: Number(
                      event.target.value,
                    ),
                  })
                }
              />
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-status">
                Статус
              </label>

              <Select
                id="add-product-status"
                value={addForm.status}
                onChange={(event) =>
                  setAddForm({
                    ...addForm,
                    status:
                      event.target.value as
                      | 'active'
                      | 'inactive',
                  })
                }
              >
                <option value="active">
                  Активен
                </option>

                <option value="inactive">
                  Неактивен
                </option>
              </Select>
            </div>
          </div>

          <div className="warehouse__product-card-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={cancelAdding}
            >
              Отмена
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={handleAddProduct}
              disabled={!addForm.name.trim()}
            >
              Сохранить товар
            </Button>
          </div>
        </Modal>
      )}

      {selectedProduct && (
        <Card
          className="warehouse__product-card"
          padding="lg"
        >
          <div className="warehouse__product-card-header">
            <div>
              <h2>{selectedProduct.name}</h2>

              <p>Карточка товара</p>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={closeProduct}
              aria-label="Закрыть карточку"
            >
              ×
            </Button>
          </div>

          {!isEditing ? (
            <>
              <div className="warehouse__product-details">
                <div className="warehouse__detail">
                  <span>Категория</span>

                  <strong>
                    {
                      categoryLabels[
                      selectedProduct.category
                      ]
                    }
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Количество</span>

                  <strong>
                    {selectedProduct.quantity}{' '}
                    {
                      unitLabels[
                      selectedProduct.unit
                      ]
                    }
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Себестоимость</span>

                  <strong>
                    {selectedProduct.costPrice} SAR
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Цена продажи</span>

                  <strong>
                    {selectedProduct.salePrice} SAR
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Маржа</span>

                  <strong>
                    {selectedProduct.salePrice -
                      selectedProduct.costPrice}{' '}
                    SAR
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Статус</span>

                  <Badge
                    variant={
                      selectedProduct.status === 'active'
                        ? 'success'
                        : 'danger'
                    }
                  >
                    {selectedProduct.status === 'active'
                      ? 'Активен'
                      : 'Неактивен'}
                  </Badge>
                </div>

                <div className="warehouse__detail">
                  <span>Создан</span>

                  <strong>
                    {selectedProduct.createdAt.toLocaleString(
                      'ru-RU',
                    )}
                  </strong>
                </div>

                <div className="warehouse__detail">
                  <span>Изменён</span>

                  <strong>
                    {selectedProduct.updatedAt.toLocaleString(
                      'ru-RU',
                    )}
                  </strong>
                </div>
              </div>

              <div className="warehouse__product-card-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={closeProduct}
                >
                  Закрыть
                </Button>

                <Button
                  type="button"
                  variant="danger"
                  onClick={startDeactivation}
                >
                  Деактивировать
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={startAdjustment}
                >
                  Корректировка
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={startEditing}
                >
                  Редактировать
                </Button>
              </div>

              {isAdjustmentOpen && (
                <Modal
                  open={isAdjustmentOpen}
                  onClose={cancelAdjustment}
                  title="Корректировка склада"
                  description="Изменение количества товара"
                  size="md"
                >
                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-type">
                      Тип корректировки
                    </label>

                    <Select
                      id="adjustment-type"
                      value={adjustmentType}
                      onChange={(event) =>
                        setAdjustmentType(
                          event.target.value as
                          | 'increase'
                          | 'decrease',
                        )
                      }
                    >
                      <option value="increase">
                        Увеличить остаток
                      </option>

                      <option value="decrease">
                        Уменьшить остаток
                      </option>
                    </Select>
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-quantity">
                      Количество
                    </label>

                    <Input
                      id="adjustment-quantity"
                      type="number"
                      min="0"
                      step="0.01"
                      value={adjustmentQuantity}
                      onChange={(event) =>
                        setAdjustmentQuantity(event.target.value)
                      }
                    />
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-note">
                      Причина
                    </label>

                    <Input
                      id="adjustment-note"
                      type="text"
                      value={adjustmentNote}
                      onChange={(event) =>
                        setAdjustmentNote(event.target.value)
                      }
                      placeholder="Например: пересчёт склада"
                    />
                  </div>

                  <div className="warehouse__product-card-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={cancelAdjustment}
                    >
                      Отмена
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleAdjustment}
                      disabled={
                        !adjustmentQuantity ||
                        Number(adjustmentQuantity) <= 0
                      }
                    >
                      Сохранить корректировку
                    </Button>
                  </div>
                </Modal>
              )}

              <ConfirmDialog
                open={isDeactivateConfirmOpen}
                onClose={cancelDeactivation}
                title="Деактивировать товар?"
                description={
                  selectedProduct
                    ? `Товар «${selectedProduct.name}» останется доступным в истории, но станет неактивным.`
                    : undefined
                }
                confirmLabel="Деактивировать"
                cancelLabel="Отмена"
                variant="danger"
                onConfirm={confirmDeactivation}
              />
            </>
          ) : (
            <Modal
              open={isEditing}
              onClose={() => setIsEditing(false)}
              title="Редактирование товара"
              description="Изменение данных товара на складе"
              size="lg"
            >
              <div className="warehouse__edit-form">
                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-name">
                    Название товара
                  </label>

                  <Input
                    id="edit-product-name"
                    type="text"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        name: event.target.value,
                      })
                    }
                  />
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-category">
                    Категория
                  </label>

                  <Select
                    id="edit-product-category"
                    value={editForm.category}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        category:
                          event.target.value as ProductCategory,
                      })
                    }
                  >
                    <option value="dry-fruits">
                      Сухофрукты
                    </option>

                    <option value="dates">
                      Финики
                    </option>

                    <option value="perfume">
                      Парфюмерия
                    </option>

                    <option value="carpets">
                      Ковры
                    </option>
                  </Select>
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-unit">
                    Единица
                  </label>

                  <Select
                    id="edit-product-unit"
                    value={editForm.unit}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        unit: event.target.value as ProductUnit,
                      })
                    }
                  >
                    <option value="kg">
                      кг
                    </option>

                    <option value="piece">
                      шт.
                    </option>

                    <option value="liter">
                      л
                    </option>

                    <option value="box">
                      кор.
                    </option>
                  </Select>
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-cost">
                    Себестоимость
                  </label>

                  <Input
                    id="edit-product-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.costPrice}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        costPrice: Number(event.target.value),
                      })
                    }
                  />
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-sale">
                    Цена продажи
                  </label>

                  <Input
                    id="edit-product-sale"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.salePrice}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        salePrice: Number(event.target.value),
                      })
                    }
                  />
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-status">
                    Статус
                  </label>

                  <Select
                    id="edit-product-status"
                    value={editForm.status}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        status:
                          event.target.value as
                          | 'active'
                          | 'inactive',
                      })
                    }
                  >
                    <option value="active">
                      Активен
                    </option>

                    <option value="inactive">
                      Неактивен
                    </option>
                  </Select>
                </div>
              </div>

              {isAdjustmentOpen && (
                <div className="warehouse__edit-form">
                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-type">
                      Тип корректировки
                    </label>

                    <Select
                      id="adjustment-type"
                      value={adjustmentType}
                      onChange={(event) =>
                        setAdjustmentType(
                          event.target.value as
                          | 'increase'
                          | 'decrease',
                        )
                      }
                    >
                      <option value="increase">
                        Увеличить остаток
                      </option>

                      <option value="decrease">
                        Уменьшить остаток
                      </option>
                    </Select>
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-quantity">
                      Количество
                    </label>

                    <Input
                      id="adjustment-quantity"
                      type="number"
                      min="0"
                      step="0.01"
                      value={adjustmentQuantity}
                      onChange={(event) =>
                        setAdjustmentQuantity(event.target.value)
                      }
                    />
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-note">
                      Причина
                    </label>

                    <Input
                      id="adjustment-note"
                      type="text"
                      value={adjustmentNote}
                      onChange={(event) =>
                        setAdjustmentNote(
                          event.target.value,
                        )
                      }
                      placeholder="Например: пересчёт склада"
                    />
                  </div>

                  <div className="warehouse__product-card-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={cancelDeactivation}
                    >
                      Отмена
                    </Button>

                    <Button
                      type="button"
                      variant="danger"
                      onClick={confirmDeactivation}
                    >
                      Деактивировать
                    </Button>
                  </div>
                </div>
              )}

              <div className="warehouse__product-card-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setIsEditing(false)
                  }
                >
                  Отмена
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSaveEdit}
                  disabled={!editForm.name.trim()}
                >
                  Сохранить
                </Button>
              </div>
            </Modal>
          )}
        </Card>
      )}
    </section>
  )
}
