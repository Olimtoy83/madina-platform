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
