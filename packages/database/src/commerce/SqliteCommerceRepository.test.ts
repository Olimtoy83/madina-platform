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
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  CommerceService,
  type Product,
  type Purchase,
  type Sale,
} from '@madina/core'
import type { CommandContext } from '@madina/shared'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuditRepository } from '../audit/SqliteAuditRepository.js'
import { SqliteCommerceRepository } from './SqliteCommerceRepository.js'

const context: CommandContext = { actorType: 'user', actorUserId: 'user-1', requestId: 'request-1' }

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

      strictEqual((await service.completePurchase('purchase-1', context)).idempotent, false)
      strictEqual((await service.completePurchase('purchase-1', context)).idempotent, true)
      strictEqual((await service.completeSale('sale-1', context)).idempotent, false)
      strictEqual((await service.completeSale('sale-1', context)).idempotent, true)

      strictEqual(await readProductQuantity(repository), 12)
      strictEqual(await readMovementCount(repository, 'purchase-1'), 1)
      strictEqual(await readMovementCount(repository, 'sale-1'), 1)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
})

test('audit insert failure rolls back a completed sale and its derived records', async () => {
  const { directory, repository } = createRepository()
  const service = new CommerceService(repository)
  const databaseFile = join(directory, 'commerce.sqlite')
  try {
    await repository.saveProduct(createProduct())
    await repository.saveSale(createSale())
    const database = new DatabaseSync(databaseFile)
    database.exec(`CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit failure'); END;`)
    database.close()
    await rejects(service.completeSale('sale-1', context), /audit failure/)
    strictEqual(await readProductQuantity(repository), 10)
    strictEqual(await readMovementCount(repository, 'sale-1'), 0)
    strictEqual((await repository.findAllTransactions()).length, 0)
    strictEqual((await repository.findAllSales())[0]?.status, 'draft')
    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      strictEqual((await auditRepository.findAll()).length, 0)
    } finally {
      auditRepository.close()
    }
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('audit insert failure rolls back every product and movement in a bulk import', async () => {
  const { directory, repository } = createRepository()
  const service = new CommerceService(repository)
  const databaseFile = join(directory, 'commerce.sqlite')

  try {
    const database = new DatabaseSync(databaseFile)
    database.exec(`CREATE TRIGGER fail_bulk_audit_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'bulk audit failure'); END;`)
    database.close()

    await rejects(service.importProducts({
      templateVersion: 'v1',
      rows: [
        {
          sourceRow: 4, name: 'Dates', category: 'dates', unit: 'kg',
          costPrice: 10, salePrice: 15, status: 'active', initialQuantity: 0,
        },
        {
          sourceRow: 5, name: 'Perfume', category: 'perfume', unit: 'piece',
          costPrice: 20, salePrice: 30, status: 'active', initialQuantity: 3,
        },
      ],
    }, context), /bulk audit failure/)

    strictEqual((await repository.findAllProducts()).length, 0)
    strictEqual((await repository.findAllStockMovements()).length, 0)

    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      strictEqual((await auditRepository.findAll()).length, 0)
    } finally {
      auditRepository.close()
    }
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
