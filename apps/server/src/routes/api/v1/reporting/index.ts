import type {
  AccountingReportQuery as ApiAccountingReportQuery,
  AccountingReportResponse,
  ApiErrorResponse,
  FinancialTransactionRowResponse,
  IncomeReportQuery,
  IncomeReportResponse,
  ReportingSummaryResponse,
} from '@madina/api'
import type {
  AccountingReportPeriod,
  AccountingReportQuery,
  ReportingReadService,
  Transaction,
  TransactionType,
} from '@madina/core'
import { resolveAccountingReportWindow } from '@madina/core'
import type { FastifyInstance } from 'fastify'
import { requirePermission } from '../../../../plugins/authentication.js'

interface ReportingRoutesOptions {
  reportingReadService: ReportingReadService
}

const DEFAULT_INCOME_LIMIT = 50
const MAX_INCOME_LIMIT = 100
const DEFAULT_ACCOUNTING_LIMIT = 50
const MAX_ACCOUNTING_LIMIT = 100

interface IncomeCursor {
  version: 1
  transactionDate: string
  id: string
  filters: {
    type?: TransactionType
  }
}

interface NormalizedIncomeQuery {
  limit: number
  type?: TransactionType
  cursor?: {
    transactionDate: Date
    id: string
  }
}

interface AccountingCursor {
  version: 1
  transactionDate: string
  id: string
  filters: {
    period: AccountingReportPeriod
    type?: TransactionType
  }
  window: {
    from?: string
    to: string
  }
}

interface NormalizedAccountingQuery extends AccountingReportQuery {}

class IncomeReportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncomeReportValidationError'
  }
}

class AccountingReportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountingReportValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertAllowedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!['type', 'limit', 'cursor'].includes(key)) {
      throw new IncomeReportValidationError(
        'Income report query contains an unsupported parameter.',
      )
    }
  }
}

function assertCursorFilterKeys(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => key !== 'type')) {
    throw new IncomeReportValidationError('Income report query cursor is invalid.')
  }
}

function normalizeType(value: unknown): TransactionType | undefined {
  if (value === undefined) return undefined

  if (value === 'income' || value === 'expense') return value

  throw new IncomeReportValidationError('Income report query type is invalid.')
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_INCOME_LIMIT

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new IncomeReportValidationError('Income report query limit is invalid.')
  }

  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_INCOME_LIMIT) {
    throw new IncomeReportValidationError(
      `Income report query limit must be between 1 and ${MAX_INCOME_LIMIT}.`,
    )
  }

  return limit
}

function decodeCursor(value: unknown): IncomeCursor | undefined {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new IncomeReportValidationError('Income report query cursor is invalid.')
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(decoded)) throw new IncomeReportValidationError('Income report query cursor is invalid.')

    const keys = Object.keys(decoded)
    if (keys.some((key) => !['version', 'transactionDate', 'id', 'filters'].includes(key)) ||
      decoded.version !== 1 ||
      typeof decoded.transactionDate !== 'string' ||
      typeof decoded.id !== 'string' || !decoded.id.trim() ||
      !isRecord(decoded.filters)) {
      throw new IncomeReportValidationError('Income report query cursor is invalid.')
    }

    const transactionDate = new Date(decoded.transactionDate)
    if (Number.isNaN(transactionDate.getTime())) {
      throw new IncomeReportValidationError('Income report query cursor is invalid.')
    }

    assertCursorFilterKeys(decoded.filters)
    return {
      version: 1,
      transactionDate: transactionDate.toISOString(),
      id: decoded.id,
      filters: { type: normalizeType(decoded.filters.type) },
    }
  } catch (error) {
    if (error instanceof IncomeReportValidationError) throw error
    throw new IncomeReportValidationError('Income report query cursor is invalid.')
  }
}

function normalizeIncomeQuery(
  input: IncomeReportQuery | unknown,
): NormalizedIncomeQuery {
  if (!isRecord(input)) {
    throw new IncomeReportValidationError('Income report query is invalid.')
  }

  assertAllowedKeys(input)
  const type = normalizeType(input.type)
  const cursor = decodeCursor(input.cursor)

  if (cursor && cursor.filters.type !== type) {
    throw new IncomeReportValidationError(
      'Income report query cursor does not match the current filters.',
    )
  }

  return {
    limit: parseLimit(input.limit),
    type,
    cursor: cursor
      ? {
        transactionDate: new Date(cursor.transactionDate),
        id: cursor.id,
      }
      : undefined,
  }
}

