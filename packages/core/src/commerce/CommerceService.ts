import {
  completePurchase as completePurchaseCore,
  cancelPurchase,
  normalizePurchase,
  updatePurchase as updatePurchaseCore,
  type Purchase,
} from '../purchases/index.js'
import {
  completeSale as completeSaleCore,
  cancelSale,
  normalizeSale,
  updateSale as updateSaleCore,
  type Sale,
} from '../sales/index.js'
import type { Transaction } from '../transactions/index.js'
import {
  adjustStock,
  deactivateProduct,
  getStockIntegrityDiscrepancies,
  updateProduct as updateProductCore,
  type Product,
  type StockMovement,
} from '../inventory/index.js'
import type {
  CommerceRepository,
  CommerceUnitOfWork,
} from './CommerceRepository.js'
import {
  CommerceSnapshotValidationError,
  type CommerceSnapshot,
  type CommerceSnapshotImportResult,
} from './CommerceSnapshot.js'
import {
  CommerceCommandError,
  type AdjustProductStockCommand,
  type CreateProductCommand,
  type CreatePurchaseCommand,
  type CreateSaleCommand,
  type UpdateProductCommand,
  type UpdatePurchaseCommand,
  type UpdateSaleCommand,
} from './CommerceCommands.js'
import type { AuditEvent, CommandContext } from '@madina/shared'

export interface CommerceCompletionResult {
  success: boolean
  idempotent: boolean
  message?: string
  purchase?: Purchase
  sale?: Sale
  transaction?: Transaction
}

function failed(message: string): CommerceCompletionResult {
  return {
    success: false,
    idempotent: false,
    message,
  }
}

async function hasCompletedReference(
  unitOfWork: CommerceUnitOfWork,
  category: Transaction['category'],
  referenceId: string,
): Promise<boolean> {
  const transaction =
    await unitOfWork.findTransactionByReference(
      category,
      referenceId,
    )

  return transaction?.status === 'completed'
}

export class CommerceService {
  private readonly repository: CommerceRepository

  constructor(
    repository: CommerceRepository,
  ) {
    this.repository = repository
  }

