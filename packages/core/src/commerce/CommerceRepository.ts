import type {
  Product,
  StockIntegrityDiscrepancy,
  StockMovement,
} from '../inventory/index.js'
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
  findSaleById(saleId: string): Promise<Sale | undefined>
  findAllTransactions(): Promise<Transaction[]>
  getStockMovementHistory(
    query: StockMovementHistoryQuery,
  ): Promise<StockMovementHistory>
  getStockIntegrityDiscrepancies(): Promise<
    StockIntegrityDiscrepancy[]
  >
  getSalesHistory(query: SalesHistoryQuery): Promise<SalesHistory>
  getClientSalesHistory(
    clientId: string,
    query: ClientSalesHistoryQuery,
  ): Promise<ClientSalesHistory>
  getClientSalesMetrics(
    clientIds: string[],
  ): Promise<ClientSalesReadMetric[]>
  getNextSaleNumber(): Promise<string>
}

export interface SaleListItem {
  id: string
  saleNumber: string
  saleDate: Date
  clientId?: string
  clientName: string
  totalAmount: number
  paymentMethod: Sale['paymentMethod']
  status: Sale['status']
}

export interface SalesHistoryQuery {
  status?: Sale['status']
  clientId?: string
  throughCreatedAt: Date
  limit: number
  cursor?: { saleDate: Date; id: string }
}

export interface SalesHistory {
  summary: {
    totalCount: number
    draftCount: number
    completedCount: number
    totalAmount: number
  }
  sales: SaleListItem[]
}

export interface ClientSalesHistoryQuery {
  throughCreatedAt: Date
  limit: number
  cursor?: { saleDate: Date; id: string }
}

export interface ClientSalesHistory {
  summary: {
    completedCount: number
    completedTotalAmount: number
    lastSaleDate?: Date
  }
  sales: SaleListItem[]
}

export interface ClientSalesReadMetric {
  clientId: string
  completedCount: number
  completedTotalAmount: number
  lastSaleDate?: Date
}

export interface StockMovementHistoryQuery {
  productId?: string
  type?: StockMovement['type']
  fromCreatedAt?: Date
  toCreatedAtExclusive?: Date
  throughCreatedAt: Date
  limit: number
  cursor?: {
    createdAt: Date
    id: string
  }
}

export interface StockMovementHistory {
  summary: {
    totalMovements: number
    totalPurchases: number
    totalSales: number
  }
  movements: StockMovement[]
}

export interface CommerceUnitOfWork
  extends CommerceReadRepository {
  findProductsByIds(
    productIds: string[],
  ): Promise<Product[]>
  findPurchaseById(
    purchaseId: string,
  ): Promise<Purchase | undefined>
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