function toIncomeTransactionResponse(
  transaction: Transaction,
): FinancialTransactionRowResponse {
  return {
    id: transaction.id,
    type: transaction.type,
    category: transaction.category,
    amount: transaction.amount,
    paymentMethod: transaction.paymentMethod,
    transactionDate: transaction.transactionDate.toISOString(),
    description: transaction.description,
    status: 'completed',
  }
}

function encodeCursor(
  transaction: Transaction,
  type: TransactionType | undefined,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    transactionDate: transaction.transactionDate.toISOString(),
    id: transaction.id,
    filters: type ? { type } : {},
  } satisfies IncomeCursor)).toString('base64url')
}

function normalizeAccountingPeriod(value: unknown): AccountingReportPeriod {
  if (value === undefined) return 'all'

  if (
    value === 'all' ||
    value === 'today' ||
    value === '7days' ||
    value === 'month'
  ) {
    return value
  }

  throw new AccountingReportValidationError(
    'Accounting report query period is invalid.',
  )
}

function normalizeAccountingType(
  value: unknown,
): TransactionType | undefined {
  if (value === undefined) return undefined

  if (value === 'income' || value === 'expense') return value

  throw new AccountingReportValidationError(
    'Accounting report query type is invalid.',
  )
}

function parseAccountingLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_ACCOUNTING_LIMIT

  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new AccountingReportValidationError(
      'Accounting report query limit is invalid.',
    )
  }

  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_ACCOUNTING_LIMIT) {
    throw new AccountingReportValidationError(
      `Accounting report query limit must be between 1 and ${MAX_ACCOUNTING_LIMIT}.`,
    )
  }

  return limit
}

function assertAccountingQueryKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!['period', 'type', 'limit', 'cursor'].includes(key)) {
      throw new AccountingReportValidationError(
        'Accounting report query contains an unsupported parameter.',
      )
    }
  }
}

function parseIsoInstant(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new AccountingReportValidationError(
      'Accounting report query cursor is invalid.',
    )
  }

  const instant = new Date(value)
  if (
    Number.isNaN(instant.getTime()) ||
    instant.toISOString() !== value
  ) {
    throw new AccountingReportValidationError(
      'Accounting report query cursor is invalid.',
    )
  }

  return instant
}

function decodeAccountingCursor(value: unknown): AccountingCursor | undefined {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AccountingReportValidationError(
      'Accounting report query cursor is invalid.',
    )
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!isRecord(decoded) || !isRecord(decoded.filters) || !isRecord(decoded.window)) {
      throw new AccountingReportValidationError(
        'Accounting report query cursor is invalid.',
      )
    }

    const allowedKeys = ['version', 'transactionDate', 'id', 'filters', 'window']
    const allowedFilterKeys = ['period', 'type']
    const allowedWindowKeys = ['from', 'to']
    if (
      Object.keys(decoded).some((key) => !allowedKeys.includes(key)) ||
      Object.keys(decoded.filters).some((key) => !allowedFilterKeys.includes(key)) ||
      Object.keys(decoded.window).some((key) => !allowedWindowKeys.includes(key)) ||
      decoded.version !== 1 ||
      typeof decoded.id !== 'string' || !decoded.id.trim()
    ) {
      throw new AccountingReportValidationError(
        'Accounting report query cursor is invalid.',
      )
    }

    const from = decoded.window.from === undefined
      ? undefined
      : parseIsoInstant(decoded.window.from)
    const to = parseIsoInstant(decoded.window.to)
    if (from && from > to) {
      throw new AccountingReportValidationError(
        'Accounting report query cursor is invalid.',
      )
    }

    return {
      version: 1,
      transactionDate: parseIsoInstant(decoded.transactionDate).toISOString(),
      id: decoded.id,
      filters: {
        period: normalizeAccountingPeriod(decoded.filters.period),
        type: normalizeAccountingType(decoded.filters.type),
      },
      window: {
        from: from?.toISOString(),
        to: to.toISOString(),
      },
    }
  } catch (error) {
    if (error instanceof AccountingReportValidationError) throw error
    throw new AccountingReportValidationError(
      'Accounting report query cursor is invalid.',
    )
  }
}

