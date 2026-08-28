import type { Product, StockMovement } from '../inventory/index.js'
import type { Purchase } from '../purchases/index.js'
import type { Sale } from '../sales/index.js'
import type { Transaction } from '../transactions/index.js'
import type { CommerceSnapshot } from './CommerceSnapshot.js'
import type { AuditEvent } from '@madina/shared'

export interface CommerceReadRepository {
  findAllProducts(): Promise<Product[]>
  findAllStockMovements(): Promise<StockMovement[]>
  findAllPurchases(): Promise<Purchase[]>
  findAllSales(): Promise<Sale[]>
  findAllTransactions(): Promise<Transaction[]>
}

export interface CommerceUnitOfWork
  extends CommerceReadRepository {
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
  insertProduct(product: Product): Promise<void>
  insertPurchase(purchase: Purchase): Promise<void>
  insertSale(sale: Sale): Promise<void>
  updatePurchase(purchase: Purchase): Promise<void>
  updateSale(sale: Sale): Promise<void>
  saveStockMovements(
    movements: StockMovement[],
  ): Promise<void>
  saveTransaction(
    transaction: Transaction,
  ): Promise<void>
  insertSnapshot(snapshot: CommerceSnapshot): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
}

export interface CommerceRepository
  extends CommerceReadRepository {
  withTransaction<T>(
    operation: (
      unitOfWork: CommerceUnitOfWork,
    ) => Promise<T>,
  ): Promise<T>
}
