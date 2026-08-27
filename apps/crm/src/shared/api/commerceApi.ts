import type {
  AdjustProductStockRequest,
  CommerceCompletionResponse,
  CreateProductRequest,
  CreatePurchaseRequest,
  CreateSaleRequest,
  ImportCommerceSnapshotRequest,
  ImportCommerceSnapshotResponse,
  ProductResponse,
  ProductsListResponse,
  PurchaseResponse,
  PurchasesListResponse,
  SaleResponse,
  SalesListResponse,
  StockAdjustmentResponse,
  StockMovementsListResponse,
  TransactionResponse,
  TransactionsListResponse,
  UpdateProductRequest,
  UpdatePurchaseRequest,
  UpdateSaleRequest,
} from '@madina/api'
import { requestJson } from './httpClient'

const commerceUrl = '/api/v1/commerce'

export interface CommerceAggregateResponse {
  products: ProductResponse[]
  stockMovements: StockMovementsListResponse['stockMovements']
  purchases: PurchaseResponse[]
  sales: SaleResponse[]
  transactions: TransactionResponse[]
}

export async function getCommerceAggregate(): Promise<CommerceAggregateResponse> {
  const [
    products,
    stockMovements,
    purchases,
    sales,
    transactions,
  ] = await Promise.all([
    requestJson<ProductsListResponse>(`${commerceUrl}/products`),
    requestJson<StockMovementsListResponse>(`${commerceUrl}/stock-movements`),
    requestJson<PurchasesListResponse>(`${commerceUrl}/purchases`),
    requestJson<SalesListResponse>(`${commerceUrl}/sales`),
    requestJson<TransactionsListResponse>(`${commerceUrl}/transactions`),
  ])

  return {
    products: products.products,
    stockMovements: stockMovements.stockMovements,
    purchases: purchases.purchases,
    sales: sales.sales,
    transactions: transactions.transactions,
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
