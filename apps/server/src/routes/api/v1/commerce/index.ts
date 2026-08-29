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
  PurchaseListItemResponse,
  PurchasesHistoryQuery,
  PurchasesHistoryResponse,
  NextPurchaseNumberResponse,
  SaleResponse,
  SalesListResponse,
  SaleListItemResponse,
  SalesHistoryQuery,
  SalesHistoryResponse,
  ClientSalesHistoryResponse,
  ClientSalesMetricsResponse,
  NextSaleNumberResponse,
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
  SaleListItem,
  PurchaseListItem,
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
const DEFAULT_SALES_HISTORY_LIMIT = 50
const MAX_SALES_HISTORY_LIMIT = 100
const DEFAULT_PURCHASES_HISTORY_LIMIT = 50
const MAX_PURCHASES_HISTORY_LIMIT = 100

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

class SalesHistoryValidationError extends Error {
  constructor(message: string) {
    super(message)
  }
}

interface SalesHistoryCursor {
  version: 1
  saleDate: string
  id: string
  filters: { status?: SaleResponse['status']; clientId?: string }
  throughCreatedAt: string
}

interface NormalizedSalesHistoryQuery {
  status?: SaleResponse['status']
  clientId?: string
  limit: number
  throughCreatedAt: Date
  cursor?: { saleDate: Date; id: string }
}

class PurchasesHistoryValidationError extends Error {
  constructor(message: string) {
    super(message)
  }
}

interface PurchasesHistoryCursor {
  version: 1
  purchaseDate: string
  id: string
  throughCreatedAt: string
}

interface NormalizedPurchasesHistoryQuery {
  limit: number
  throughCreatedAt: Date
  cursor?: { purchaseDate: Date; id: string }
}

function parsePurchasesHistoryInstant(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new PurchasesHistoryValidationError('Purchases history cursor is invalid.')
  }
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new PurchasesHistoryValidationError('Purchases history cursor is invalid.')
  }
  return instant
}

function parsePurchasesHistoryLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_PURCHASES_HISTORY_LIMIT
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new PurchasesHistoryValidationError('Purchases history limit is invalid.')
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_PURCHASES_HISTORY_LIMIT) {
    throw new PurchasesHistoryValidationError(
      `Purchases history limit must be between 1 and ${MAX_PURCHASES_HISTORY_LIMIT}.`,
    )
  }
  return limit
}

function decodePurchasesHistoryCursor(value: unknown): PurchasesHistoryCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PurchasesHistoryValidationError('Purchases history cursor is invalid.')
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const allowedKeys = ['version', 'purchaseDate', 'id', 'throughCreatedAt']
    if (!isRecord(decoded) || Object.keys(decoded).some((key) => !allowedKeys.includes(key)) ||
      decoded.version !== 1 || typeof decoded.id !== 'string' || !decoded.id.trim()) {
      throw new Error()
    }
    return {
      version: 1,
      purchaseDate: parsePurchasesHistoryInstant(decoded.purchaseDate).toISOString(),
      id: decoded.id,
      throughCreatedAt: parsePurchasesHistoryInstant(decoded.throughCreatedAt).toISOString(),
    }
  } catch (error) {
    if (error instanceof PurchasesHistoryValidationError) throw error
    throw new PurchasesHistoryValidationError('Purchases history cursor is invalid.')
  }
}

function normalizePurchasesHistoryQuery(
  input: PurchasesHistoryQuery | unknown,
  now: Date,
): NormalizedPurchasesHistoryQuery {
  if (!isRecord(input) || Object.keys(input).some((key) => !['limit', 'cursor'].includes(key))) {
    throw new PurchasesHistoryValidationError('Purchases history query is invalid.')
  }
  const cursor = decodePurchasesHistoryCursor(input.cursor)
  return {
    limit: parsePurchasesHistoryLimit(input.limit),
    throughCreatedAt: cursor ? new Date(cursor.throughCreatedAt) : now,
    cursor: cursor ? { purchaseDate: new Date(cursor.purchaseDate), id: cursor.id } : undefined,
  }
}

function encodePurchasesHistoryCursor(
  purchase: PurchaseListItemResponse,
  query: NormalizedPurchasesHistoryQuery,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    purchaseDate: purchase.purchaseDate,
    id: purchase.id,
    throughCreatedAt: query.throughCreatedAt.toISOString(),
  } satisfies PurchasesHistoryCursor)).toString('base64url')
}

function parseSalesHistoryLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SALES_HISTORY_LIMIT
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new SalesHistoryValidationError('Sales history limit is invalid.')
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_SALES_HISTORY_LIMIT) {
    throw new SalesHistoryValidationError(
      `Sales history limit must be between 1 and ${MAX_SALES_HISTORY_LIMIT}.`,
    )
  }
  return limit
}

