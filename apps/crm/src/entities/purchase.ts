import type { BaseEntity } from '@madina/shared'
import type { ProductUnit } from './product'

export type PurchaseStatus =
  | 'draft'
  | 'completed'
  | 'cancelled'

export type PurchasePaymentMethod =
  | 'cash'
  | 'card'
  | 'bank-transfer'
  | 'other'

export interface PurchaseItem {
  productId: string
  quantity: number
  unit: ProductUnit
  unitCost: number
  totalCost: number
}

export interface Purchase extends BaseEntity {
  purchaseNumber: string
  purchaseDate: Date
  supplierName: string
  items: PurchaseItem[]
  totalAmount: number
  paymentMethod: PurchasePaymentMethod
  status: PurchaseStatus
  note?: string
}
