import { describe, expect, it } from 'vitest'
import type {
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '../index.js'
import type {
  CommerceRepository,
  CommerceUnitOfWork,
} from './CommerceRepository.js'
import type { CommerceSnapshot } from './CommerceSnapshot.js'
import { CommerceService } from './CommerceService.js'
import type { AuditEvent, CommandContext } from '@madina/shared'

const context: CommandContext = {
  actorType: 'user', actorUserId: 'user-1', requestId: 'request-1',
}

function createProduct(quantity = 10): Product {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'product-1',
    createdAt: now,
    updatedAt: now,
    name: 'Финики',
    category: 'dates',
    quantity,
    unit: 'kg',
    costPrice: 10,
    salePrice: 15,
    status: 'active',
  }
}

function createPurchase(): Purchase {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'purchase-1',
    createdAt: now,
    updatedAt: now,
    purchaseNumber: 'PUR-0001',
    purchaseDate: now,
    supplierName: 'Поставщик',
    items: [{
      productId: 'product-1',
      quantity: 5,
      unit: 'kg',
      unitCost: 10,
      totalCost: 50,
    }],
    totalAmount: 50,
    paymentMethod: 'cash',
    status: 'draft',
  }
}

function createSale(): Sale {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'sale-1',
    createdAt: now,
    updatedAt: now,
    saleNumber: 'SAL-0001',
    saleDate: now,
    clientName: 'Клиент',
    items: [{
      productId: 'product-1',
      quantity: 3,
      unit: 'kg',
      unitPrice: 15,
      totalAmount: 45,
    }],
    totalAmount: 45,
    paymentMethod: 'cash',
    status: 'draft',
  }
}

class InMemoryCommerceRepository implements CommerceRepository {
  products = [createProduct()]
  purchases = [createPurchase()]
  sales = [createSale()]
  movements: StockMovement[] = []
  transactions: Transaction[] = []
  auditEvents: AuditEvent[] = []

  async findAllProducts(): Promise<Product[]> {
    return this.products
  }

  async findAllStockMovements(): Promise<StockMovement[]> {
    return this.movements
  }

  async findAllPurchases(): Promise<Purchase[]> {
    return this.purchases
  }

  async findAllSales(): Promise<Sale[]> {
    return this.sales
  }

  async findAllTransactions(): Promise<Transaction[]> {
    return this.transactions
  }

  async withTransaction<T>(
    operation: (unitOfWork: CommerceUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return operation({
      findProductsByIds: async (ids) => this.products.filter(
        (product) => ids.includes(product.id),
      ),
      findPurchaseById: async (id) => this.purchases.find(
        (purchase) => purchase.id === id,
      ),
      findSaleById: async (id) => this.sales.find(
        (sale) => sale.id === id,
      ),
      findTransactionByReference: async (category, referenceId) =>
        this.transactions.find((transaction) =>
          transaction.category === category &&
          transaction.referenceId === referenceId,
        ),
      findStockMovementsByReference: async (referenceId) =>
        this.movements.filter((movement) =>
          movement.referenceId === referenceId,
        ),
      findAllProducts: () => this.findAllProducts(),
      findAllStockMovements: () => this.findAllStockMovements(),
      findAllPurchases: () => this.findAllPurchases(),
      findAllSales: () => this.findAllSales(),
      findAllTransactions: () => this.findAllTransactions(),
      saveProducts: async (products) => {
        this.products = this.products.map((current) =>
          products.find((product) => product.id === current.id) ?? current,
        )
      },
      insertProduct: async (product) => { this.products.push(product) },
      insertPurchase: async (purchase) => { this.purchases.push(purchase) },
      insertSale: async (sale) => { this.sales.push(sale) },
      updatePurchase: async (purchase) => {
        this.purchases = this.purchases.map((current) =>
          current.id === purchase.id ? purchase : current,
        )
      },
      updateSale: async (sale) => {
        this.sales = this.sales.map((current) =>
          current.id === sale.id ? sale : current,
        )
      },
      saveStockMovements: async (movements) => {
        this.movements.push(...movements)
      },
      saveTransaction: async (transaction) => {
        this.transactions.push(transaction)
      },
      appendAuditEvent: async (event) => {
        this.auditEvents.push(event)
      },
      insertSnapshot: async (snapshot: CommerceSnapshot) => {
        this.products = snapshot.products
        this.movements = snapshot.stockMovements
        this.purchases = snapshot.purchases
        this.sales = snapshot.sales
        this.transactions = snapshot.transactions
      },
    })
  }
}

describe('CommerceService', () => {
  it('completes a purchase once and preserves its idempotent result', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)

    const first = await service.completePurchase('purchase-1', context)
    const second = await service.completePurchase('purchase-1', context)

    expect(first).toMatchObject({ success: true, idempotent: false })
    expect(second).toMatchObject({ success: true, idempotent: true })
    expect(repository.products[0]?.quantity).toBe(15)
    expect(repository.movements).toHaveLength(1)
    expect(repository.transactions).toHaveLength(1)
    expect(repository.auditEvents).toHaveLength(1)
  })

