import type { BaseEntity } from '@madina/shared'

export type ProductCategory =
  | 'dry-fruits'
  | 'dates'
  | 'perfume'
  | 'carpets'

export type ProductUnit =
  | 'kg'
  | 'piece'
  | 'liter'
  | 'box'

export type ProductStatus =
  | 'active'
  | 'inactive'

export interface Product extends BaseEntity {
  name: string
  category: ProductCategory
  quantity: number
  unit: ProductUnit
  costPrice: number
  salePrice: number
  status: ProductStatus
}