function normalizeSaleStatus(value: unknown): SaleResponse['status'] | undefined {
  if (value === undefined) return undefined
  if (value === 'draft' || value === 'completed' || value === 'cancelled') return value
  throw new SalesHistoryValidationError('Sales history status is invalid.')
}

function parseSalesCursorInstant(value: unknown): Date {
  if (typeof value !== 'string') throw new SalesHistoryValidationError('Sales history cursor is invalid.')
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new SalesHistoryValidationError('Sales history cursor is invalid.')
  }
  return instant
}

function decodeSalesHistoryCursor(value: unknown): SalesHistoryCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SalesHistoryValidationError('Sales history cursor is invalid.')
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(decoded) || !isRecord(decoded.filters)) throw new Error()
    const allowedKeys = ['version', 'saleDate', 'id', 'filters', 'throughCreatedAt']
    const allowedFilters = ['status', 'clientId']
    if (Object.keys(decoded).some((key) => !allowedKeys.includes(key)) ||
      Object.keys(decoded.filters).some((key) => !allowedFilters.includes(key)) ||
      decoded.version !== 1 || typeof decoded.id !== 'string' || !decoded.id.trim()) {
      throw new Error()
    }
    return {
      version: 1,
      saleDate: parseSalesCursorInstant(decoded.saleDate).toISOString(),
      id: decoded.id,
      filters: {
        status: normalizeSaleStatus(decoded.filters.status),
        clientId: normalizeOptionalText(decoded.filters.clientId, 'cursor filter'),
      },
      throughCreatedAt: parseSalesCursorInstant(decoded.throughCreatedAt).toISOString(),
    }
  } catch (error) {
    if (error instanceof SalesHistoryValidationError) throw error
    throw new SalesHistoryValidationError('Sales history cursor is invalid.')
  }
}

function normalizeSalesHistoryQuery(
  input: SalesHistoryQuery | unknown,
  now: Date,
): NormalizedSalesHistoryQuery {
  if (!isRecord(input) || Object.keys(input).some((key) => ![
    'status', 'clientId', 'limit', 'cursor',
  ].includes(key))) {
    throw new SalesHistoryValidationError('Sales history query is invalid.')
  }
  const status = normalizeSaleStatus(input.status)
  const clientId = normalizeOptionalText(input.clientId, 'clientId')
  const cursor = decodeSalesHistoryCursor(input.cursor)
  if (cursor && (cursor.filters.status !== status || cursor.filters.clientId !== clientId)) {
    throw new SalesHistoryValidationError(
      'Sales history cursor does not match the current filters.',
    )
  }
  if (clientId && status !== undefined && status !== 'completed') {
    throw new SalesHistoryValidationError(
      'Client sales history supports completed sales only.',
    )
  }
  return {
    status,
    clientId,
    limit: parseSalesHistoryLimit(input.limit),
    throughCreatedAt: cursor ? new Date(cursor.throughCreatedAt) : now,
    cursor: cursor ? { saleDate: new Date(cursor.saleDate), id: cursor.id } : undefined,
  }
}