function normalizeAccountingQuery(
  input: ApiAccountingReportQuery | unknown,
  effectiveNow: Date,
): NormalizedAccountingQuery {
  if (!isRecord(input)) {
    throw new AccountingReportValidationError('Accounting report query is invalid.')
  }

  assertAccountingQueryKeys(input)
  const period = normalizeAccountingPeriod(input.period)
  const type = normalizeAccountingType(input.type)
  const cursor = decodeAccountingCursor(input.cursor)

  if (
    cursor &&
    (cursor.filters.period !== period || cursor.filters.type !== type)
  ) {
    throw new AccountingReportValidationError(
      'Accounting report query cursor does not match the current filters.',
    )
  }

  return {
    period,
    type,
    limit: parseAccountingLimit(input.limit),
    window: cursor
      ? {
        from: cursor.window.from ? new Date(cursor.window.from) : undefined,
        to: new Date(cursor.window.to),
      }
      : resolveAccountingReportWindow(period, effectiveNow),
    cursor: cursor
      ? {
        transactionDate: new Date(cursor.transactionDate),
        id: cursor.id,
      }
      : undefined,
  }
}

function encodeAccountingCursor(
  transaction: Transaction,
  query: AccountingReportQuery,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    transactionDate: transaction.transactionDate.toISOString(),
    id: transaction.id,
    filters: query.type
      ? { period: query.period, type: query.type }
      : { period: query.period },
    window: {
      from: query.window.from?.toISOString(),
      to: query.window.to.toISOString(),
    },
  } satisfies AccountingCursor)).toString('base64url')
}

function badRequestResponse(message: string): ApiErrorResponse {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message,
  }
}

export async function reportingRoutes(
  app: FastifyInstance,
  options: ReportingRoutesOptions,
) {
  app.get(
    '/summary',
    {
      preHandler: requirePermission(app, 'reports:read'),
    },
    async (): Promise<ReportingSummaryResponse> =>
      options.reportingReadService.getAllTimeSummary(),
  )

  app.get<{
    Querystring: IncomeReportQuery
  }>(
    '/income',
    {
      preHandler: requirePermission(app, 'reports:read'),
    },
    async (request, reply): Promise<IncomeReportResponse | ApiErrorResponse> => {
      try {
        const query = normalizeIncomeQuery(request.query)
        const report = await options.reportingReadService.getIncomeReport({
          ...query,
          limit: query.limit + 1,
        })
        const items = report.transactions.slice(0, query.limit)
        const last = items.at(-1)

        return {
          summary: report.summary,
          transactions: {
            items: items.map(toIncomeTransactionResponse),
            nextCursor: report.transactions.length > query.limit && last
              ? encodeCursor(last, query.type)
              : undefined,
          },
        }
      } catch (error) {
        if (error instanceof IncomeReportValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }

        throw error
      }
    },
  )

  app.get<{
    Querystring: ApiAccountingReportQuery
  }>(
    '/accounting',
    {
      preHandler: requirePermission(app, 'reports:read'),
    },
    async (request, reply): Promise<
      AccountingReportResponse | ApiErrorResponse
    > => {
      try {
        const effectiveNow = new Date()
        const query = normalizeAccountingQuery(
          request.query,
          effectiveNow,
        )
        const report = await options.reportingReadService.getAccountingReport({
          ...query,
          limit: query.limit + 1,
        })
        const items = report.transactions.slice(0, query.limit)
        const last = items.at(-1)

        return {
          summary: report.summary,
          categories: report.categories,
          transactions: {
            items: items.map(toIncomeTransactionResponse),
            nextCursor: report.transactions.length > query.limit && last
              ? encodeAccountingCursor(last, query)
              : undefined,
          },
        }
      } catch (error) {
        if (error instanceof AccountingReportValidationError) {
          reply.code(400)
          return badRequestResponse(error.message)
        }

        throw error
      }
    },
  )
}
