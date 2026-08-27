import type { Product, StockMovement } from '../inventory/index.js'
import type { Purchase } from '../purchases/index.js'
import type { Sale } from '../sales/index.js'
import type { Transaction } from '../transactions/index.js'

export interface CommerceSnapshot {
  products: Product[]
  stockMovements: StockMovement[]
  purchases: Purchase[]
  sales: Sale[]
  transactions: Transaction[]
}

export interface CommerceSnapshotImportResult {
  imported: boolean
  idempotent: boolean
}

export class CommerceSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommerceSnapshotValidationError'
  }
}
