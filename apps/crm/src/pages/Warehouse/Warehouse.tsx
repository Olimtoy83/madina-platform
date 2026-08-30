import {
  useEffect,
  useRef,
  useState,
} from 'react'
import { useProducts } from '../../context/useProducts'
import { useToast } from '../../context/ToastProvider'
import { usePendingCommand } from '../../shared/usePendingCommand'
import { useAuth } from '../../context/useAuth'
import { useTransactionalState } from '../../context/useTransactionalState'
import {
  downloadProductImportTemplate,
  exportProducts,
  getProductWorkbookValidationError,
  getStockMovementIntegrity,
  importProductsExcel,
} from '../../shared/api/commerceApi'
import { HttpError } from '../../shared/api/httpClient'

import {
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
  FileUpload,
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
import type {
  ImportProductsResponse,
  ProductWorkbookRowError,
  StockIntegrityDiscrepancyResponse,
} from '@madina/api'

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

const maxProductImportBytes = 10 * 1_024 * 1_024

function getProductWorkbookErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return 'Сессия истекла. Войдите в систему повторно.'
    }

    if (error.status === 403) {
      return 'У вас нет прав для этого действия.'
    }

    if (error.status === 413) {
      return 'Размер файла превышает допустимый предел 10 МиБ.'
    }

    return error.message
  }

  return error instanceof Error
    ? error.message
    : 'Не удалось выполнить запрос. Повторите попытку.'
}

function formatProductWorkbookRowError(
  error: ProductWorkbookRowError,
): string {
  const location = error.row > 0
    ? `Строка ${error.row}${error.column ? `, поле ${error.column}` : ''}`
    : error.column
      ? `Поле ${error.column}`
      : 'Файл'

  return `${location}: ${error.message}`
}

