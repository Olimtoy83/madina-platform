export interface PosCartLine {
  productId: string
  sourceId: string
  name: string
  baseUnit: 'piece'
  quantity: number
  unitPriceMinor: number
  currencyCode: string
  currencyExponent: number
  discountAmountMinor?: number
}

export type PosCartLineSnapshot = Omit<PosCartLine, 'quantity' | 'discountAmountMinor'>

export type PosCartMutationResult = {
  lines: PosCartLine[]
  error?: 'invalid-quantity' | 'quantity-overflow'
}

export type PosCartTotalsResult =
  | { status: 'empty' }
  | {
      status: 'ready'
      currencyCode: string
      currencyExponent: number
      lineTotals: Array<{ productId: string; lineTotalMinor: number }>
      subtotalMinor: number
      discountTotalMinor: number
      payableTotalMinor: number
    }
  | { status: 'invalid-line' | 'currency-mismatch' | 'money-overflow' }

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

export function addPosCartLine(
  lines: readonly PosCartLine[],
  snapshot: PosCartLineSnapshot,
): PosCartMutationResult {
  const index = lines.findIndex((line) => line.productId === snapshot.productId)
  if (index < 0) {
    return { lines: [...lines, { ...snapshot, quantity: 1 }] }
  }

  const current = lines[index]!
  if (!isPositiveSafeInteger(current.quantity)) {
    return { lines: [...lines], error: 'invalid-quantity' }
  }
  if (current.quantity >= Number.MAX_SAFE_INTEGER) {
    return { lines: [...lines], error: 'quantity-overflow' }
  }

  return {
    lines: lines.map((line, lineIndex) => lineIndex === index
      ? {
          ...snapshot,
          quantity: current.quantity + 1,
          ...(current.discountAmountMinor === undefined
            ? {}
            : { discountAmountMinor: current.discountAmountMinor }),
        }
      : line),
  }
}

export function incrementPosCartLine(
  lines: readonly PosCartLine[],
  productId: string,
): PosCartMutationResult {
  const line = lines.find((item) => item.productId === productId)
  if (!line || !isPositiveSafeInteger(line.quantity)) {
    return { lines: [...lines], error: 'invalid-quantity' }
  }
  if (line.quantity >= Number.MAX_SAFE_INTEGER) {
    return { lines: [...lines], error: 'quantity-overflow' }
  }

  return {
    lines: lines.map((item) => item.productId === productId
      ? { ...item, quantity: item.quantity + 1 }
      : item),
  }
}

export function decrementPosCartLine(
  lines: readonly PosCartLine[],
  productId: string,
): PosCartMutationResult {
  const line = lines.find((item) => item.productId === productId)
  if (!line || !isPositiveSafeInteger(line.quantity)) {
    return { lines: [...lines], error: 'invalid-quantity' }
  }

  return {
    lines: lines.map((item) => item.productId === productId
      ? { ...item, quantity: Math.max(1, item.quantity - 1) }
      : item),
  }
}

export function removePosCartLine(
  lines: readonly PosCartLine[],
  productId: string,
): PosCartLine[] {
  return lines.filter((line) => line.productId !== productId)
}

export function clearPosCart(): PosCartLine[] {
  return []
}

export function calculatePosCartTotals(
  lines: readonly PosCartLine[],
): PosCartTotalsResult {
  if (lines.length === 0) return { status: 'empty' }

  const firstLine = lines[0]!
  let subtotalMinor = 0
  let discountTotalMinor = 0
  const lineTotals: Array<{ productId: string; lineTotalMinor: number }> = []

  for (const line of lines) {
    if (!isPositiveSafeInteger(line.unitPriceMinor)
      || !isPositiveSafeInteger(line.quantity)) {
      return { status: 'invalid-line' }
    }
    if (line.currencyCode !== firstLine.currencyCode
      || line.currencyExponent !== firstLine.currencyExponent) {
      return { status: 'currency-mismatch' }
    }

    const lineTotalMinor = line.unitPriceMinor * line.quantity
    if (!Number.isSafeInteger(lineTotalMinor)) {
      return { status: 'money-overflow' }
    }

    const discountAmountMinor = line.discountAmountMinor ?? 0
    if (line.discountAmountMinor !== undefined
      && (!isPositiveSafeInteger(line.discountAmountMinor)
        || line.discountAmountMinor >= lineTotalMinor)) {
      return { status: 'invalid-line' }
    }

    const nextSubtotalMinor = subtotalMinor + lineTotalMinor
    const nextDiscountTotalMinor = discountTotalMinor + discountAmountMinor
    if (!Number.isSafeInteger(nextSubtotalMinor)
      || !Number.isSafeInteger(nextDiscountTotalMinor)) {
      return { status: 'money-overflow' }
    }

    subtotalMinor = nextSubtotalMinor
    discountTotalMinor = nextDiscountTotalMinor
    lineTotals.push({ productId: line.productId, lineTotalMinor })
  }

  const payableTotalMinor = subtotalMinor - discountTotalMinor
  if (!Number.isSafeInteger(payableTotalMinor) || payableTotalMinor <= 0) {
    return { status: 'money-overflow' }
  }

  return {
    status: 'ready',
    currencyCode: firstLine.currencyCode,
    currencyExponent: firstLine.currencyExponent,
    lineTotals,
    subtotalMinor,
    discountTotalMinor,
    payableTotalMinor,
  }
}
