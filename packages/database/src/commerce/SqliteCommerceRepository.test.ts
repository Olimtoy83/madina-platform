import {
  rejects,
  strictEqual,
} from 'node:assert'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CommerceService,
  type Product,
  type Purchase,
  type Sale,
} from '@madina/core'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteCommerceRepository } from './SqliteCommerceRepository.js'

function createProduct(quantity = 10): Product {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'product-1', createdAt: now, updatedAt: now,
    name: 'Финики', category: 'dates', quantity, unit: 'kg',
    costPrice: 10, salePrice: 15, status: 'active',
  }
}

function createPurchase(): Purchase {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'purchase-1', createdAt: now, updatedAt: now,
    purchaseNumber: 'PUR-0001', purchaseDate: now,
    supplierName: 'Поставщик', totalAmount: 50,
    paymentMethod: 'cash', status: 'draft',
    items: [{
      productId: 'product-1', quantity: 5, unit: 'kg',
      unitCost: 10, totalCost: 50,
    }],
  }
}

function createSale(): Sale {
  const now = new Date('2026-08-27T00:00:00.000Z')

  return {
    id: 'sale-1', createdAt: now, updatedAt: now,
    saleNumber: 'SAL-0001', saleDate: now, clientName: 'Клиент',
    totalAmount: 45, paymentMethod: 'cash', status: 'draft',
    items: [{
      productId: 'product-1', quantity: 3, unit: 'kg',
      unitPrice: 15, totalAmount: 45,
    }],
  }
}

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'madina-commerce-'))
  const databaseFile = join(directory, 'commerce.sqlite')
  initializeDatabase(databaseFile)
  const repository = new SqliteCommerceRepository(databaseFile)

  return { directory, repository }
}

async function readProductQuantity(
  repository: SqliteCommerceRepository,
): Promise<number | undefined> {
  return repository.withTransaction(async (unitOfWork) =>
    (await unitOfWork.findProductsByIds(['product-1']))[0]?.quantity,
  )
}

async function readMovementCount(
  repository: SqliteCommerceRepository,
  referenceId: string,
): Promise<number> {
  return repository.withTransaction(async (unitOfWork) =>
    (await unitOfWork.findStockMovementsByReference(referenceId)).length,
  )
}

test('SqliteCommerceRepository rolls back every failed atomic operation', async () => {
    const { directory, repository } = createRepository()

    try {
      await repository.saveProduct(createProduct())

      await rejects(repository.withTransaction(async (unitOfWork) => {
        const [product] = await unitOfWork.findProductsByIds(['product-1'])
        await unitOfWork.saveProducts([{
          ...product!, quantity: 1, updatedAt: new Date(),
        }])
        throw new Error('forced failure')
      }), /forced failure/)

      strictEqual(await readProductQuantity(repository), 10)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
})

test('SqliteCommerceRepository completes each document once', async () => {
    const { directory, repository } = createRepository()
    const service = new CommerceService(repository)

    try {
      await repository.saveProduct(createProduct())
      await repository.savePurchase(createPurchase())
      await repository.saveSale(createSale())

      strictEqual((await service.completePurchase('purchase-1')).idempotent, false)
      strictEqual((await service.completePurchase('purchase-1')).idempotent, true)
      strictEqual((await service.completeSale('sale-1')).idempotent, false)
      strictEqual((await service.completeSale('sale-1')).idempotent, true)

      strictEqual(await readProductQuantity(repository), 12)
      strictEqual(await readMovementCount(repository, 'purchase-1'), 1)
      strictEqual(await readMovementCount(repository, 'sale-1'), 1)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
})
