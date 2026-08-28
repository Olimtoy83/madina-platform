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
export interface PurchasesListResponse { purchases: PurchaseResponse[] }
export interface SalesListResponse { sales: SaleResponse[] }
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
