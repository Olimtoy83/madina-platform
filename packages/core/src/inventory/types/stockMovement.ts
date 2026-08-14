import type { BaseEntity } from '@madina/shared'
import type { ProductUnit } from './product'

export type StockMovementType =
  | 'purchase'
  | 'sale'
  | 'adjustment'

export interface StockMovement extends BaseEntity {
  productId: string
  type: StockMovementType
  quantity: number
  unit: ProductUnit
  referenceId?: string
  note?: string
}
