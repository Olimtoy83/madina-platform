import type {
  AdjustProductStockRequest,
  CommerceCompletionResponse,
  CreateProductRequest,
  CreatePurchaseRequest,
  CreateSaleRequest,
  ImportCommerceSnapshotRequest,
  ImportCommerceSnapshotResponse,
  ImportProductsResponse,
  ProductWorkbookRowError,
  ProductWorkbookValidationErrorResponse,
  ProductResponse,
  ProductsListResponse,
  PurchaseResponse,
  PurchasesListResponse,
  SaleResponse,
  SalesListResponse,
  StockAdjustmentResponse,
  StockMovementsListResponse,
  UpdateProductRequest,
  UpdatePurchaseRequest,
  UpdateSaleRequest,
} from '@madina/api'
import {
  HttpError,
  requestJson,
  requestResponse,
} from './httpClient'

const commerceUrl = '/api/v1/commerce'
const productImportTemplateFilename =
  'madina-products-import-template-v1.xlsx'
const productExportFilename = 'madina-products.xlsx'

export interface CommerceAggregateResponse {
  products: ProductResponse[]
  stockMovements: StockMovementsListResponse['stockMovements']
  purchases: PurchaseResponse[]
  sales: SaleResponse[]
}

export async function getCommerceAggregate(): Promise<CommerceAggregateResponse> {
  const [
    products,
    stockMovements,
    purchases,
    sales,
  ] = await Promise.all([
    requestJson<ProductsListResponse>(`${commerceUrl}/products`),
    requestJson<StockMovementsListResponse>(`${commerceUrl}/stock-movements`),
    requestJson<PurchasesListResponse>(`${commerceUrl}/purchases`),
    requestJson<SalesListResponse>(`${commerceUrl}/sales`),
  ])

  return {
    products: products.products,
    stockMovements: stockMovements.stockMovements,
    purchases: purchases.purchases,
    sales: sales.sales,
  }
}

export function createProduct(input: CreateProductRequest): Promise<ProductResponse> {
  return requestJson<ProductResponse>(`${commerceUrl}/products`, {
    method: 'POST',
    body: input,
  })
}

export function updateProduct(
  productId: string,
  input: UpdateProductRequest,
): Promise<ProductResponse> {
  return requestJson<ProductResponse>(
    `${commerceUrl}/products/${encodeURIComponent(productId)}`,
    { method: 'PATCH', body: input },
  )
}

export function deactivateProduct(productId: string): Promise<ProductResponse> {
  return requestJson<ProductResponse>(
    `${commerceUrl}/products/${encodeURIComponent(productId)}/deactivate`,
    { method: 'POST' },
  )
}

export function adjustProductStock(
  productId: string,
  input: AdjustProductStockRequest,
): Promise<StockAdjustmentResponse> {
  return requestJson<StockAdjustmentResponse>(
    `${commerceUrl}/products/${encodeURIComponent(productId)}/stock-adjustments`,
    { method: 'POST', body: input },
  )
}

export function createPurchase(input: CreatePurchaseRequest): Promise<PurchaseResponse> {
  return requestJson<PurchaseResponse>(`${commerceUrl}/purchases`, {
    method: 'POST',
    body: input,
  })
}

export function updatePurchase(
  purchaseId: string,
  input: UpdatePurchaseRequest,
): Promise<PurchaseResponse> {
  return requestJson<PurchaseResponse>(
    `${commerceUrl}/purchases/${encodeURIComponent(purchaseId)}`,
    { method: 'PATCH', body: input },
  )
}

export function cancelPurchase(purchaseId: string): Promise<PurchaseResponse> {
  return requestJson<PurchaseResponse>(
    `${commerceUrl}/purchases/${encodeURIComponent(purchaseId)}/cancel`,
    { method: 'POST' },
  )
}

export function completePurchase(purchaseId: string): Promise<CommerceCompletionResponse> {
  return requestJson<CommerceCompletionResponse>(
    `${commerceUrl}/purchases/${encodeURIComponent(purchaseId)}/complete`,
    { method: 'POST' },
  )
}