  async createProduct(
    command: CreateProductCommand,
    context: CommandContext,
  ): Promise<Product> {
    return this.repository.withTransaction(async (unitOfWork) => {
      if (!Number.isFinite(command.initialQuantity) || command.initialQuantity < 0) {
        throw new CommerceCommandError(
          'Initial product quantity must be a non-negative finite number.',
        )
      }

      const now = new Date()
      const product: Product = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        name: command.name,
        category: command.category,
        quantity: 0,
        unit: command.unit,
        costPrice: command.costPrice,
        salePrice: command.salePrice,
        status: command.status,
      }

      await unitOfWork.insertProduct(product)

      if (command.initialQuantity === 0) {
        await appendCommerceAudit(unitOfWork, context, 'product.created', 'product', product.id)
        return product
      }

      const result = adjustStock(
        [product],
        product.id,
        command.initialQuantity,
        undefined,
        'Начальный остаток',
      )

      if (!result.success || !result.product || !result.movement) {
        throw new CommerceCommandError(
          result.message ?? 'Unable to set initial product quantity.',
        )
      }

      await unitOfWork.saveProducts(result.products)
      await unitOfWork.saveStockMovements([result.movement])
      await appendCommerceAudit(unitOfWork, context, 'product.created', 'product', result.product.id, {
        initialQuantity: command.initialQuantity,
        movementId: result.movement.id,
      })
      return result.product
    })
  }

  async updateProduct(
    productId: string,
    command: UpdateProductCommand,
    context: CommandContext,
  ): Promise<Product> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const product = await findProduct(unitOfWork, productId)
      const [sales, purchases] = await Promise.all([
        unitOfWork.findAllSales(),
        unitOfWork.findAllPurchases(),
      ])
      const updatedProduct = updateProductCore(
        product,
        pickProductUpdates(command),
        sales,
        purchases,
      )

      await unitOfWork.saveProducts([updatedProduct])
      await appendCommerceAudit(unitOfWork, context, 'product.updated', 'product', updatedProduct.id)
      return updatedProduct
    })
  }

  async deactivateProduct(productId: string, context: CommandContext): Promise<Product> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const product = await findProduct(unitOfWork, productId)
      const deactivatedProduct = deactivateProduct(product)

      await unitOfWork.saveProducts([deactivatedProduct])
      await appendCommerceAudit(unitOfWork, context, 'product.deactivated', 'product', deactivatedProduct.id)
      return deactivatedProduct
    })
  }

  async adjustProductStock(
    productId: string,
    command: AdjustProductStockCommand,
    context: CommandContext,
  ): Promise<{ product: Product; movement: StockMovement }> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const product = await findProduct(unitOfWork, productId)
      const result = adjustStock(
        [product],
        productId,
        command.quantity,
        undefined,
        command.note,
      )

      if (!result.success || !result.product || !result.movement) {
        throw new CommerceCommandError(
          result.message ?? 'Unable to adjust product stock.',
        )
      }

      await unitOfWork.saveProducts(result.products)
      await unitOfWork.saveStockMovements([result.movement])
      await appendCommerceAudit(unitOfWork, context, 'stock.adjusted', 'product', result.product.id, {
        productId: result.product.id, delta: command.quantity,
        quantity: result.product.quantity, movementId: result.movement.id,
      })

      return {
        product: result.product,
        movement: result.movement,
      }
    })
  }

  async createPurchase(
    command: CreatePurchaseCommand,
    context: CommandContext,
  ): Promise<Purchase> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const now = new Date()
      const purchase = normalizePurchase({
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        purchaseNumber: command.purchaseNumber,
        purchaseDate: command.purchaseDate,
        supplierName: command.supplierName,
        items: command.items,
        totalAmount: 0,
        paymentMethod: command.paymentMethod,
        status: 'draft',
        note: command.note,
      })

      await validateDocumentProducts(unitOfWork, purchase.items)
      await unitOfWork.insertPurchase(purchase)
      await appendCommerceAudit(unitOfWork, context, 'purchase.created', 'purchase', purchase.id)
      return purchase
    })
  }

  async updatePurchase(
    purchaseId: string,
    command: UpdatePurchaseCommand,
    context: CommandContext,
  ): Promise<Purchase> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const purchase = await unitOfWork.findPurchaseById(purchaseId)

      if (!purchase) {
        throw new CommerceCommandError('Purchase not found.')
      }

      const updatedPurchase = updatePurchaseCore(purchase, command)
      await validateDocumentProducts(unitOfWork, updatedPurchase.items)
      await unitOfWork.updatePurchase(updatedPurchase)
      await appendCommerceAudit(unitOfWork, context, 'purchase.updated', 'purchase', updatedPurchase.id)
      return updatedPurchase
    })
  }

  async cancelPurchase(purchaseId: string, context: CommandContext): Promise<Purchase> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const purchase = await unitOfWork.findPurchaseById(purchaseId)

      if (!purchase) {
        throw new CommerceCommandError('Purchase not found.')
      }

      const cancelledPurchase = cancelPurchase(purchase)
      await unitOfWork.updatePurchase(cancelledPurchase)
      await appendCommerceAudit(unitOfWork, context, 'purchase.cancelled', 'purchase', cancelledPurchase.id)
      return cancelledPurchase
    })
  }

  async createSale(command: CreateSaleCommand, context: CommandContext): Promise<Sale> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const now = new Date()
      const sale = normalizeSale({
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        saleNumber: command.saleNumber,
        saleDate: command.saleDate,
        clientId: command.clientId,
        clientName: command.clientName,
        items: command.items,
        totalAmount: 0,
        paymentMethod: command.paymentMethod,
        status: 'draft',
        note: command.note,
      })

      await validateDocumentProducts(unitOfWork, sale.items)
      await unitOfWork.insertSale(sale)
      await appendCommerceAudit(unitOfWork, context, 'sale.created', 'sale', sale.id)
      return sale
    })
  }

  async updateSale(
    saleId: string,
    command: UpdateSaleCommand,
    context: CommandContext,
  ): Promise<Sale> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const sale = await unitOfWork.findSaleById(saleId)

      if (!sale) {
        throw new CommerceCommandError('Sale not found.')
      }

      const updatedSale = updateSaleCore(sale, command)
      await validateDocumentProducts(unitOfWork, updatedSale.items)
      await unitOfWork.updateSale(updatedSale)
      await appendCommerceAudit(unitOfWork, context, 'sale.updated', 'sale', updatedSale.id)
      return updatedSale
    })
  }

  async cancelSale(saleId: string, context: CommandContext): Promise<Sale> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const sale = await unitOfWork.findSaleById(saleId)

      if (!sale) {
        throw new CommerceCommandError('Sale not found.')
      }

      const cancelledSale = cancelSale(sale)
      await unitOfWork.updateSale(cancelledSale)
      await appendCommerceAudit(unitOfWork, context, 'sale.cancelled', 'sale', cancelledSale.id)
      return cancelledSale
    })
  }

  async completePurchase(
    purchaseId: string,
    context: CommandContext,
  ): Promise<CommerceCompletionResult> {
    return this.repository.withTransaction(
      async (unitOfWork) => {
        const purchase =
          await unitOfWork.findPurchaseById(purchaseId)

        if (!purchase) {
          return failed('Поступление не найдено.')
        }

        if (purchase.status === 'completed') {
          return {
            success: true,
            idempotent: true,
            purchase,
          }
        }

        if (await hasCompletedReference(
          unitOfWork,
          'purchase',
          purchase.id,
        )) {
          return failed(
            'Найдена завершённая транзакция для незавершённого поступления.',
          )
        }

        const products =
          await unitOfWork.findProductsByIds(
            purchase.items.map((item) => item.productId),
          )

        const result = completePurchaseCore(
          purchase,
          products,
        )

        if (
          !result.success ||
          !result.purchase ||
          !result.transaction
        ) {
          return failed(
            result.message ??
              'Не удалось завершить поступление.',
          )
        }

        await unitOfWork.saveProducts(result.products)
        await unitOfWork.updatePurchase(result.purchase)
        await unitOfWork.saveStockMovements(result.movements)
        await unitOfWork.saveTransaction(result.transaction)
        await appendCommerceAudit(unitOfWork, context, 'purchase.completed', 'purchase', result.purchase.id, {
          documentNumber: result.purchase.purchaseNumber,
          totalAmount: result.purchase.totalAmount,
          transactionId: result.transaction.id,
          movementCount: result.movements.length,
        })

        return {
          success: true,
          idempotent: false,
          purchase: result.purchase,
          transaction: result.transaction,
        }
      },
    )
  }

  async completeSale(
    saleId: string,
    context: CommandContext,
  ): Promise<CommerceCompletionResult> {
    return this.repository.withTransaction(
      async (unitOfWork) => {
        const sale = await unitOfWork.findSaleById(saleId)

        if (!sale) {
          return failed('Продажа не найдена.')
        }

        if (sale.status === 'completed') {
          return {
            success: true,
            idempotent: true,
            sale,
          }
        }

        if (await hasCompletedReference(
          unitOfWork,
          'sale',
          sale.id,
        )) {
          return failed(
            'Найдена завершённая транзакция для незавершённой продажи.',
          )
        }

        const products =
          await unitOfWork.findProductsByIds(
            sale.items.map((item) => item.productId),
          )

        const result = completeSaleCore(sale, products)

        if (
          !result.success ||
          !result.sale ||
          !result.transaction
        ) {
          return failed(
            result.message ??
              'Не удалось завершить продажу.',
          )
        }

        await unitOfWork.saveProducts(result.products)
        await unitOfWork.updateSale(result.sale)
        await unitOfWork.saveStockMovements(result.movements)
        await unitOfWork.saveTransaction(result.transaction)
        await appendCommerceAudit(unitOfWork, context, 'sale.completed', 'sale', result.sale.id, {
          documentNumber: result.sale.saleNumber,
          totalAmount: result.sale.totalAmount,
          transactionId: result.transaction.id,
          movementCount: result.movements.length,
        })

        return {
          success: true,
          idempotent: false,
          sale: result.sale,
          transaction: result.transaction,
        }
      },
    )
  }

  async importSnapshot(
    snapshot: CommerceSnapshot,
    context: CommandContext,
  ): Promise<CommerceSnapshotImportResult> {
    return this.repository.withTransaction(
      async (unitOfWork) => {
        validateSnapshot(snapshot)

        const existing = await readSnapshot(unitOfWork)

        if (!isEmptySnapshot(existing)) {
          if (snapshotSignature(existing) === snapshotSignature(snapshot)) {
            return {
              imported: false,
              idempotent: true,
            }
          }

          throw new CommerceSnapshotValidationError(
            'Commerce snapshot conflicts with existing server data.',
          )
        }

        await unitOfWork.insertSnapshot(snapshot)
        await appendCommerceAudit(unitOfWork, context, 'commerce.snapshot_imported', 'commerce_snapshot', 'legacy-snapshot', {
          products: snapshot.products.length,
          stockMovements: snapshot.stockMovements.length,
          purchases: snapshot.purchases.length,
          sales: snapshot.sales.length,
          transactions: snapshot.transactions.length,
        })

        return {
          imported: true,
          idempotent: false,
        }
      },
    )
  }
}

