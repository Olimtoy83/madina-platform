import { useState } from 'react'
import { useProducts } from '../../context/useProducts'
import { useStockMovements } from '../../context/useStockMovements'

import {
  adjustStock,
  type Product,
  type ProductCategory,
  type ProductUnit,
} from '@madina/core'

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
    removeProduct,
    updateProduct,
    updateProductQuantity,
  } = useProducts()

  const { addMovement } =
    useStockMovements()

  const [search, setSearch] = useState('')
  const [category, setCategory] =
    useState<ProductCategory | ''>('')

  const [selectedProduct, setSelectedProduct] =
    useState<Product | null>(null)

  const [isEditing, setIsEditing] =
    useState(false)

  const [isAdding, setIsAdding] =
    useState(false)

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] =
    useState(false)

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
    setIsDeleteConfirmOpen(false)
  }

  function closeProduct() {
    setSelectedProduct(null)
    setIsEditing(false)
    setIsDeleteConfirmOpen(false)
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

    // Обновляем Product через текущий Provider.
    // Пока ProductsProvider не умеет принимать
    // результат domain-service целиком.
    updateProductQuantity(
      updatedProduct.id,
      updatedProduct.quantity,
    )

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

    updateProduct(updatedProduct.id, {
      name: updatedProduct.name,
      category: updatedProduct.category,
      unit: updatedProduct.unit,
      costPrice: updatedProduct.costPrice,
      salePrice: updatedProduct.salePrice,
      status: updatedProduct.status,
    })

    setSelectedProduct(updatedProduct)
    setIsEditing(false)
  }

  function startAdding() {
    setSelectedProduct(null)
    setIsEditing(false)
    setIsDeleteConfirmOpen(false)
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

  function startDelete() {
    setIsDeleteConfirmOpen(true)
  }

  function cancelDelete() {
    setIsDeleteConfirmOpen(false)
  }

  function confirmDelete() {
    if (!selectedProduct) return

    removeProduct(selectedProduct.id)

    setSelectedProduct(null)
    setIsEditing(false)
    setIsDeleteConfirmOpen(false)
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

        <button
          type="button"
          className="warehouse__add-button"
          onClick={startAdding}
        >
          Добавить товар
        </button>
      </div>

      <div className="warehouse__toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Поиск товара..."
          aria-label="Поиск товара"
        />

        <select
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
        </select>
      </div>

      <div className="warehouse__table-wrapper">
        <table className="warehouse__table">
          <thead>
            <tr>
              <th>Товар</th>
              <th>Категория</th>
              <th>Количество</th>
              <th>Единица</th>
              <th>Себестоимость</th>
              <th>Цена продажи</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="warehouse__empty"
                >
                  Товары не найдены.
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>

                  <td>
                    {categoryLabels[product.category]}
                  </td>

                  <td>{product.quantity}</td>

                  <td>
                    {unitLabels[product.unit]}
                  </td>

                  <td>
                    {product.costPrice} SAR
                  </td>

                  <td>
                    {product.salePrice} SAR
                  </td>

                  <td>
                    {product.status === 'active'
                      ? 'Активен'
                      : 'Неактивен'}
                  </td>

                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        openProduct(product)
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

      {isAdding && (
        <section className="warehouse__product-card">
          <div className="warehouse__product-card-header">
            <div>
              <h2>Добавить товар</h2>

              <p>
                Создание нового товара на складе
              </p>
            </div>

            <button
              type="button"
              className="warehouse__product-card-close"
              onClick={cancelAdding}
              aria-label="Закрыть форму"
            >
              ×
            </button>
          </div>

          <div className="warehouse__edit-form">
            <div className="warehouse__form-field">
              <label htmlFor="add-product-name">
                Название товара
              </label>

              <input
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

              <select
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
              </select>
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-quantity">
                Количество
              </label>

              <input
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

              <select
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
              </select>
            </div>

            <div className="warehouse__form-field">
              <label htmlFor="add-product-cost">
                Себестоимость
              </label>

              <input
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

              <input
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

              <select
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
              </select>
            </div>
          </div>

          <div className="warehouse__product-card-actions">
            <button
              type="button"
              className="warehouse__secondary-button"
              onClick={cancelAdding}
            >
              Отмена
            </button>

            <button
              type="button"
              className="warehouse__primary-button"
              onClick={handleAddProduct}
              disabled={!addForm.name.trim()}
            >
              Сохранить товар
            </button>
          </div>
        </section>
      )}

      {selectedProduct && (
        <section className="warehouse__product-card">
          <div className="warehouse__product-card-header">
            <div>
              <h2>{selectedProduct.name}</h2>

              <p>Карточка товара</p>
            </div>

            <button
              type="button"
              className="warehouse__product-card-close"
              onClick={closeProduct}
              aria-label="Закрыть карточку"
            >
              ×
            </button>
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

                  <strong>
                    {selectedProduct.status ===
                      'active'
                      ? 'Активен'
                      : 'Неактивен'}
                  </strong>
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
                <button
                  type="button"
                  className="warehouse__secondary-button"
                  onClick={closeProduct}
                >
                  Закрыть
                </button>

                <button
                  type="button"
                  className="warehouse__secondary-button"
                  onClick={startDelete}
                >
                  Удалить
                </button>

                <button
                  type="button"
                  className="warehouse__secondary-button"
                  onClick={startAdjustment}
                >
                  Корректировка
                </button>

                <button
                  type="button"
                  className="warehouse__primary-button"
                  onClick={startEditing}
                >
                  Редактировать
                </button>
              </div>

              {isAdjustmentOpen && (
                <div className="warehouse__edit-form">
                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-type">
                      Тип корректировки
                    </label>

                    <select
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
                    </select>
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-quantity">
                      Количество
                    </label>

                    <input
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

                    <input
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
                    <button
                      type="button"
                      className="warehouse__secondary-button"
                      onClick={cancelAdjustment}
                    >
                      Отмена
                    </button>

                    <button
                      type="button"
                      className="warehouse__primary-button"
                      onClick={handleAdjustment}
                      disabled={
                        !adjustmentQuantity ||
                        Number(adjustmentQuantity) <= 0
                      }
                    >
                      Сохранить корректировку
                    </button>
                  </div>
                </div>
              )}

              {isDeleteConfirmOpen && (
                <div className="warehouse__delete-confirm">
                  <h3>Удалить товар?</h3>

                  <p>
                    Вы действительно хотите удалить
                    «{selectedProduct.name}»?
                  </p>

                  <div className="warehouse__product-card-actions">
                    <button
                      type="button"
                      className="warehouse__secondary-button"
                      onClick={cancelDelete}
                    >
                      Отмена
                    </button>

                    <button
                      type="button"
                      className="warehouse__primary-button"
                      onClick={confirmDelete}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="warehouse__edit-form">
                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-name">
                    Название товара
                  </label>

                  <input
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

                  <select
                    id="edit-product-category"
                    value={editForm.category}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
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
                  </select>
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-unit">
                    Единица
                  </label>

                  <select
                    id="edit-product-unit"
                    value={editForm.unit}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        unit: event.target
                          .value as ProductUnit,
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
                  </select>
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-cost">
                    Себестоимость
                  </label>

                  <input
                    id="edit-product-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.costPrice}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        costPrice: Number(
                          event.target.value,
                        ),
                      })
                    }
                  />
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-sale">
                    Цена продажи
                  </label>

                  <input
                    id="edit-product-sale"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.salePrice}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        salePrice: Number(
                          event.target.value,
                        ),
                      })
                    }
                  />
                </div>

                <div className="warehouse__form-field">
                  <label htmlFor="edit-product-status">
                    Статус
                  </label>

                  <select
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
                  </select>
                </div>
              </div>

              {isAdjustmentOpen && (
                <div className="warehouse__edit-form">
                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-type">
                      Тип корректировки
                    </label>

                    <select
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
                    </select>
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-quantity">
                      Количество
                    </label>

                    <input
                      id="adjustment-quantity"
                      type="number"
                      min="0"
                      step="0.01"
                      value={adjustmentQuantity}
                      onChange={(event) =>
                        setAdjustmentQuantity(
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="warehouse__form-field">
                    <label htmlFor="adjustment-note">
                      Причина
                    </label>

                    <input
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
                    <button
                      type="button"
                      className="warehouse__secondary-button"
                      onClick={cancelAdjustment}
                    >
                      Отмена
                    </button>

                    <button
                      type="button"
                      className="warehouse__primary-button"
                      onClick={handleAdjustment}
                      disabled={
                        !adjustmentQuantity ||
                        Number(adjustmentQuantity) <= 0
                      }
                    >
                      Сохранить корректировку
                    </button>
                  </div>
                </div>
              )}

              <div className="warehouse__product-card-actions">
                <button
                  type="button"
                  className="warehouse__secondary-button"
                  onClick={() =>
                    setIsEditing(false)
                  }
                >
                  Отмена
                </button>

                <button
                  type="button"
                  className="warehouse__primary-button"
                  onClick={handleSaveEdit}
                  disabled={!editForm.name.trim()}
                >
                  Сохранить
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  )
}
