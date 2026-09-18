import type { PosCheckoutAttempt } from './retailPosCheckout'
import {
  parsePosPaymentAmount,
  summarizePosPayments,
  withPosPaymentOrdinals,
  type PosPaymentAllocation,
  type PosPaymentSummary,
} from './retailPosPayments'
import type { PosCompletionPayload } from './retailPosSubmissionRecovery'

export interface CreatePosCompletionPayloadInput {
  checkoutAttempt: PosCheckoutAttempt
  paymentAllocations: readonly PosPaymentAllocation[]
  paymentSummary: PosPaymentSummary
  currencyExponent: number
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function assertCheckoutAttempt(attempt: PosCheckoutAttempt): void {
  if (!isNonEmptyString(attempt.locationId)
    || !isNonEmptyString(attempt.saleId)
    || !isNonEmptyString(attempt.clientOperationId)
    || attempt.lines.length === 0) {
    throw new Error('A valid prepared checkout attempt is required.')
  }

  const lineIds = new Set<string>()
  const productIds = new Set<string>()
  for (const line of attempt.lines) {
    if (!isNonEmptyString(line.id)
      || !isNonEmptyString(line.productId)
      || !isPositiveSafeInteger(line.quantity)
      || (line.discountAmountMinor !== undefined
        && !isPositiveSafeInteger(line.discountAmountMinor))
      || lineIds.has(line.id)
      || productIds.has(line.productId)) {
      throw new Error('Prepared checkout lines are invalid.')
    }
    lineIds.add(line.id)
    productIds.add(line.productId)
  }
}

export function createPosCompletionPayload(
  input: CreatePosCompletionPayloadInput,
): PosCompletionPayload {
  assertCheckoutAttempt(input.checkoutAttempt)

  if (input.paymentSummary.status !== 'exact') {
    throw new Error('Exact payment allocations are required.')
  }

  const verifiedSummary = summarizePosPayments(
    input.paymentAllocations,
    input.paymentSummary.targetMinor,
    input.currencyExponent,
  )
  if (verifiedSummary.status !== 'exact'
    || verifiedSummary.allocatedMinor !== input.paymentSummary.allocatedMinor
    || verifiedSummary.targetMinor !== input.paymentSummary.targetMinor) {
    throw new Error('Exact payment allocations are required.')
  }

  const allocationIds = new Set<string>()
  const allocations = withPosPaymentOrdinals(input.paymentAllocations).map(
    (allocation) => {
      const parsed = parsePosPaymentAmount(allocation.amountText, input.currencyExponent)
      if (!isNonEmptyString(allocation.id)
        || allocationIds.has(allocation.id)
        || parsed.status !== 'ready') {
        throw new Error('Payment allocations are invalid.')
      }
      allocationIds.add(allocation.id)
      return {
        id: allocation.id,
        method: allocation.method,
        amountMinor: parsed.amountMinor,
        ordinal: allocation.ordinal,
      }
    },
  )

  return {
    clientOperationId: input.checkoutAttempt.clientOperationId,
    saleId: input.checkoutAttempt.saleId,
    lines: input.checkoutAttempt.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity,
      ...(line.discountAmountMinor === undefined
        ? {}
        : { discountAmountMinor: line.discountAmountMinor }),
    })),
    allocations,
  }
}
