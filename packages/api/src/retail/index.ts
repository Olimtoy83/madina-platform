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