export function Warehouse() {
  const { showToast } = useToast()
  const { isPending, run } = usePendingCommand()
  const { user } = useAuth()
  const { reload, snapshot } = useTransactionalState()
  const {
    products,
    addProduct,
    deactivateProduct,
    updateProduct,
    adjustProductStock,
  } = useProducts()

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

  const [isProductImportOpen, setIsProductImportOpen] =
    useState(false)

  const [importFile, setImportFile] = useState<File | null>(null)
  const [importFileKey, setImportFileKey] = useState(0)
  const [isImportingProducts, setIsImportingProducts] = useState(false)
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false)
  const [isExportingProducts, setIsExportingProducts] = useState(false)
  const [productImportError, setProductImportError] = useState<string | null>(null)
  const [productImportRowErrors, setProductImportRowErrors] =
    useState<ProductWorkbookRowError[]>([])
  const [productImportResult, setProductImportResult] =
    useState<ImportProductsResponse | null>(null)

  const [validationError, setValidationError] =
    useState<string | null>(null)
  const [stockIntegrityDiscrepancies, setStockIntegrityDiscrepancies] =
    useState<StockIntegrityDiscrepancyResponse[]>([])
  const [stockIntegrityError, setStockIntegrityError] =
    useState<string | null>(null)
  const integrityRequestGeneration = useRef(0)

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

  useEffect(() => {
    const generation = integrityRequestGeneration.current + 1
    integrityRequestGeneration.current = generation

    void getStockMovementIntegrity()
      .then((response) => {
        if (integrityRequestGeneration.current !== generation) return

        setStockIntegrityDiscrepancies(response.discrepancies)
        setStockIntegrityError(null)
      })
      .catch((error: unknown) => {
        if (integrityRequestGeneration.current !== generation) return

        setStockIntegrityError(
          error instanceof Error
            ? error.message
            : 'Не удалось проверить согласованность остатков.',
        )
      })
  }, [snapshot])

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

  async function handleAdjustment() {
    if (!selectedProduct) return

    const quantity = Number(adjustmentQuantity)

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return
    }

    const signedQuantity =
      adjustmentType === 'increase'
        ? quantity
        : -quantity

    const command = await run(
      `product.adjust:${selectedProduct.id}`,
      () => adjustProductStock(
        selectedProduct.id,
        signedQuantity,
        adjustmentNote.trim() ||
        'Корректировка остатка',
      ),
    )

    if (!command.started || !command.value) {
      return
    }

    const result = command.value

    if (!result.success || !result.value) {
      showToast({
        variant: 'error',
        title: 'Не удалось изменить остаток',
        message: result.message ?? 'Не удалось сохранить изменение на сервере.',
      })
      return
    }

    setSelectedProduct(result.value)

    showToast({
      variant: 'success',
      title: 'Остаток изменён',
      message: `Количество товара обновлено`,
    })

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

  async function handleSaveEdit() {
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

    const command = await run(
      `product.update:${updatedProduct.id}`,
      () => updateProduct(
        updatedProduct.id,
        {
          name: updatedProduct.name,
          category: updatedProduct.category,
          unit: updatedProduct.unit,
          costPrice: updatedProduct.costPrice,
          salePrice: updatedProduct.salePrice,
          status: updatedProduct.status,
        },
      ),
    )

    if (!command.started || !command.value) {
      return
    }

    const result = command.value

    if (!result.success || !result.value) {
      setValidationError(result.message ?? 'Не удалось сохранить изменение товара.')
      return
    }

    setSelectedProduct(result.value)
    setValidationError(null)
    setIsEditing(false)

    showToast({
      variant: 'success',
      title: 'Товар обновлён',
    })
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

  function openProductImport() {
    setImportFile(null)
    setImportFileKey((key) => key + 1)
    setProductImportError(null)
    setProductImportRowErrors([])
    setProductImportResult(null)
    setIsProductImportOpen(true)
  }

  function closeProductImport() {
    if (isImportingProducts) return

    setIsProductImportOpen(false)
  }

  function handleProductImportFiles(files: File[]) {
    setProductImportError(null)
    setProductImportRowErrors([])
    setProductImportResult(null)

    if (files.length !== 1) {
      setImportFile(null)
      setProductImportError('Выберите один файл Excel.')
      return
    }

    const [file] = files
    if (!file) return

    if (!/\.xlsx$/i.test(file.name)) {
      setImportFile(null)
      setProductImportError('Поддерживаются только файлы Excel в формате .xlsx.')
      return
    }

    if (file.size > maxProductImportBytes) {
      setImportFile(null)
      setProductImportError('Размер файла не должен превышать 10 МиБ.')
      return
    }

    setImportFile(file)
  }

  async function handleDownloadTemplate() {
    setIsDownloadingTemplate(true)

    try {
      await downloadProductImportTemplate()
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Не удалось скачать шаблон',
        message: getProductWorkbookErrorMessage(error),
      })
    } finally {
      setIsDownloadingTemplate(false)
    }
  }

  async function handleExportProducts() {
    setIsExportingProducts(true)

    try {
      await exportProducts()
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Не удалось экспортировать товары',
        message: getProductWorkbookErrorMessage(error),
      })
    } finally {
      setIsExportingProducts(false)
    }
  }

  async function handleProductImport() {
    if (!importFile || isImportingProducts) return

    setIsImportingProducts(true)
    setProductImportError(null)
    setProductImportRowErrors([])

    try {
      const result = await importProductsExcel(importFile)
      await reload()
      setProductImportResult(result)
      setImportFile(null)
      setImportFileKey((key) => key + 1)
    } catch (error) {
      const validationError = getProductWorkbookValidationError(error)

      if (validationError) {
        setProductImportError(validationError.message)
        setProductImportRowErrors([...validationError.errors])
      } else {
        setProductImportError(getProductWorkbookErrorMessage(error))
      }
    } finally {
      setIsImportingProducts(false)
    }
  }

  function cancelAdding() {
    setIsAdding(false)
  }

  async function handleAddProduct() {
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

    const command = await run(
      'product.create',
      () => addProduct(newProduct),
    )

    if (!command.started || !command.value) {
      return
    }

    const result = command.value

    if (!result.success) {
      showToast({
        variant: 'error',
        title: 'Не удалось добавить товар',
        message: result.message ?? 'Не удалось сохранить товар на сервере.',
      })
      return
    }

    showToast({
      variant: 'success',
      title: 'Товар добавлен',
      message: newProduct.name,
    })

    setIsAdding(false)
  }

  function startDeactivation() {
    setIsDeactivateConfirmOpen(true)
  }

  function cancelDeactivation() {
    setIsDeactivateConfirmOpen(false)
  }

  async function confirmDeactivation() {
    if (!selectedProduct) return

    const command = await run(
      `product.deactivate:${selectedProduct.id}`,
      () => deactivateProduct(selectedProduct.id),
    )

    if (!command.started || !command.value) {
      return
    }

    const result = command.value

    if (!result.success || !result.value) {
      showToast({
        variant: 'error',
        title: 'Не удалось отключить товар',
        message:
          result.message ??
          'Не удалось сохранить изменение товара.',
      })

      return
    }

    setSelectedProduct(result.value)
    setIsDeactivateConfirmOpen(false)

    showToast({
      variant: 'success',
      title: 'Товар отключён',
    })
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

        <div className="warehouse__header-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={handleDownloadTemplate}
            disabled={isDownloadingTemplate}
          >
            {isDownloadingTemplate
              ? 'Скачивание шаблона…'
              : 'Скачать шаблон Excel'}
          </Button>

          {user?.role === 'admin' && (
            <Button
              type="button"
              variant="secondary"
              onClick={openProductImport}
            >
              Импорт Excel
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            onClick={handleExportProducts}
            disabled={isExportingProducts}
          >
            {isExportingProducts
              ? 'Экспорт…'
              : 'Экспорт Excel'}
          </Button>

          <Button
            type="button"
            className="warehouse__add-button"
            onClick={startAdding}
          >
            Добавить товар
          </Button>
        </div>
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

      {stockIntegrityError && (
        <Alert
          variant="danger"
          title="Не удалось проверить согласованность остатков"
        >
          {stockIntegrityError}
        </Alert>
      )}

      {!stockIntegrityError && stockIntegrityDiscrepancies.length > 0 && (
        <Alert
          variant="danger"
          title="Обнаружено расхождение остатков"
        >
          <p className="warehouse__integrity-summary">
            Найдено товаров с расхождением:{' '}
            {stockIntegrityDiscrepancies.length}.
            Проверьте остатки и историю движений склада.
          </p>

          <ul className="warehouse__integrity-list">
            {stockIntegrityDiscrepancies.map(
              (discrepancy) => (
                <li key={discrepancy.productId}>
                  <strong>
                    {discrepancy.productName}
                  </strong>
                  {' — '}
                  фактически:{' '}
                  {discrepancy.actualQuantity},
                  по движениям:{' '}
                  {discrepancy.calculatedQuantity},
                  разница:{' '}
                  {discrepancy.difference > 0
                    ? '+'
                    : ''}
                  {discrepancy.difference}
                </li>
              ),
            )}
          </ul>
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

      <Modal
        open={isProductImportOpen}
        onClose={closeProductImport}
        title="Импорт товаров из Excel"
        description="Импорт создаёт новые товары. Существующие товары не обновляются."
        size="lg"
        closeOnEscape={!isImportingProducts}
        closeOnOverlayClick={!isImportingProducts}
      >
        {productImportResult ? (
          <div className="warehouse__import-result" role="status">
            <p>Импорт завершён успешно.</p>
            <p>Импортировано товаров: {productImportResult.importedCount}</p>
            <p>
              Создано начальных складских движений:{' '}
              {productImportResult.initialStockMovementCount}
            </p>

            <div className="warehouse__product-card-actions">
              <Button type="button" onClick={closeProductImport}>
                Готово
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="warehouse__import-instructions">
              Скачайте шаблон, заполните его и выберите готовый файл .xlsx.
              Проверка данных выполняется сервером до создания товаров.
            </p>

            <div className="warehouse__import-template-action">
              <Button
                type="button"
                variant="secondary"
                onClick={handleDownloadTemplate}
                disabled={isDownloadingTemplate || isImportingProducts}
              >
                {isDownloadingTemplate
                  ? 'Скачивание шаблона…'
                  : 'Скачать шаблон'}
              </Button>
            </div>

            <FileUpload
              key={importFileKey}
              label="Файл Excel"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple={false}
              disabled={isImportingProducts}
              hint="Файл .xlsx, не более 10 МиБ"
              error={productImportError ?? undefined}
              onFilesChange={handleProductImportFiles}
            />

            {importFile && (
              <p className="warehouse__selected-file" aria-live="polite">
                Выбран файл: {importFile.name}
              </p>
            )}

            {productImportRowErrors.length > 0 && (
              <div className="warehouse__import-errors" role="alert">
                <p>Исправьте следующие ошибки в файле:</p>
                <ul>
                  {productImportRowErrors.map((error, index) => (
                    <li key={`${error.row}-${error.column ?? 'file'}-${index}`}>
                      {formatProductWorkbookRowError(error)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="warehouse__product-card-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={closeProductImport}
                disabled={isImportingProducts}
              >
                Отмена
              </Button>

              <Button
                type="button"
                onClick={handleProductImport}
                disabled={!importFile || isImportingProducts}
              >
                {isImportingProducts
                  ? 'Импортирование…'
                  : 'Импортировать'}
              </Button>
            </div>
          </>
        )}
      </Modal>

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
              disabled={isPending('product.create')}
            >
              Отмена
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={handleAddProduct}
              disabled={
                !addForm.name.trim() ||
                isPending('product.create')
              }
            >
              {isPending('product.create')
                ? 'Сохранение…'
                : 'Сохранить товар'}
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
                  disabled={
                    isPending(`product.deactivate:${selectedProduct.id}`)
                  }
                >
                  Деактивировать
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={startAdjustment}
                  disabled={
                    isPending(`product.adjust:${selectedProduct.id}`)
                  }
                >
                  Корректировка
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={startEditing}
                  disabled={
                    isPending(`product.update:${selectedProduct.id}`)
                  }
                >
                  Редактировать
                </Button>
              </div>

              {isAdjustmentOpen && (
                <Modal
                  open={isAdjustmentOpen}
                  onClose={cancelAdjustment}
                  closeOnEscape={
                    !isPending(`product.adjust:${selectedProduct.id}`)
                  }
                  closeOnOverlayClick={
                    !isPending(`product.adjust:${selectedProduct.id}`)
                  }
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
                      disabled={
                        isPending(`product.adjust:${selectedProduct.id}`)
                      }
                    >
                      Отмена
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleAdjustment}
                      disabled={
                        !adjustmentQuantity ||
                        Number(adjustmentQuantity) <= 0 ||
                        isPending(`product.adjust:${selectedProduct.id}`)
                      }
                    >
                      {isPending(`product.adjust:${selectedProduct.id}`)
                        ? 'Сохранение…'
                        : 'Сохранить корректировку'}
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
                loading={
                  isPending(`product.deactivate:${selectedProduct.id}`)
                }
                onConfirm={confirmDeactivation}
              />
            </>
          ) : (
            <Modal
              open={isEditing}
              onClose={() => {
                if (!isPending(`product.update:${selectedProduct.id}`)) {
                  setIsEditing(false)
                }
              }}
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
                  disabled={
                    isPending(`product.update:${selectedProduct.id}`)
                  }
                >
                  Отмена
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSaveEdit}
                  disabled={
                    !editForm.name.trim() ||
                    isPending(`product.update:${selectedProduct.id}`)
                  }
                >
                  {isPending(`product.update:${selectedProduct.id}`)
                    ? 'Сохранение…'
                    : 'Сохранить'}
                </Button>
              </div>
            </Modal>
          )}
        </Card>
      )}
    </section>
  )
}