function encodeSalesHistoryCursor(
  sale: SaleListItemResponse,
  query: NormalizedSalesHistoryQuery,
): string {
  return Buffer.from(JSON.stringify({
    version: 1, saleDate: sale.saleDate, id: sale.id,
    filters: { status: query.status, clientId: query.clientId },
    throughCreatedAt: query.throughCreatedAt.toISOString(),
  } satisfies SalesHistoryCursor)).toString('base64url')
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

function toPurchaseListItemResponse(
  purchase: PurchaseListItem,
): PurchaseListItemResponse {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    purchaseDate: purchase.purchaseDate.toISOString(),
    supplierName: purchase.supplierName,
    itemCount: purchase.itemCount,
    totalAmount: purchase.totalAmount,
    status: purchase.status,
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

function toSaleListItemResponse(sale: SaleListItem): SaleListItemResponse {
  return {
    id: sale.id,
    saleNumber: sale.saleNumber,
    saleDate: sale.saleDate.toISOString(),
    clientId: sale.clientId,
    clientName: sale.clientName,
    totalAmount: sale.totalAmount,
    paymentMethod: sale.paymentMethod,
    status: sale.status,
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

  app.get<{
    Querystring: PurchasesHistoryQuery
  }>(
    '/purchases/history',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<PurchasesHistoryResponse | ApiErrorResponse> => {
      try {
        const query = normalizePurchasesHistoryQuery(request.query, new Date())
        const result = await options.commerceRepository.getPurchasesHistory({
          throughCreatedAt: query.throughCreatedAt,
          limit: query.limit + 1,
          cursor: query.cursor,
        })
        const items = result.purchases.slice(0, query.limit).map(toPurchaseListItemResponse)
        const last = items.at(-1)
        return {
          purchases: {
            items,
            nextCursor: result.purchases.length > query.limit && last
              ? encodePurchasesHistoryCursor(last, query)
              : undefined,
          },
        }
      } catch (error) {
        if (error instanceof PurchasesHistoryValidationError) {
          reply.code(400)
          return { statusCode: 400, error: 'Bad Request', message: error.message }
        }
        throw error
      }
    },
  )

  app.get(
    '/purchases/next-number',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<NextPurchaseNumberResponse> => ({
      purchaseNumber: await options.commerceRepository.getNextPurchaseNumber(),
    }),
  )

  app.get<{
    Params: PurchaseParams
  }>(
    '/purchases/:purchaseId',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<PurchaseResponse | ApiErrorResponse> => {
      const purchase = await options.commerceRepository.findPurchaseById(
        request.params.purchaseId,
      )
      if (!purchase) {
        reply.code(404)
        return { statusCode: 404, error: 'Not Found', message: 'Purchase not found.' }
      }
      return toPurchaseResponse(purchase)
    },
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

  app.get<{
    Querystring: SalesHistoryQuery
  }>(
    '/sales/history',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<
      SalesHistoryResponse | ClientSalesHistoryResponse | ApiErrorResponse
    > => {
      try {
        const query = normalizeSalesHistoryQuery(request.query, new Date())
        if (query.clientId) {
          const result = await options.commerceRepository.getClientSalesHistory(query.clientId, {
            throughCreatedAt: query.throughCreatedAt,
            limit: query.limit + 1,
            cursor: query.cursor,
          })
          const items = result.sales.slice(0, query.limit).map(toSaleListItemResponse)
          const last = items.at(-1)
          return {
            summary: {
              ...result.summary,
              lastSaleDate: result.summary.lastSaleDate?.toISOString(),
            },
            sales: {
              items,
              nextCursor: result.sales.length > query.limit && last
                ? encodeSalesHistoryCursor(last, query)
                : undefined,
            },
          }
        }
        const result = await options.commerceRepository.getSalesHistory({
            status: query.status,
            throughCreatedAt: query.throughCreatedAt,
            limit: query.limit + 1,
            cursor: query.cursor,
          })
        const items = result.sales.slice(0, query.limit).map(toSaleListItemResponse)
        const last = items.at(-1)
        return {
          summary: result.summary,
          sales: {
            items,
            nextCursor: result.sales.length > query.limit && last
              ? encodeSalesHistoryCursor(last, query)
              : undefined,
          },
        }
      } catch (error) {
        if (error instanceof SalesHistoryValidationError) {
          reply.code(400)
          return { statusCode: 400, error: 'Bad Request', message: error.message }
        }
        throw error
      }
    },
  )

  app.get<{
    Querystring: { clientIds?: string }
  }>(
    '/sales/client-metrics',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<ClientSalesMetricsResponse | ApiErrorResponse> => {
      const value = request.query.clientIds
      if (typeof value !== 'string' || !value.trim()) {
        reply.code(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Client sales metrics clientIds is invalid.',
        }
      }
      const clientIds = value.split(',').map((id) => id.trim())
      if (clientIds.some((id) => !id) || new Set(clientIds).size !== clientIds.length) {
        reply.code(400)
        return {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Client sales metrics clientIds is invalid.',
        }
      }
      const metrics = await options.commerceRepository.getClientSalesMetrics(clientIds)
      return {
        metrics: metrics.map((metric) => ({
          ...metric,
          lastSaleDate: metric.lastSaleDate?.toISOString(),
        })),
      }
    },
  )

  app.get(
    '/sales/next-number',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (): Promise<NextSaleNumberResponse> => ({
      saleNumber: await options.commerceRepository.getNextSaleNumber(),
    }),
  )

  app.get<{
    Params: SaleParams
  }>(
    '/sales/:saleId',
    {
      preHandler: requirePermission(app, 'commerce:read'),
    },
    async (request, reply): Promise<SaleResponse | ApiErrorResponse> => {
      const sale = await options.commerceRepository.findSaleById(
        request.params.saleId,
      )
      if (!sale) {
        reply.code(404)
        return { statusCode: 404, error: 'Not Found', message: 'Sale not found.' }
      }
      return toSaleResponse(sale)
    },
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
