import type {
  ApiErrorResponse,
  AdjustProductStockRequest,
  CommerceCompletionResponse,
  CreateProductRequest,
  CreatePurchaseRequest,
  CreateSaleRequest,
  ImportCommerceSnapshotRequest,
  ImportCommerceSnapshotResponse,
  ImportProductsResponse,
  ProductResponse,
  ProductWorkbookRowError,
  ProductWorkbookValidationErrorResponse,
  ProductsListResponse,
  PurchaseResponse,
  PurchasesListResponse,
  SaleResponse,
  SalesListResponse,
  StockMovementResponse,
  StockAdjustmentResponse,
  StockIntegrityDiscrepancyResponse,
  StockMovementHistoryQuery,
  StockMovementHistoryResponse,
  StockMovementIntegrityResponse,
  StockMovementsListResponse,
  TransactionResponse,
  TransactionsListResponse,
  UpdateProductRequest,
  UpdatePurchaseRequest,
  UpdateSaleRequest,
} from '@madina/api'
import type {
  CommerceRepository,
  CommerceService,
  CommerceSnapshot,
  StockMovementReadService,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Transaction,
} from '@madina/core'
import {
  CommerceCommandError,
  CommerceSnapshotValidationError,
  BulkCreateProductValidationError,
  ProductValidationError,
  PurchaseValidationError,
  SaleValidationError,
} from '@madina/core'
import {
  BusinessDateRangeError,
  resolveBusinessDateRange,
} from '@madina/core'
import type {
  FastifyInstance,
  FastifyRequest,
} from 'fastify'
import {
  requirePermission,
  getAuthenticatedCommandContext,
  requireTrustedOrigin,
} from '../../../../plugins/authentication.js'
import {
  createProductExportWorkbook,
  createProductImportTemplateWorkbook,
  parseProductImportWorkbook,
  PRODUCT_WORKBOOK_MIME_TYPE,
} from '../../../../workbooks/productsWorkbook.js'

interface CommerceRoutesOptions {
  commerceRepository: CommerceRepository
  commerceService: CommerceService
  stockMovementReadService: StockMovementReadService
}

interface PurchaseParams {
  purchaseId: string
}

interface SaleParams {
  saleId: string
}

interface ProductParams {
  productId: string
}

const DEFAULT_STOCK_MOVEMENT_HISTORY_LIMIT = 50
const MAX_STOCK_MOVEMENT_HISTORY_LIMIT = 100

interface StockMovementHistoryCursor {
  version: 1
  createdAt: string
  id: string
  filters: {
    productId?: string
    type?: StockMovementResponse['type']
    dateFrom?: string
    dateTo?: string
  }
  throughCreatedAt: string
}

interface NormalizedStockMovementHistoryQuery {
  productId?: string
  type?: StockMovementResponse['type']
  dateFrom?: string
  dateTo?: string
  limit: number
  throughCreatedAt: Date
  cursor?: {
    createdAt: Date
    id: string
  }
}

class StockMovementHistoryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockMovementHistoryValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHistoryLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_STOCK_MOVEMENT_HISTORY_LIMIT
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history limit is invalid.',
    )
  }

  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_STOCK_MOVEMENT_HISTORY_LIMIT) {
    throw new StockMovementHistoryValidationError(
      `Stock movement history limit must be between 1 and ${MAX_STOCK_MOVEMENT_HISTORY_LIMIT}.`,
    )
  }

  return limit
}

function normalizeHistoryType(
  value: unknown,
): StockMovementResponse['type'] | undefined {
  if (value === undefined) return undefined
  if (value === 'purchase' || value === 'sale' || value === 'adjustment') {
    return value
  }
  throw new StockMovementHistoryValidationError(
    'Stock movement history type is invalid.',
  )
}

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new StockMovementHistoryValidationError(
      `Stock movement history ${field} is invalid.`,
    )
  }
  return value.trim()
}

function parseIsoInstant(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new StockMovementHistoryValidationError(
      'Stock movement history cursor is invalid.',
    )
  }
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history cursor is invalid.',
    )
  }
  return instant
}

