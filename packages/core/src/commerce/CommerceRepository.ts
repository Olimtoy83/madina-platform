import type { Product, StockMovement } from '../inventory/index.js'
import type { Purchase } from '../purchases/index.js'
import type { Sale } from '../sales/index.js'
import type { Transaction } from '../transactions/index.js'

export interface CommerceUnitOfWork {
  findProductsByIds(
    productIds: string[],
  ): Promise<Product[]>
  findPurchaseById(
    purchaseId: string,
  ): Promise<Purchase | undefined>
  findSaleById(
    saleId: string,
  ): Promise<Sale | undefined>
  findTransactionByReference(
    category: Transaction['category'],
    referenceId: string,
  ): Promise<Transaction | undefined>
  findStockMovementsByReference(
    referenceId: string,
  ): Promise<StockMovement[]>
  saveProducts(products: Product[]): Promise<void>
  updatePurchase(purchase: Purchase): Promise<void>
  updateSale(sale: Sale): Promise<void>
  saveStockMovements(
    movements: StockMovement[],
  ): Promise<void>
  saveTransaction(
    transaction: Transaction,
  ): Promise<void>
}

export interface CommerceRepository {
  withTransaction<T>(
    operation: (
      unitOfWork: CommerceUnitOfWork,
    ) => Promise<T>,
  ): Promise<T>
}
