import type { Product } from '../inventory/index.js'
import type { Purchase } from '../purchases/index.js'
import type { Sale } from '../sales/index.js'

export interface CreateProductCommand {
  name: string
  category: Product['category']
  unit: Product['unit']
  costPrice: number
  salePrice: number
  status: Product['status']
  initialQuantity: number
}

export interface BulkCreateProductRowCommand extends CreateProductCommand {
  sourceRow: number
}

export interface BulkCreateProductsCommand {
  templateVersion: string
  rows: readonly BulkCreateProductRowCommand[]
}

export interface BulkCreateProductsResult {
  importedCount: number
  initialStockMovementCount: number
}

export interface BulkCreateProductValidationIssue {
  row: number
  column: string
  code: string
  message: string
}

export type UpdateProductCommand = Partial<Pick<
  Product,
  'name' | 'category' | 'unit' | 'costPrice' | 'salePrice' | 'status'
>>

export interface AdjustProductStockCommand {
  quantity: number
  note?: string
}

export interface CreatePurchaseCommand {
  purchaseNumber: string
  purchaseDate: Date
  supplierName: string
  items: Purchase['items']
  paymentMethod: Purchase['paymentMethod']
  note?: string
}

export type UpdatePurchaseCommand = Partial<Pick<
  Purchase,
  'purchaseDate' | 'supplierName' | 'items' | 'paymentMethod' | 'note'
>>

export interface CreateSaleCommand {
  saleNumber: string
  saleDate: Date
  clientId?: string
  clientName: string
  items: Sale['items']
  paymentMethod: Sale['paymentMethod']
  note?: string
}

export type UpdateSaleCommand = Partial<Pick<
  Sale,
  'saleDate' | 'clientId' | 'clientName' | 'items' | 'paymentMethod' | 'note'
>>

export class CommerceCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommerceCommandError'
  }
}

export class BulkCreateProductValidationError extends CommerceCommandError {
  readonly issues: readonly BulkCreateProductValidationIssue[]

  constructor(issues: readonly BulkCreateProductValidationIssue[]) {
    super('Product import validation failed.')
    this.name = 'BulkCreateProductValidationError'
    this.issues = issues
  }
}
