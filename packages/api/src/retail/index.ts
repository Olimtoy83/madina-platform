export type RetailProductStatus = 'active' | 'inactive'

export interface RetailProductResponse {
  id: string
  sourceId: string
  name: string
  status: RetailProductStatus
  baseUnit: 'piece'
  createdAt: string
  updatedAt: string
}

export interface RetailProductBarcodeResponse {
  id: string
  productId: string
  value: string
  createdAt: string
  updatedAt: string
}

export interface RetailProductImportRowRequest {
  sourceRef: string
  sourceId: string
  name: string
  status?: RetailProductStatus
  barcode?: string
}

export interface RetailProductImportRequest {
  dryRun: boolean
  rows: readonly RetailProductImportRowRequest[]
}

export interface RetailInventoryBalanceResponse {
  productId: string
  locationId: string
  onHandQuantity: number
  updatedAt: string
}

export interface RetailInventoryMovementResponse {
  id: string
  productId: string
  locationId: string
  quantityDelta: number
  type: 'opening' | 'goods_receipt' | 'transfer' | 'sale' | 'return' | 'reconciliation_adjustment'
  sourceType: string
  sourceId: string
  sourceLineId: string
  createdAt: string
}

export interface RetailInventoryListItemResponse {
  productId: string
  sourceId: string
  name: string
  barcodes: string[]
  locationId: string
  onHandQuantity: number
  updatedAt?: string
}

export interface RetailInventoryListResponse {
  inventory: { items: RetailInventoryListItemResponse[]; nextCursor?: string }
}

export interface RetailInventoryMovementListItemResponse extends RetailInventoryMovementResponse {
  sourceLabel: string
}

export interface RetailInventoryMovementListResponse {
  inventory: { balance?: RetailInventoryBalanceResponse; movements: RetailInventoryMovementListItemResponse[]; nextCursor?: string }
}

export interface RetailReconciliationSessionResponse { id: string; locationId: string; purpose: 'opening' | 'daily'; status: 'open' | 'completed'; createdAt: string; createdBy: string; completedAt?: string }
export interface RetailReconciliationLineResponse { sessionId: string; productId: string; expectedQuantity: number; actualQuantity: number; variance: number; classification: 'matched' | 'shortage' | 'surplus'; recordedAt: string; recordedBy: string }

export interface RetailGoodsReceiptResponse { id: string; receiptReference: string; locationId: string; supplierReference?: string; shipmentReference?: string; notes?: string; status: 'draft' | 'completed'; createdAt: string; createdBy: string; completedAt?: string }
export interface RetailGoodsReceiptLineRequest { productId: string; quantity: number }
export interface RetailGoodsReceiptLineResponse { id: string; receiptId: string; productId: string; quantity: number }
export interface RetailGoodsReceiptListResponse { goodsReceipts: { items: RetailGoodsReceiptResponse[]; nextCursor?: string } }

export interface RetailCompletedSaleListItemResponse {
  id: string
  locationId: string
  currencyCode: string
  currencyExponent: number
  payableTotalMinor: number
  completedAt: string
  paymentMethods: string[]
  hasReturns: boolean
}

export interface RetailCompletedSalesListResponse {
  sales: {
    items: RetailCompletedSaleListItemResponse[]
    nextCursor?: string
  }
}