export function createSale(input: CreateSaleRequest): Promise<SaleResponse> {
  return requestJson<SaleResponse>(`${commerceUrl}/sales`, {
    method: 'POST',
    body: input,
  })
}

export function updateSale(
  saleId: string,
  input: UpdateSaleRequest,
): Promise<SaleResponse> {
  return requestJson<SaleResponse>(
    `${commerceUrl}/sales/${encodeURIComponent(saleId)}`,
    { method: 'PATCH', body: input },
  )
}

export function cancelSale(saleId: string): Promise<SaleResponse> {
  return requestJson<SaleResponse>(
    `${commerceUrl}/sales/${encodeURIComponent(saleId)}/cancel`,
    { method: 'POST' },
  )
}

export function completeSale(saleId: string): Promise<CommerceCompletionResponse> {
  return requestJson<CommerceCompletionResponse>(
    `${commerceUrl}/sales/${encodeURIComponent(saleId)}/complete`,
    { method: 'POST' },
  )
}

export function importCommerceSnapshot(
  input: ImportCommerceSnapshotRequest,
): Promise<ImportCommerceSnapshotResponse> {
  return requestJson<ImportCommerceSnapshotResponse>(
    '/api/v1/commerce/import',
    {
      method: 'POST',
      body: input,
    },
  )
}

export async function downloadProductImportTemplate(): Promise<void> {
  await downloadProductWorkbook(
    `${commerceUrl}/products/import-template`,
    productImportTemplateFilename,
  )
}

export async function exportProducts(): Promise<void> {
  await downloadProductWorkbook(
    `${commerceUrl}/products/export`,
    productExportFilename,
  )
}

export async function importProductsExcel(
  file: File,
): Promise<ImportProductsResponse> {
  const formData = new FormData()
  formData.append('file', file, file.name)

  const response = await requestResponse(
    `${commerceUrl}/products/import`,
    {
      method: 'POST',
      body: formData,
    },
  )

  return (await response.json()) as ImportProductsResponse
}

export function getProductWorkbookValidationError(
  error: unknown,
): ProductWorkbookValidationErrorResponse | undefined {
  if (!(error instanceof HttpError) || error.status !== 422) {
    return undefined
  }

  const body = error.body
  if (!isProductWorkbookValidationErrorResponse(body)) {
    return undefined
  }

  return body
}

async function downloadProductWorkbook(
  url: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await requestResponse(url)
  const blob = await response.blob()
  const filename = getDownloadFilename(
    response.headers.get('Content-Disposition'),
    fallbackFilename,
  )
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  try {
    anchor.href = objectUrl
    anchor.download = filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  }
}

function getDownloadFilename(
  contentDisposition: string | null,
  fallbackFilename: string,
): string {
  const filename = contentDisposition
    ?.match(/filename="?([^";]+)"?/i)?.[1]

  return filename && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
    ? filename
    : fallbackFilename
}

function isProductWorkbookValidationErrorResponse(
  value: unknown,
): value is ProductWorkbookValidationErrorResponse {
  if (!value || typeof value !== 'object') return false

  const record = value as {
    statusCode?: unknown
    error?: unknown
    message?: unknown
    errors?: unknown
  }

  return record.statusCode === 422 &&
    record.error === 'Unprocessable Entity' &&
    typeof record.message === 'string' &&
    Array.isArray(record.errors) &&
    record.errors.every(isProductWorkbookRowError)
}

function isProductWorkbookRowError(
  value: unknown,
): value is ProductWorkbookRowError {
  if (!value || typeof value !== 'object') return false

  const record = value as {
    row?: unknown
    column?: unknown
    code?: unknown
    message?: unknown
  }

  return typeof record.row === 'number' &&
    (record.column === undefined || typeof record.column === 'string') &&
    typeof record.code === 'string' &&
    typeof record.message === 'string'
}
