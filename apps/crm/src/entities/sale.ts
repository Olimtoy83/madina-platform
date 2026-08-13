import type { BaseEntity } from '@madina/shared'
import type { ProductUnit } from './product'

export type SaleStatus =
  | 'draft'
  | 'completed'
  | 'cancelled'

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'bank-transfer'
  | 'other'

export interface SaleItem {
  productId: string
  quantity: number
  unit: ProductUnit
  unitPrice: number
  totalAmount: number
}

export interface Sale extends BaseEntity {
  saleNumber: string
  saleDate: Date
  clientId?: string
  clientName: string
  items: SaleItem[]
  totalAmount: number
  paymentMethod: PaymentMethod
  status: SaleStatus
  note?: string
}
