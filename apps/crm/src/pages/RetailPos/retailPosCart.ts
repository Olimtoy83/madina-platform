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
  discountPercentBasisPoints?: number
}

export type PosCartLineSnapshot = Omit<
  PosCartLine,
  'quantity' | 'discountAmountMinor' | 'discountPercentBasisPoints'
>

export type PosCartMutationResult = {
  lines: PosCartLine[]
  error?:
  | 'invalid-quantity'
  | 'quantity-overflow'
  | 'invalid-discount'
  | 'money-overflow'
}

export type PosCartDiscountMutationResult = {
  lines: PosCartLine[]
  error?:
  | 'line-not-found'
  | 'invalid-discount'
  | 'invalid-percent'
  | 'discount-rounds-to-zero'
  | 'discount-too-large'
  | 'money-overflow'
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

function isValidDiscountPercentBasisPoints(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 9999
}

function calculatePercentDiscountAmountMinor(
  unitPriceMinor: number,
  quantity: number,
  discountPercentBasisPoints: number,
): { amountMinor: number } | { error: 'invalid-discount' | 'money-overflow' | 'discount-rounds-to-zero' } {
  if (!isPositiveSafeInteger(unitPriceMinor)
    || !isPositiveSafeInteger(quantity)
    || !isValidDiscountPercentBasisPoints(discountPercentBasisPoints)) {
    return { error: 'invalid-discount' }
  }

  const grossMinor = unitPriceMinor * quantity
  if (!Number.isSafeInteger(grossMinor)) return { error: 'money-overflow' }

  const amountMinor = (BigInt(grossMinor) * BigInt(discountPercentBasisPoints) + 5000n) / 10000n
  if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) return { error: 'money-overflow' }

  const safeAmountMinor = Number(amountMinor)
  if (safeAmountMinor === 0) return { error: 'discount-rounds-to-zero' }
  if (!isPositiveSafeInteger(safeAmountMinor) || safeAmountMinor >= grossMinor) {
    return { error: 'invalid-discount' }
  }

  return { amountMinor: safeAmountMinor }
}

function withRecalculatedPercentDiscount(
  line: PosCartLine,
  quantity: number,
): { line: PosCartLine } | { error: 'invalid-discount' | 'money-overflow' } {
  if (line.discountPercentBasisPoints === undefined) {
    return { line: { ...line, quantity } }
  }

  const calculated = calculatePercentDiscountAmountMinor(
    line.unitPriceMinor,
    quantity,
    line.discountPercentBasisPoints,
  )
  if ('error' in calculated) {
    return { error: calculated.error === 'discount-rounds-to-zero'
      ? 'invalid-discount'
      : calculated.error }
  }

  return {
    line: {
      ...line,
      quantity,
      discountAmountMinor: calculated.amountMinor,
    },
  }
}

export function parsePosCartDiscountPercentBasisPoints(
  value: string,
): { status: 'ready'; basisPoints: number } | { status: 'invalid' } {
  const normalized = value.trim().replace(',', '.')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return { status: 'invalid' }

  try {
    const wholePercent = BigInt(match[1]!)
    const fractionalPercent = (match[2] ?? '').padEnd(2, '0')
    const basisPoints = wholePercent * 100n + BigInt(fractionalPercent || '0')
    if (basisPoints < 1n || basisPoints > 9999n) return { status: 'invalid' }
    return { status: 'ready', basisPoints: Number(basisPoints) }
  } catch {
    return { status: 'invalid' }
  }
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

  const nextQuantity = current.quantity + 1
  const updated = withRecalculatedPercentDiscount({
    ...snapshot,
    quantity: current.quantity,
    ...(current.discountAmountMinor === undefined
      ? {}
      : { discountAmountMinor: current.discountAmountMinor }),
    ...(current.discountPercentBasisPoints === undefined
      ? {}
      : { discountPercentBasisPoints: current.discountPercentBasisPoints }),
  }, nextQuantity)
  if ('error' in updated) return { lines: [...lines], error: updated.error }

  return {
    lines: lines.map((line, lineIndex) => lineIndex === index ? updated.line : line),
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

  const updated = withRecalculatedPercentDiscount(line, line.quantity + 1)
  if ('error' in updated) return { lines: [...lines], error: updated.error }

  return {
    lines: lines.map((item) => item.productId === productId ? updated.line : item),
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

  const updated = withRecalculatedPercentDiscount(line, Math.max(1, line.quantity - 1))
  if ('error' in updated) return { lines: [...lines], error: updated.error }

  return {
    lines: lines.map((item) => item.productId === productId ? updated.line : item),
  }
}

export function setPosCartLineDiscount(
  lines: readonly PosCartLine[],
  productId: string,
  discountAmountMinor: number | undefined,
): PosCartDiscountMutationResult {
  const line = lines.find((item) => item.productId === productId)

  if (!line) {
    return { lines: [...lines], error: 'line-not-found' }
  }

  if (discountAmountMinor === undefined) {
    return {
      lines: lines.map((item) => item.productId === productId
        ? (() => {
          const {
            discountAmountMinor: _discountAmountMinor,
            discountPercentBasisPoints: _discountPercentBasisPoints,
            ...rest
          } = item
          return rest
        })()
        : item),
    }
  }

  if (!isPositiveSafeInteger(discountAmountMinor)) {
    return { lines: [...lines], error: 'invalid-discount' }
  }

  if (!isPositiveSafeInteger(line.unitPriceMinor)
    || !isPositiveSafeInteger(line.quantity)) {
    return { lines: [...lines], error: 'invalid-discount' }
  }

  const lineTotalMinor = line.unitPriceMinor * line.quantity
  if (!Number.isSafeInteger(lineTotalMinor)) {
    return { lines: [...lines], error: 'money-overflow' }
  }

  if (discountAmountMinor >= lineTotalMinor) {
    return { lines: [...lines], error: 'discount-too-large' }
  }

  return {
    lines: lines.map((item) => item.productId === productId
      ? (() => {
        const { discountPercentBasisPoints: _discountPercentBasisPoints, ...rest } = item
        return { ...rest, discountAmountMinor }
      })()
      : item),
  }
}

export function setPosCartLinePercentDiscount(
  lines: readonly PosCartLine[],
  productId: string,
  discountPercentBasisPoints: number,
): PosCartDiscountMutationResult {
  const line = lines.find((item) => item.productId === productId)
  if (!line) return { lines: [...lines], error: 'line-not-found' }
  if (!isValidDiscountPercentBasisPoints(discountPercentBasisPoints)) {
    return { lines: [...lines], error: 'invalid-percent' }
  }

  const calculated = calculatePercentDiscountAmountMinor(
    line.unitPriceMinor,
    line.quantity,
    discountPercentBasisPoints,
  )
  if ('error' in calculated) return { lines: [...lines], error: calculated.error }

  return {
    lines: lines.map((item) => item.productId === productId
      ? {
        ...item,
        discountAmountMinor: calculated.amountMinor,
        discountPercentBasisPoints,
      }
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
    if (line.discountPercentBasisPoints !== undefined) {
      const calculated = calculatePercentDiscountAmountMinor(
        line.unitPriceMinor,
        line.quantity,
        line.discountPercentBasisPoints,
      )
      if ('error' in calculated || calculated.amountMinor !== line.discountAmountMinor) {
        return { status: 'invalid-line' }
      }
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
