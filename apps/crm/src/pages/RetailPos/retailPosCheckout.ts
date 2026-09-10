import type { PosCartLine, PosCartTotalsResult } from './retailPosCart'

export interface PosCheckoutAttempt {
  locationId: string
  saleId: string
  clientOperationId: string
  lines: ReadonlyArray<{
    id: string
    productId: string
    quantity: number
  }>
}

export interface CreatePosCheckoutAttemptInput {
  locationId: string
  cartLines: readonly PosCartLine[]
  cartTotals: PosCartTotalsResult
  createId: () => string
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function createUniqueId(
  createId: () => string,
  usedIds: Set<string>,
): string {
  const id = createId()
  if (!id || usedIds.has(id)) {
    throw new Error('Checkout attempt ID must be unique.')
  }
  usedIds.add(id)
  return id
}

export function createPosCheckoutAttempt(
  input: CreatePosCheckoutAttemptInput,
): PosCheckoutAttempt {
  if (!input.locationId) {
    throw new Error('A location is required to prepare checkout.')
  }
  if (input.cartLines.length === 0) {
    throw new Error('A non-empty cart is required to prepare checkout.')
  }
  if (input.cartTotals.status !== 'ready') {
    throw new Error('Ready cart totals are required to prepare checkout.')
  }
  if (input.cartLines.some((line) => !line.productId || !isPositiveSafeInteger(line.quantity))) {
    throw new Error('Cart lines must contain a Product and a positive quantity.')
  }

  const usedIds = new Set<string>()
  const saleId = createUniqueId(input.createId, usedIds)
  const clientOperationId = createUniqueId(input.createId, usedIds)

  return {
    locationId: input.locationId,
    saleId,
    clientOperationId,
    lines: input.cartLines.map((line) => ({
      id: createUniqueId(input.createId, usedIds),
      productId: line.productId,
      quantity: line.quantity,
    })),
  }
}
