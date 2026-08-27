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