  it('completes a sale once and preserves its idempotent result', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)

    const first = await service.completeSale('sale-1', context)
    const second = await service.completeSale('sale-1', context)

    expect(first).toMatchObject({ success: true, idempotent: false })
    expect(second).toMatchObject({ success: true, idempotent: true })
    expect(repository.products[0]?.quantity).toBe(7)
    expect(repository.movements).toHaveLength(1)
    expect(repository.transactions).toHaveLength(1)
    expect(repository.auditEvents).toHaveLength(1)
  })

  it('records one contract event for each commerce mutation action', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)
    const product = await service.createProduct({
      name: 'Новый товар', category: 'dates', initialQuantity: 0, unit: 'kg',
      costPrice: 1, salePrice: 2, status: 'active',
    }, context)
    await service.updateProduct(product.id, { name: 'Обновлённый товар' }, context)
    await service.adjustProductStock(product.id, { quantity: 2, note: 'Инвентаризация' }, context)
    await service.deactivateProduct(product.id, context)
    await service.updatePurchase('purchase-1', { note: 'Обновлено' }, context)
    await service.cancelPurchase('purchase-1', context)
    await service.updateSale('sale-1', { note: 'Обновлено' }, context)
    await service.cancelSale('sale-1', context)
    expect(repository.auditEvents.map((event) => event.action)).toEqual([
      'product.created', 'product.updated', 'stock.adjusted', 'product.deactivated',
      'purchase.updated', 'purchase.cancelled', 'sale.updated', 'sale.cancelled',
    ])
    for (const event of repository.auditEvents) {
      expect(event).toMatchObject({ domain: 'commerce', actorType: 'user', actorUserId: 'user-1', requestId: 'request-1' })
      expect(event.entityId).toBeTruthy()
    }
  })

  it('records audit contracts for created purchase and sale', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)
    const purchase = await service.createPurchase({
      purchaseNumber: 'PUR-0002', purchaseDate: new Date(), supplierName: 'Поставщик',
      items: createPurchase().items, paymentMethod: 'cash', note: undefined,
    }, context)
    const sale = await service.createSale({
      saleNumber: 'SAL-0002', saleDate: new Date(), clientName: 'Клиент',
      items: createSale().items, paymentMethod: 'cash', note: undefined,
    }, context)
    expect(repository.auditEvents).toHaveLength(2)
    expect(repository.auditEvents[0]).toMatchObject({
      domain: 'commerce', action: 'purchase.created', entityId: purchase.id,
      actorType: 'user', actorUserId: 'user-1', requestId: 'request-1',
    })
    expect(repository.auditEvents[1]).toMatchObject({
      domain: 'commerce', action: 'sale.created', entityId: sale.id,
      actorType: 'user', actorUserId: 'user-1', requestId: 'request-1',
    })
  })
})
