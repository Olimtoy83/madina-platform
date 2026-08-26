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
import { CommerceService } from './CommerceService.js'

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
      saveProducts: async (products) => {
        this.products = products
      },
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
    })
  }
}

describe('CommerceService', () => {
  it('completes a purchase once and preserves its idempotent result', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)

    const first = await service.completePurchase('purchase-1')
    const second = await service.completePurchase('purchase-1')

    expect(first).toMatchObject({ success: true, idempotent: false })
    expect(second).toMatchObject({ success: true, idempotent: true })
    expect(repository.products[0]?.quantity).toBe(15)
    expect(repository.movements).toHaveLength(1)
    expect(repository.transactions).toHaveLength(1)
  })

  it('completes a sale once and preserves its idempotent result', async () => {
    const repository = new InMemoryCommerceRepository()
    const service = new CommerceService(repository)

    const first = await service.completeSale('sale-1')
    const second = await service.completeSale('sale-1')

    expect(first).toMatchObject({ success: true, idempotent: false })
    expect(second).toMatchObject({ success: true, idempotent: true })
    expect(repository.products[0]?.quantity).toBe(7)
    expect(repository.movements).toHaveLength(1)
    expect(repository.transactions).toHaveLength(1)
  })
})