function decodeHistoryCursor(
  value: unknown,
): StockMovementHistoryCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history cursor is invalid.',
    )
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(decoded) || !isRecord(decoded.filters)) throw new Error()
    const allowedKeys = ['version', 'createdAt', 'id', 'filters', 'throughCreatedAt']
    const allowedFilters = ['productId', 'type', 'dateFrom', 'dateTo']
    if (
      Object.keys(decoded).some((key) => !allowedKeys.includes(key)) ||
      Object.keys(decoded.filters).some((key) => !allowedFilters.includes(key)) ||
      decoded.version !== 1 ||
      typeof decoded.id !== 'string' || !decoded.id.trim()
    ) throw new Error()

    return {
      version: 1,
      createdAt: parseIsoInstant(decoded.createdAt).toISOString(),
      id: decoded.id,
      filters: {
        productId: normalizeOptionalText(decoded.filters.productId, 'cursor filter'),
        type: normalizeHistoryType(decoded.filters.type),
        dateFrom: normalizeOptionalText(decoded.filters.dateFrom, 'cursor filter'),
        dateTo: normalizeOptionalText(decoded.filters.dateTo, 'cursor filter'),
      },
      throughCreatedAt: parseIsoInstant(decoded.throughCreatedAt).toISOString(),
    }
  } catch (error) {
    if (error instanceof StockMovementHistoryValidationError) throw error
    throw new StockMovementHistoryValidationError(
      'Stock movement history cursor is invalid.',
    )
  }
}

function encodeHistoryCursor(
  movement: StockMovementResponse,
  query: NormalizedStockMovementHistoryQuery,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    createdAt: movement.createdAt,
    id: movement.id,
    filters: {
      productId: query.productId,
      type: query.type,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    },
    throughCreatedAt: query.throughCreatedAt.toISOString(),
  } satisfies StockMovementHistoryCursor)).toString('base64url')
}

function normalizeStockMovementHistoryQuery(
  input: StockMovementHistoryQuery | unknown,
  now: Date,
): NormalizedStockMovementHistoryQuery {
  if (!isRecord(input)) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history query is invalid.',
    )
  }
  if (Object.keys(input).some((key) => ![
    'productId', 'type', 'dateFrom', 'dateTo', 'limit', 'cursor',
  ].includes(key))) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history query contains an unsupported parameter.',
    )
  }

  const productId = normalizeOptionalText(input.productId, 'productId')
  const type = normalizeHistoryType(input.type)
  const dateFrom = normalizeOptionalText(input.dateFrom, 'dateFrom')
  const dateTo = normalizeOptionalText(input.dateTo, 'dateTo')
  const cursor = decodeHistoryCursor(input.cursor)

  if (
    cursor && (
      cursor.filters.productId !== productId ||
      cursor.filters.type !== type ||
      cursor.filters.dateFrom !== dateFrom ||
      cursor.filters.dateTo !== dateTo
    )
  ) {
    throw new StockMovementHistoryValidationError(
      'Stock movement history cursor does not match the current filters.',
    )
  }

  return {
    productId,
    type,
    dateFrom,
    dateTo,
    limit: parseHistoryLimit(input.limit),
    throughCreatedAt: cursor
      ? new Date(cursor.throughCreatedAt)
      : now,
    cursor: cursor
      ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
      : undefined,
  }
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

function toMutationError(error: Error): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message: error.message,
  }
}

function toProductWorkbookValidationError(
  errors: readonly ProductWorkbookRowError[],
): ProductWorkbookValidationErrorResponse {
  return {
    statusCode: 422,
    error: 'Unprocessable Entity',
    message: 'Product workbook validation failed.',
    errors: [...errors],
  }
}

async function readProductImportFile(
  request: FastifyRequest,
): Promise<
  | { ok: true; bytes: Buffer }
  | { ok: false; errors: ProductWorkbookRowError[] }
