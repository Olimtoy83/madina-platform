import type { BaseEntity } from '@madina/shared'

export type TransactionType =
  | 'income'
  | 'expense'

export type TransactionCategory =
  | 'sale'
  | 'purchase'
  | 'other'

export type TransactionStatus =
  | 'pending'
  | 'completed'
  | 'cancelled'

export type TransactionPaymentMethod =
  | 'cash'
  | 'card'
  | 'bank-transfer'
  | 'other'

export interface Transaction extends BaseEntity {
  type: TransactionType
  category: TransactionCategory
  amount: number
  paymentMethod: TransactionPaymentMethod
  transactionDate: Date
  referenceId?: string
  description?: string
  status: TransactionStatus
}
