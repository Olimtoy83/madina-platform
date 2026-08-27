import type {
  ApiErrorResponse,
  CommerceCompletionResponse,
  ImportCommerceSnapshotRequest,
  ImportCommerceSnapshotResponse,
  ProductResponse,
  ProductsListResponse,
  PurchaseResponse,
  PurchasesListResponse,
  SaleResponse,
  SalesListResponse,
  StockMovementResponse,
  StockMovementsListResponse,
  TransactionResponse,
  TransactionsListResponse,
} from '@madina/api'
import type {
  CommerceRepository,
  CommerceService,
  CommerceSnapshot,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'
import { CommerceSnapshotValidationError } from '@madina/core'
import type { FastifyInstance } from 'fastify'

interface CommerceRoutesOptions {
  commerceRepository: CommerceRepository
  commerceService: CommerceService
}

interface PurchaseParams {
  purchaseId: string
}

interface SaleParams {
  saleId: string
}

function toProductResponse(product: Product): ProductResponse {
  return {
    id: product.id,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    name: product.name,
    category: product.category,
    quantity: product.quantity,
    unit: product.unit,
    costPrice: product.costPrice,
    salePrice: product.salePrice,
    status: product.status,
  }
}

function toStockMovementResponse(
  stockMovement: StockMovement,
): StockMovementResponse {
  return {
    id: stockMovement.id,
    createdAt: stockMovement.createdAt.toISOString(),
    updatedAt: stockMovement.updatedAt.toISOString(),
    productId: stockMovement.productId,
    type: stockMovement.type,
    quantity: stockMovement.quantity,
    unit: stockMovement.unit,
    referenceId: stockMovement.referenceId,
    note: stockMovement.note,
  }
}

function toPurchaseResponse(purchase: Purchase): PurchaseResponse {
  return {
    id: purchase.id,
    createdAt: purchase.createdAt.toISOString(),
    updatedAt: purchase.updatedAt.toISOString(),
    purchaseNumber: purchase.purchaseNumber,
    supplierName: purchase.supplierName,
    purchaseDate: purchase.purchaseDate.toISOString(),
    status: purchase.status,
    totalAmount: purchase.totalAmount,
    paymentMethod: purchase.paymentMethod,
    note: purchase.note,
    items: purchase.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitCost,
      totalCost: item.totalCost,
    })),
  }
}

function toSaleResponse(sale: Sale): SaleResponse {
  return {
    id: sale.id,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
    saleNumber: sale.saleNumber,
    clientId: sale.clientId,
    clientName: sale.clientName,
    saleDate: sale.saleDate.toISOString(),
    status: sale.status,
    totalAmount: sale.totalAmount,
    paymentMethod: sale.paymentMethod,
    note: sale.note,
    items: sale.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalAmount: item.totalAmount,
    })),
  }
}

function toTransactionResponse(
  transaction: Transaction,
): TransactionResponse {
  return {
    id: transaction.id,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    type: transaction.type,
    category: transaction.category,
    amount: transaction.amount,
    paymentMethod: transaction.paymentMethod,
    description: transaction.description,
    transactionDate: transaction.transactionDate.toISOString(),
    referenceId: transaction.referenceId,
    status: transaction.status,
  }
}

function parseDate(value: string, fieldName: string): Date {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new CommerceSnapshotValidationError(
      `${fieldName} is invalid.`,
    )
  }

  return date
}

function toCommerceSnapshot(
  input: ImportCommerceSnapshotRequest,
): CommerceSnapshot {
  return {
    products: input.products.map((product) => ({
      ...product,
      createdAt: parseDate(product.createdAt, 'Product createdAt'),
      updatedAt: parseDate(product.updatedAt, 'Product updatedAt'),
    })),
    stockMovements: input.stockMovements.map((movement) => ({
      ...movement,
      createdAt: parseDate(movement.createdAt, 'Stock movement createdAt'),
      updatedAt: parseDate(movement.updatedAt, 'Stock movement updatedAt'),
    })),
    purchases: input.purchases.map((purchase) => ({
      ...purchase,
      createdAt: parseDate(purchase.createdAt, 'Purchase createdAt'),
      updatedAt: parseDate(purchase.updatedAt, 'Purchase updatedAt'),
      purchaseDate: parseDate(purchase.purchaseDate, 'Purchase date'),
    })),
    sales: input.sales.map((sale) => ({
      ...sale,
      createdAt: parseDate(sale.createdAt, 'Sale createdAt'),
      updatedAt: parseDate(sale.updatedAt, 'Sale updatedAt'),
      saleDate: parseDate(sale.saleDate, 'Sale date'),
    })),
    transactions: input.transactions.map((transaction) => ({
      ...transaction,
      createdAt: parseDate(transaction.createdAt, 'Transaction createdAt'),
      updatedAt: parseDate(transaction.updatedAt, 'Transaction updatedAt'),
      transactionDate: parseDate(
        transaction.transactionDate,
        'Transaction date',
      ),
    })),
  }
}

function toSnapshotImportError(
  error: CommerceSnapshotValidationError,
): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message: error.message,
  }
}

export async function commerceRoutes(
  app: FastifyInstance,
  options: CommerceRoutesOptions,
) {
  app.get(
    '/products',
    async (): Promise<ProductsListResponse> => ({
      products: (await options.commerceRepository.findAllProducts())
        .map(toProductResponse),
    }),
  )

  app.get(
    '/stock-movements',
    async (): Promise<StockMovementsListResponse> => ({
      stockMovements: (
        await options.commerceRepository.findAllStockMovements()
      ).map(toStockMovementResponse),
    }),
  )

  app.get(
    '/purchases',
    async (): Promise<PurchasesListResponse> => ({
      purchases: (await options.commerceRepository.findAllPurchases())
        .map(toPurchaseResponse),
    }),
  )

  app.get(
    '/sales',
    async (): Promise<SalesListResponse> => ({
      sales: (await options.commerceRepository.findAllSales())
        .map(toSaleResponse),
    }),
  )

  app.get(
    '/transactions',
    async (): Promise<TransactionsListResponse> => ({
      transactions: (await options.commerceRepository.findAllTransactions())
        .map(toTransactionResponse),
    }),
  )

  app.post<{
    Body: ImportCommerceSnapshotRequest
  }>(
    '/import',
    async (
      request,
      reply,
    ): Promise<ImportCommerceSnapshotResponse | ApiErrorResponse> => {
      try {
        return await options.commerceService.importSnapshot(
          toCommerceSnapshot(request.body),
        )
      } catch (error) {
        if (error instanceof CommerceSnapshotValidationError) {
          reply.code(400)
          return toSnapshotImportError(error)
        }

        throw error
      }
    },
  )

  app.post<{ Params: PurchaseParams }>(
    '/purchases/:purchaseId/complete',
    async (request, reply): Promise<CommerceCompletionResponse> => {
      const result = await options.commerceService.completePurchase(
        request.params.purchaseId,
      )

      if (!result.success) {
        reply.code(400)
      }

      return {
        success: result.success,
        idempotent: result.idempotent,
        message: result.message,
      }
    },
  )

  app.post<{ Params: SaleParams }>(
    '/sales/:saleId/complete',
    async (request, reply): Promise<CommerceCompletionResponse> => {
      const result = await options.commerceService.completeSale(
        request.params.saleId,
      )

      if (!result.success) {
        reply.code(400)
      }

      return {
        success: result.success,
        idempotent: result.idempotent,
        message: result.message,
      }
    },
  )
}