> {
  let fileCount = 0
  let bytes: Buffer | undefined
  const errors: ProductWorkbookRowError[] = []

  try {
    for await (const part of request.parts()) {
      if (part.type !== 'file') {
        errors.push({
          row: 0,
          code: 'unexpected_field',
          message: 'Product import accepts only one file field.',
        })
        continue
      }

      fileCount += 1
      const content = await part.toBuffer()

      if (part.fieldname !== 'file') {
        errors.push({
          row: 0,
          code: 'unexpected_file_field',
          message: 'Product import file field must be named file.',
        })
        continue
      }

      if (fileCount > 1) {
        errors.push({
          row: 0,
          code: 'multiple_files',
          message: 'Product import accepts exactly one file.',
        })
        continue
      }

      bytes = content
    }
  } catch {
    return {
      ok: false,
      errors: [{
        row: 0,
        code: 'invalid_multipart',
        message: 'Product import multipart payload is invalid or exceeds limits.',
      }],
    }
  }

  if (fileCount === 0 || !bytes) {
    errors.push({
      row: 0,
      code: 'missing_file',
      message: 'Product import requires one XLSX file.',
    })
  }

  return errors.length > 0 || !bytes
    ? { ok: false, errors }
    : { ok: true, bytes }
}

function isMutationError(error: unknown): error is Error {
  return error instanceof CommerceCommandError ||
    error instanceof ProductValidationError ||
    error instanceof PurchaseValidationError ||
    error instanceof SaleValidationError
}

function toCreatePurchaseCommand(input: CreatePurchaseRequest) {
  return {
    ...input,
    purchaseDate: parseDate(input.purchaseDate, 'Purchase date'),
  }
}

function toUpdatePurchaseCommand(input: UpdatePurchaseRequest) {
  const { purchaseDate, ...command } = input

  return Object.hasOwn(input, 'purchaseDate')
    ? {
      ...command,
      purchaseDate: purchaseDate
        ? parseDate(purchaseDate, 'Purchase date')
        : undefined,
    }
    : command
}

function toCreateSaleCommand(input: CreateSaleRequest) {
  return {
    ...input,
    saleDate: parseDate(input.saleDate, 'Sale date'),
  }
}

function toUpdateSaleCommand(input: UpdateSaleRequest) {
  const { saleDate, ...command } = input

  return Object.hasOwn(input, 'saleDate')
    ? {
      ...command,
      saleDate: saleDate
        ? parseDate(saleDate, 'Sale date')
        : undefined,
    }
    : command
}

