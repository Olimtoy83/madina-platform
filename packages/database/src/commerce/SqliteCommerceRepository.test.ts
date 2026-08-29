import {
  deepEqual,
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
  type StockMovement,
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

test('SqliteCommerceRepository returns bounded stock movement history with global totals', async () => {
  const { directory, repository } = createRepository()
  const throughCreatedAt = new Date('2026-08-30T00:00:00.000Z')
  const timestamp = (value: string) => new Date(value)
  const movement = (
    id: string,
    productId: string,
    type: StockMovement['type'],
    quantity: number,
    createdAt: string,
  ): StockMovement => ({
    id, productId, type, quantity, unit: 'kg',
    createdAt: timestamp(createdAt), updatedAt: timestamp(createdAt),
  })

  try {
    await repository.saveProduct(createProduct(6))
    await repository.saveProduct({
      ...createProduct(2), id: 'product-2', name: 'Курага', quantity: 2,
      status: 'inactive',
    })
    await repository.withTransaction(async (unitOfWork) => {
      await unitOfWork.saveStockMovements([
        movement('movement-1', 'product-1', 'purchase', 5, '2026-08-28T20:59:59.000Z'),
        movement('movement-2', 'product-1', 'sale', -2, '2026-08-28T21:00:00.000Z'),
        movement('movement-3', 'product-1', 'adjustment', 3, '2026-08-29T12:00:00.000Z'),
        movement('movement-4', 'product-2', 'purchase', 2, '2026-08-29T13:00:00.000Z'),
      ])
    })

    const first = await repository.getStockMovementHistory({
      throughCreatedAt,
      limit: 3,
    })
    deepEqual(first.summary, {
      totalMovements: 4,
      totalPurchases: 7,
      totalSales: 2,
    })
    deepEqual(first.movements.map((item) => item.id), [
      'movement-4', 'movement-3', 'movement-2',
    ])

    const second = await repository.getStockMovementHistory({
      throughCreatedAt,
      limit: 3,
      cursor: {
        createdAt: first.movements.at(-1)!.createdAt,
        id: first.movements.at(-1)!.id,
      },
    })
    deepEqual(second.movements.map((item) => item.id), ['movement-1'])

    const filtered = await repository.getStockMovementHistory({
      productId: 'product-1', type: 'purchase',
      fromCreatedAt: timestamp('2026-08-28T18:00:00.000Z'),
      toCreatedAtExclusive: timestamp('2026-08-28T21:00:00.000Z'),
      throughCreatedAt,
      limit: 3,
    })
    deepEqual(filtered.movements.map((item) => item.id), ['movement-1'])
    deepEqual(filtered.summary, first.summary)

    const frozen = await repository.getStockMovementHistory({
      throughCreatedAt: timestamp('2026-08-29T12:00:00.000Z'),
      limit: 10,
    })
    deepEqual(frozen.movements.map((item) => item.id), [
      'movement-3', 'movement-2', 'movement-1',
    ])
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SqliteCommerceRepository reconciles all products with the movement journal', async () => {
  const { directory, repository } = createRepository()
  const timestamp = new Date('2026-08-29T12:00:00.000Z')

  try {
    await repository.saveProduct(createProduct(5))
    await repository.saveProduct({
      ...createProduct(1), id: 'product-2', name: 'Курага', quantity: 1,
      status: 'inactive',
    })
    await repository.withTransaction(async (unitOfWork) => {
      await unitOfWork.saveStockMovements([{
        id: 'movement-1', createdAt: timestamp, updatedAt: timestamp,
        productId: 'product-1', type: 'purchase', quantity: 4, unit: 'kg',
      }, {
        id: 'movement-2', createdAt: timestamp, updatedAt: timestamp,
        productId: 'product-1', type: 'adjustment', quantity: 1, unit: 'kg',
      }, {
        id: 'movement-3', createdAt: timestamp, updatedAt: timestamp,
        productId: 'product-2', type: 'sale', quantity: -1, unit: 'kg',
      }])
    })

    deepEqual(await repository.getStockIntegrityDiscrepancies(), [{
      productId: 'product-2', productName: 'Курага', actualQuantity: 1,
      calculatedQuantity: -1, difference: 2,
    }])
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SqliteCommerceRepository returns bounded purchases by business date and preserves a frozen traversal', async () => {
  const { directory, repository } = createRepository()
  const timestamp = (value: string) => new Date(value)
  const purchase = (
    id: string,
    purchaseNumber: string,
    purchaseDate: string,
    createdAt: string,
  ): Purchase => ({
    ...createPurchase(),
    id,
    purchaseNumber,
    purchaseDate: timestamp(purchaseDate),
    createdAt: timestamp(createdAt),
    updatedAt: timestamp(createdAt),
    supplierName: `Supplier ${id}`,
  })

  try {
    await repository.saveProduct(createProduct())
    await repository.savePurchase(purchase('purchase-a', 'PUR-0002', '2026-08-28T00:00:00.000Z', '2026-08-28T12:00:00.000Z'))
    await repository.savePurchase(purchase('purchase-b', 'PUR-0010', '2026-08-29T00:00:00.000Z', '2026-08-28T13:00:00.000Z'))
    await repository.savePurchase(purchase('purchase-c', 'PUR-0007', '2026-08-29T00:00:00.000Z', '2026-08-28T14:00:00.000Z'))

    const throughCreatedAt = timestamp('2026-08-29T00:00:00.000Z')
    const first = await repository.getPurchasesHistory({ throughCreatedAt, limit: 2 })
    deepEqual(first.purchases.map((item) => item.id), ['purchase-c', 'purchase-b'])
    strictEqual(first.purchases[0]?.itemCount, 1)

    await repository.savePurchase(purchase('purchase-later', 'PUR-0099', '2030-01-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z'))
    const second = await repository.getPurchasesHistory({
      throughCreatedAt,
      limit: 2,
      cursor: {
        purchaseDate: first.purchases.at(-1)!.purchaseDate,
        id: first.purchases.at(-1)!.id,
      },
    })
    deepEqual(second.purchases.map((item) => item.id), ['purchase-a'])
    strictEqual((await repository.findPurchaseById('purchase-b'))?.items.length, 1)
    strictEqual(await repository.getNextPurchaseNumber(), 'PUR-0100')
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
