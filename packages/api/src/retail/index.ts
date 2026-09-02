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

export interface RetailReconciliationSessionResponse { id: string; locationId: string; purpose: 'opening' | 'daily'; status: 'open' | 'completed'; createdAt: string; createdBy: string; completedAt?: string }
export interface RetailReconciliationLineResponse { sessionId: string; productId: string; expectedQuantity: number; actualQuantity: number; variance: number; classification: 'matched' | 'shortage' | 'surplus'; recordedAt: string; recordedBy: string }