async function appendCommerceAudit(
  unitOfWork: CommerceUnitOfWork,
  context: CommandContext,
  action: AuditEvent['action'],
  entityType: string,
  entityId: string,
  metadata?: AuditEvent['metadata'],
): Promise<void> {
  await unitOfWork.appendAuditEvent({
    id: crypto.randomUUID(), occurredAt: new Date(),
    actorType: context.actorType, actorUserId: context.actorUserId,
    requestId: context.requestId, domain: 'commerce', action, entityType, entityId, metadata,
  })
}

function pickProductUpdates(
  command: UpdateProductCommand,
): UpdateProductCommand {
  const updates: UpdateProductCommand = {}

  if (command.name !== undefined) updates.name = command.name
  if (command.category !== undefined) updates.category = command.category
  if (command.unit !== undefined) updates.unit = command.unit
  if (command.costPrice !== undefined) updates.costPrice = command.costPrice
  if (command.salePrice !== undefined) updates.salePrice = command.salePrice
  if (command.status !== undefined) updates.status = command.status

  return updates
}

async function findProduct(
  unitOfWork: CommerceUnitOfWork,
  productId: string,
): Promise<Product> {
  const [product] = await unitOfWork.findProductsByIds([productId])

  if (!product) {
    throw new CommerceCommandError('Product not found.')
  }

  return product
}

