export interface CompletePurchaseRequest {
  purchaseId: string
}

export interface CompleteSaleRequest {
  saleId: string
}

export interface CommerceCompletionResponse {
  success: boolean
  idempotent: boolean
  message?: string
}

export interface CreateProductRequest {
  name: string
  category: ProductResponse['category']
  unit: ProductResponse['unit']
  costPrice: number
  salePrice: number
  status: ProductResponse['status']
  initialQuantity: number
}

export type UpdateProductRequest = Partial<Pick<
  CreateProductRequest,
  'name' | 'category' | 'unit' | 'costPrice' | 'salePrice' | 'status'
>>

export interface AdjustProductStockRequest {
  quantity: number
  note?: string
}

export interface StockAdjustmentResponse {
  product: ProductResponse
  stockMovement: StockMovementResponse
}

export interface CreatePurchaseRequest {
  purchaseNumber: string
  purchaseDate: string
  supplierName: string
  items: PurchaseResponse['items']
  paymentMethod: PurchaseResponse['paymentMethod']
  note?: string
}

export type UpdatePurchaseRequest = Partial<Pick<
  CreatePurchaseRequest,
  'purchaseDate' | 'supplierName' | 'items' | 'paymentMethod' | 'note'
>>

export interface CreateSaleRequest {
  saleNumber: string
  saleDate: string
  clientId?: string
  clientName: string
  items: SaleResponse['items']
  paymentMethod: SaleResponse['paymentMethod']
  note?: string
}

export type UpdateSaleRequest = Partial<Pick<
  CreateSaleRequest,
  'saleDate' | 'clientId' | 'clientName' | 'items' | 'paymentMethod' | 'note'
>>

export interface ProductResponse {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  category: 'dry-fruits' | 'dates' | 'perfume' | 'carpets'
  quantity: number
  unit: 'kg' | 'piece' | 'liter' | 'box'
  costPrice: number
  salePrice: number
  status: 'active' | 'inactive'
}

export interface StockMovementResponse {
  id: string
  createdAt: string
  updatedAt: string
  productId: string
  type: 'purchase' | 'sale' | 'adjustment'
  quantity: number
  unit: ProductResponse['unit']
  referenceId?: string
  note?: string
}

export interface PurchaseResponse {
  id: string
  createdAt: string
  updatedAt: string
  purchaseNumber: string
  purchaseDate: string
  supplierName: string
  items: Array<{
    productId: string
    quantity: number
    unit: ProductResponse['unit']
    unitCost: number
    totalCost: number
  }>
  totalAmount: number
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'other'
  status: 'draft' | 'completed' | 'cancelled'
  note?: string
}

export interface SaleResponse {
  id: string
  createdAt: string
  updatedAt: string
  saleNumber: string
  saleDate: string
  clientId?: string
  clientName: string
  items: Array<{
    productId: string
    quantity: number
    unit: ProductResponse['unit']
    unitPrice: number
    totalAmount: number
  }>
  totalAmount: number
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'other'
  status: 'draft' | 'completed' | 'cancelled'
  note?: string
}

export interface TransactionResponse {
  id: string
  createdAt: string
  updatedAt: string
  type: 'income' | 'expense'
  category: 'sale' | 'purchase' | 'other'
  amount: number
  paymentMethod: 'cash' | 'card' | 'bank-transfer' | 'other'
  transactionDate: string
  referenceId?: string
  description?: string
  status: 'pending' | 'completed' | 'cancelled'
}

export interface ProductsListResponse { products: ProductResponse[] }
export interface StockMovementsListResponse { stockMovements: StockMovementResponse[] }
export interface StockMovementHistoryQuery {
  productId?: string
  type?: StockMovementResponse['type']
  dateFrom?: string
  dateTo?: string
  limit?: string
  cursor?: string
}

export interface StockMovementHistoryResponse {
  summary: {
    totalMovements: number
    totalPurchases: number
    totalSales: number
  }
  stockMovements: {
    items: StockMovementResponse[]
    nextCursor?: string
  }
}

export interface StockIntegrityDiscrepancyResponse {
  productId: string
  productName: string
  actualQuantity: number
  calculatedQuantity: number
  difference: number
}

export interface StockMovementIntegrityResponse {
  discrepancies: StockIntegrityDiscrepancyResponse[]
}
export interface PurchasesListResponse { purchases: PurchaseResponse[] }
export interface PurchaseListItemResponse {
  id: string
  purchaseNumber: string
  purchaseDate: string
  supplierName: string
  itemCount: number
  totalAmount: number
  status: PurchaseResponse['status']
}
export interface PurchasesHistoryQuery {
  limit?: string
  cursor?: string
}
export interface PurchasesHistoryResponse {
  purchases: { items: PurchaseListItemResponse[]; nextCursor?: string }
}
export interface NextPurchaseNumberResponse { purchaseNumber: string }
export interface SalesListResponse { sales: SaleResponse[] }
export interface SaleListItemResponse {
  id: string
  saleNumber: string
  saleDate: string
  clientId?: string
  clientName: string
  totalAmount: number
  paymentMethod: SaleResponse['paymentMethod']
  status: SaleResponse['status']
}

export interface SalesHistoryQuery {
  status?: SaleResponse['status']
  clientId?: string
  limit?: string
  cursor?: string
}

export interface SalesHistoryResponse {
  summary: {
    totalCount: number
    draftCount: number
    completedCount: number
    totalAmount: number
  }
  sales: { items: SaleListItemResponse[]; nextCursor?: string }
}

export interface ClientSalesHistoryResponse {
  summary: {
    completedCount: number
    completedTotalAmount: number
    lastSaleDate?: string
  }
  sales: { items: SaleListItemResponse[]; nextCursor?: string }
}

export interface ClientSalesMetricsRequest { clientIds: string[] }
export interface ClientSalesMetricsResponse {
  metrics: Array<{
    clientId: string
    completedCount: number
    completedTotalAmount: number
    lastSaleDate?: string
  }>
}

export interface NextSaleNumberResponse { saleNumber: string }
export interface TransactionsListResponse { transactions: TransactionResponse[] }

export interface ImportCommerceSnapshotRequest {
  products: ProductResponse[]
  stockMovements: StockMovementResponse[]
  purchases: PurchaseResponse[]
  sales: SaleResponse[]
  transactions: TransactionResponse[]
}

export interface ImportCommerceSnapshotResponse {
  imported: boolean
  idempotent: boolean
}

export interface ProductWorkbookRowError {
  row: number
  column?: string
  code: string
  message: string
}

export interface ImportProductsResponse {
  importedCount: number
  initialStockMovementCount: number
}

export interface ProductWorkbookValidationErrorResponse {
  statusCode: 422
  error: 'Unprocessable Entity'
  message: string
  errors: ProductWorkbookRowError[]
}