export async function commerceRoutes(
  app: FastifyInstance,
  options: CommerceRoutesOptions,
) {
  app.get(
    '/products',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<ProductsListResponse> => ({
      products: (await options.commerceRepository.findAllProducts())
        .map(toProductResponse),
    }),
  )

  app.get(
    '/products/import-template',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (_request, reply): Promise<void> => {
      const workbook = await createProductImportTemplateWorkbook()

      reply
        .header(
          'Content-Disposition',
          'attachment; filename="madina-products-import-template-v1.xlsx"',
        )
        .type(PRODUCT_WORKBOOK_MIME_TYPE)
        .send(workbook)
    },
  )

  app.get(
    '/products/export',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (_request, reply): Promise<void> => {
      const products = await options.commerceRepository.findAllProducts()
      const workbook = await createProductExportWorkbook(products)
      const date = new Date().toISOString().slice(0, 10)

      reply
        .header(
          'Content-Disposition',
          `attachment; filename="madina-products-${date}.xlsx"`,
        )
        .type(PRODUCT_WORKBOOK_MIME_TYPE)
        .send(workbook)
    },
  )

  app.post(
    '/products/import',
    {
      preHandler: [
        requirePermission(app, 'data:import'),
        requireTrustedOrigin(),
      ],
    },
    async (
      request,
      reply,
    ): Promise<
      | ImportProductsResponse
      | ProductWorkbookValidationErrorResponse
    > => {
      const upload = await readProductImportFile(request)
      if (!upload.ok) {
        reply.code(422)
        return toProductWorkbookValidationError(upload.errors)
      }

      const preflight = await parseProductImportWorkbook(upload.bytes)
      if (!preflight.ok) {
        reply.code(422)
        return toProductWorkbookValidationError(preflight.errors)
      }

      try {
        const result = await options.commerceService.importProducts(
          {
            templateVersion: 'v1',
            rows: preflight.rows.map((row) => ({
              sourceRow: row.row,
              name: row.name,
              category: row.category,
              unit: row.unit,
              initialQuantity: row.initialQuantity,
              costPrice: row.costPrice,
              salePrice: row.salePrice,
              status: row.status,
            })),
          },
          getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return result
      } catch (error) {
        if (error instanceof BulkCreateProductValidationError) {
          reply.code(422)
          return toProductWorkbookValidationError(error.issues)
        }
        throw error
      }
    },
  )

  app.post<{
    Body: CreateProductRequest
  }>(
    '/products',
    {
      preHandler: [
        requirePermission(app, 'products:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<ProductResponse | ApiErrorResponse> => {
      try {
        const product = await options.commerceService.createProduct(
          request.body, getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return toProductResponse(product)
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.patch<{
    Params: ProductParams
    Body: UpdateProductRequest
  }>(
    '/products/:productId',
    {
      preHandler: [
        requirePermission(app, 'products:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<ProductResponse | ApiErrorResponse> => {
      try {
        const product = await options.commerceService.updateProduct(
          request.params.productId,
          request.body, getAuthenticatedCommandContext(request),
        )
        return toProductResponse(product)
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.post<{
    Params: ProductParams
  }>(
    '/products/:productId/deactivate',
    {
      preHandler: [
        requirePermission(app, 'products:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<ProductResponse | ApiErrorResponse> => {
      try {
        return toProductResponse(
          await options.commerceService.deactivateProduct(
            request.params.productId,
            getAuthenticatedCommandContext(request),
          ),
        )
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.post<{
    Params: ProductParams
    Body: AdjustProductStockRequest
  }>(
    '/products/:productId/stock-adjustments',
    {
      preHandler: [
        requirePermission(app, 'stock:adjust'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<StockAdjustmentResponse | ApiErrorResponse> => {
      try {
        const result = await options.commerceService.adjustProductStock(
          request.params.productId,
          request.body, getAuthenticatedCommandContext(request),
        )
        return {
          product: toProductResponse(result.product),
          stockMovement: toStockMovementResponse(result.movement),
        }
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.get(
    '/stock-movements',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<StockMovementsListResponse> => ({
      stockMovements: (
        await options.commerceRepository.findAllStockMovements()
      ).map(toStockMovementResponse),
    }),
  )

  app.get<{
    Querystring: StockMovementHistoryQuery
  }>(
    '/stock-movements/history',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<
      StockMovementHistoryResponse | ApiErrorResponse
    > => {
      try {
        const query = normalizeStockMovementHistoryQuery(
          request.query,
          new Date(),
        )
        const dates = resolveBusinessDateRange(query.dateFrom, query.dateTo)
        const history = await options.stockMovementReadService.getHistory({
          productId: query.productId,
          type: query.type,
          fromCreatedAt: dates.from,
          toCreatedAtExclusive: dates.toExclusive,
          throughCreatedAt: query.throughCreatedAt,
          limit: query.limit + 1,
          cursor: query.cursor,
        })
        const items = history.movements.slice(0, query.limit)
          .map(toStockMovementResponse)
        const last = items.at(-1)

        return {
          summary: history.summary,
          stockMovements: {
            items,
            nextCursor: history.movements.length > query.limit && last
              ? encodeHistoryCursor(last, query)
              : undefined,
          },
        }
      } catch (error) {
        if (
          error instanceof StockMovementHistoryValidationError ||
          error instanceof BusinessDateRangeError
        ) {
          reply.code(400)
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: error.message,
          }
        }
        throw error
      }
    },
  )

  app.get(
    '/stock-movements/integrity',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<StockMovementIntegrityResponse> => ({
      discrepancies: (
        await options.stockMovementReadService.getIntegrityDiscrepancies()
      ).map((discrepancy): StockIntegrityDiscrepancyResponse => ({
        productId: discrepancy.productId,
        productName: discrepancy.productName,
        actualQuantity: discrepancy.actualQuantity,
        calculatedQuantity: discrepancy.calculatedQuantity,
        difference: discrepancy.difference,
      })),
    }),
  )

  app.get(
    '/purchases',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<PurchasesListResponse> => ({
      purchases: (await options.commerceRepository.findAllPurchases())
        .map(toPurchaseResponse),
    }),
  )

  app.get(
    '/sales',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<SalesListResponse> => ({
      sales: (await options.commerceRepository.findAllSales())
        .map(toSaleResponse),
    }),
  )

  app.get(
    '/transactions',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<TransactionsListResponse> => ({
      transactions: (await options.commerceRepository.findAllTransactions())
        .map(toTransactionResponse),
    }),
  )

  app.post<{
    Body: ImportCommerceSnapshotRequest
  }>(
    '/import',
    {
      preHandler: [
        requirePermission(app, 'data:import'),
        requireTrustedOrigin(),
      ],
    },
    async (
      request,
      reply,
    ): Promise<ImportCommerceSnapshotResponse | ApiErrorResponse> => {
      try {
        return await options.commerceService.importSnapshot(
          toCommerceSnapshot(request.body), {
            ...getAuthenticatedCommandContext(request), actorType: 'migration',
          },
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

  app.post<{
    Body: CreatePurchaseRequest
  }>(
    '/purchases',
    {
      preHandler: [
        requirePermission(app, 'purchases:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<PurchaseResponse | ApiErrorResponse> => {
      try {
        const purchase = await options.commerceService.createPurchase(
          toCreatePurchaseCommand(request.body), getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return toPurchaseResponse(purchase)
      } catch (error) {
        if (isMutationError(error) || error instanceof CommerceSnapshotValidationError) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.patch<{
    Params: PurchaseParams
    Body: UpdatePurchaseRequest
  }>(
    '/purchases/:purchaseId',
    {
      preHandler: [
        requirePermission(app, 'purchases:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<PurchaseResponse | ApiErrorResponse> => {
      try {
        return toPurchaseResponse(
          await options.commerceService.updatePurchase(
            request.params.purchaseId,
            toUpdatePurchaseCommand(request.body), getAuthenticatedCommandContext(request),
          ),
        )
      } catch (error) {
        if (isMutationError(error) || error instanceof CommerceSnapshotValidationError) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.post<{
    Params: PurchaseParams
  }>(
    '/purchases/:purchaseId/cancel',
    {
      preHandler: [
        requirePermission(app, 'purchases:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<PurchaseResponse | ApiErrorResponse> => {
      try {
        return toPurchaseResponse(
          await options.commerceService.cancelPurchase(request.params.purchaseId, getAuthenticatedCommandContext(request)),
        )
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.post<{ Params: PurchaseParams }>(
    '/purchases/:purchaseId/complete',
    {
      preHandler: [
        requirePermission(app, 'purchases:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<CommerceCompletionResponse> => {
      const result = await options.commerceService.completePurchase(
        request.params.purchaseId, getAuthenticatedCommandContext(request),
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
    {
      preHandler: [
        requirePermission(app, 'sales:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<CommerceCompletionResponse> => {
      const result = await options.commerceService.completeSale(
        request.params.saleId, getAuthenticatedCommandContext(request),
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

  app.post<{
    Body: CreateSaleRequest
  }>(
    '/sales',
    {
      preHandler: [
        requirePermission(app, 'sales:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<SaleResponse | ApiErrorResponse> => {
      try {
        const sale = await options.commerceService.createSale(
          toCreateSaleCommand(request.body), getAuthenticatedCommandContext(request),
        )
        reply.code(201)
        return toSaleResponse(sale)
      } catch (error) {
        if (isMutationError(error) || error instanceof CommerceSnapshotValidationError) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.patch<{
    Params: SaleParams
    Body: UpdateSaleRequest
  }>(
    '/sales/:saleId',
    {
      preHandler: [
        requirePermission(app, 'sales:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<SaleResponse | ApiErrorResponse> => {
      try {
        return toSaleResponse(
          await options.commerceService.updateSale(
            request.params.saleId,
            toUpdateSaleCommand(request.body), getAuthenticatedCommandContext(request),
          ),
        )
      } catch (error) {
        if (isMutationError(error) || error instanceof CommerceSnapshotValidationError) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )

  app.post<{
    Params: SaleParams
  }>(
    '/sales/:saleId/cancel',
    {
      preHandler: [
        requirePermission(app, 'sales:write'),
        requireTrustedOrigin(),
      ],
    },
    async (request, reply): Promise<SaleResponse | ApiErrorResponse> => {
      try {
        return toSaleResponse(
          await options.commerceService.cancelSale(request.params.saleId, getAuthenticatedCommandContext(request)),
        )
      } catch (error) {
        if (isMutationError(error)) {
          reply.code(400)
          return toMutationError(error)
        }
        throw error
      }
    },
  )
}