async function validateDocumentProducts(
  unitOfWork: CommerceUnitOfWork,
  items: Array<{ productId: string; unit: Product['unit'] }>,
): Promise<void> {
  const products = await unitOfWork.findProductsByIds(
    items.map((item) => item.productId),
  )
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  )

  for (const item of items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new CommerceCommandError(
        `Product not found: ${item.productId}.`,
      )
    }

    if (product.unit !== item.unit) {
      throw new CommerceCommandError(
        `Product unit does not match document item: ${item.productId}.`,
      )
    }
  }
}

async function readSnapshot(
  unitOfWork: CommerceUnitOfWork,
): Promise<CommerceSnapshot> {
  const [
    products,
    stockMovements,
    purchases,
    sales,
    transactions,
  ] = await Promise.all([
    unitOfWork.findAllProducts(),
    unitOfWork.findAllStockMovements(),
    unitOfWork.findAllPurchases(),
    unitOfWork.findAllSales(),
    unitOfWork.findAllTransactions(),
  ])

  return {
    products,
    stockMovements,
    purchases,
    sales,
    transactions,
  }
}

function isEmptySnapshot(snapshot: CommerceSnapshot): boolean {
  return snapshot.products.length === 0 &&
    snapshot.stockMovements.length === 0 &&
    snapshot.purchases.length === 0 &&
    snapshot.sales.length === 0 &&
    snapshot.transactions.length === 0
}

function validateSnapshot(snapshot: CommerceSnapshot): void {
  validateUnique(snapshot.products, 'product')
  validateUnique(snapshot.stockMovements, 'stock movement')
  validateUnique(snapshot.purchases, 'purchase')
  validateUnique(snapshot.sales, 'sale')
  validateUnique(snapshot.transactions, 'transaction')
  validateUniqueValues(
    snapshot.purchases.map((purchase) => purchase.purchaseNumber),
    'purchase number',
  )
  validateUniqueValues(
    snapshot.sales.map((sale) => sale.saleNumber),
    'sale number',
  )

  const products = new Map(
    snapshot.products.map((product) => [product.id, product]),
  )
  const purchases = new Map(
    snapshot.purchases.map((purchase) => [purchase.id, purchase]),
  )
  const sales = new Map(
    snapshot.sales.map((sale) => [sale.id, sale]),
  )

  for (const product of snapshot.products) {
    if (!Number.isFinite(product.quantity)) {
      throw new CommerceSnapshotValidationError(
        `Product quantity is invalid: ${product.id}.`,
      )
    }
  }

  for (const purchase of snapshot.purchases) {
    validateDocumentItems(
      purchase.id,
      purchase.items,
      products,
      'Purchase',
    )
  }

  for (const sale of snapshot.sales) {
    validateDocumentItems(
      sale.id,
      sale.items,
      products,
      'Sale',
    )
  }

  const movementKeys = new Set<string>()

  for (const movement of snapshot.stockMovements) {
    const product = products.get(movement.productId)

    if (!product) {
      throw new CommerceSnapshotValidationError(
        `Stock movement references an unknown product: ${movement.productId}.`,
      )
    }

    if (product.unit !== movement.unit) {
      throw new CommerceSnapshotValidationError(
        `Stock movement unit does not match product: ${movement.id}.`,
      )
    }

    const movementKey = [
      movement.type,
      movement.productId,
      movement.referenceId ?? '',
    ].join(':')

    if (movementKeys.has(movementKey)) {
      throw new CommerceSnapshotValidationError(
        `Duplicate stock movement reference: ${movementKey}.`,
      )
    }
    movementKeys.add(movementKey)

    if (movement.type === 'purchase') {
      const purchase = movement.referenceId
        ? purchases.get(movement.referenceId)
        : undefined

      if (!purchase || purchase.status !== 'completed') {
        throw new CommerceSnapshotValidationError(
          `Stock movement references an invalid purchase: ${movement.id}.`,
        )
      }
    }

    if (movement.type === 'sale') {
      const sale = movement.referenceId
        ? sales.get(movement.referenceId)
        : undefined

      if (!sale || sale.status !== 'completed') {
        throw new CommerceSnapshotValidationError(
          `Stock movement references an invalid sale: ${movement.id}.`,
        )
      }
    }
  }

  const transactionKeys = new Set<string>()

  for (const transaction of snapshot.transactions) {
    const transactionKey = [
      transaction.category,
      transaction.referenceId ?? '',
    ].join(':')

    if (transaction.referenceId && transactionKeys.has(transactionKey)) {
      throw new CommerceSnapshotValidationError(
        `Duplicate transaction reference: ${transactionKey}.`,
      )
    }
    transactionKeys.add(transactionKey)

    if (transaction.category === 'purchase') {
      const purchase = transaction.referenceId
        ? purchases.get(transaction.referenceId)
        : undefined

      validateDocumentTransaction(transaction, purchase, 'purchase')
    }

    if (transaction.category === 'sale') {
      const sale = transaction.referenceId
        ? sales.get(transaction.referenceId)
        : undefined

      validateDocumentTransaction(transaction, sale, 'sale')
    }
  }

  validateCompletedDocuments(snapshot, purchases, sales)

  const discrepancies = getStockIntegrityDiscrepancies(
    snapshot.products,
    snapshot.stockMovements,
  )

  if (discrepancies.length > 0) {
    throw new CommerceSnapshotValidationError(
      `Product quantity does not match stock movements: ${
        discrepancies[0]?.productId
      }.`,
    )
  }
}

function validateUnique(
  entities: Array<{ id: string }>,
  entityName: string,
): void {
  validateUniqueValues(
    entities.map((entity) => entity.id),
    `${entityName} id`,
  )
}

function validateUniqueValues(
  values: string[],
  valueName: string,
): void {
  const seen = new Set<string>()

  for (const value of values) {
    if (!value || seen.has(value)) {
      throw new CommerceSnapshotValidationError(
        `Duplicate or empty ${valueName}: ${value}.`,
      )
    }
    seen.add(value)
  }
}

function validateDocumentItems(
  documentId: string,
  items: Array<{ productId: string; unit: string }>,
  products: Map<string, Product>,
  documentName: string,
): void {
  const itemProductIds = new Set<string>()

  for (const item of items) {
    const product = products.get(item.productId)

    if (!product) {
      throw new CommerceSnapshotValidationError(
        `${documentName} references an unknown product: ${item.productId}.`,
      )
    }

    if (itemProductIds.has(item.productId)) {
      throw new CommerceSnapshotValidationError(
        `${documentName} has duplicate product items: ${documentId}.`,
      )
    }
    itemProductIds.add(item.productId)

    if (product.unit !== item.unit) {
      throw new CommerceSnapshotValidationError(
        `${documentName} item unit does not match product: ${documentId}.`,
      )
    }
  }
}

function validateDocumentTransaction(
  transaction: Transaction,
  document: Purchase | Sale | undefined,
  category: 'purchase' | 'sale',
): void {
  if (!document || document.status !== 'completed') {
    throw new CommerceSnapshotValidationError(
      `Transaction references an invalid ${category}: ${transaction.id}.`,
    )
  }

  const expectedType = category === 'purchase' ? 'expense' : 'income'

  if (
    transaction.type !== expectedType ||
    transaction.status !== 'completed' ||
    transaction.amount !== document.totalAmount ||
    transaction.paymentMethod !== document.paymentMethod
  ) {
    throw new CommerceSnapshotValidationError(
      `Transaction does not match ${category}: ${transaction.id}.`,
    )
  }
}

function validateCompletedDocuments(
  snapshot: CommerceSnapshot,
  purchases: Map<string, Purchase>,
  sales: Map<string, Sale>,
): void {
  const transactionsByReference = new Set(
    snapshot.transactions
      .filter((transaction) => transaction.referenceId)
      .map((transaction) => [
        transaction.category,
        transaction.referenceId,
      ].join(':')),
  )
  const movementsByReference = new Set(
    snapshot.stockMovements
      .filter((movement) => movement.referenceId)
      .map((movement) => [
        movement.type,
        movement.referenceId,
      ].join(':')),
  )
  const movementsByDocumentItem = new Map(
    snapshot.stockMovements
      .filter((movement) => movement.referenceId)
      .map((movement) => [
        [
          movement.type,
          movement.referenceId,
          movement.productId,
        ].join(':'),
        movement,
      ]),
  )

  for (const purchase of purchases.values()) {
    if (purchase.status === 'completed' && (
      !transactionsByReference.has(`purchase:${purchase.id}`) ||
      !movementsByReference.has(`purchase:${purchase.id}`)
    )) {
      throw new CommerceSnapshotValidationError(
        `Completed purchase is missing its transaction or stock movement: ${purchase.id}.`,
      )
    }

    if (purchase.status === 'completed') {
      for (const item of purchase.items) {
        const movement = movementsByDocumentItem.get(
          `purchase:${purchase.id}:${item.productId}`,
        )

        if (!movement || movement.quantity !== item.quantity) {
          throw new CommerceSnapshotValidationError(
            `Completed purchase stock movement does not match item: ${purchase.id}.`,
          )
        }
      }
    }
  }

  for (const sale of sales.values()) {
    if (sale.status === 'completed' && (
      !transactionsByReference.has(`sale:${sale.id}`) ||
      !movementsByReference.has(`sale:${sale.id}`)
    )) {
      throw new CommerceSnapshotValidationError(
        `Completed sale is missing its transaction or stock movement: ${sale.id}.`,
      )
    }

    if (sale.status === 'completed') {
      for (const item of sale.items) {
        const movement = movementsByDocumentItem.get(
          `sale:${sale.id}:${item.productId}`,
        )

        if (!movement || movement.quantity !== -item.quantity) {
          throw new CommerceSnapshotValidationError(
            `Completed sale stock movement does not match item: ${sale.id}.`,
          )
        }
      }
    }
  }
}

function snapshotSignature(snapshot: CommerceSnapshot): string {
  return JSON.stringify({
    products: snapshot.products.map((product) => ({
      ...product,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    })).sort(byId),
    stockMovements: snapshot.stockMovements.map((movement) => ({
      ...movement,
      createdAt: movement.createdAt.toISOString(),
      updatedAt: movement.updatedAt.toISOString(),
    })).sort(byId),
    purchases: snapshot.purchases.map((purchase) => ({
      ...purchase,
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
      purchaseDate: purchase.purchaseDate.toISOString(),
      items: [...purchase.items].sort(byProductId),
    })).sort(byId),
    sales: snapshot.sales.map((sale) => ({
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleDate: sale.saleDate.toISOString(),
      items: [...sale.items].sort(byProductId),
    })).sort(byId),
    transactions: snapshot.transactions.map((transaction) => ({
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
      transactionDate: transaction.transactionDate.toISOString(),
    })).sort(byId),
  })
}

function byId(
  left: { id: string },
  right: { id: string },
): number {
  return left.id.localeCompare(right.id)
}

function byProductId(
  left: { productId: string },
  right: { productId: string },
): number {
  return left.productId.localeCompare(right.productId)
}
