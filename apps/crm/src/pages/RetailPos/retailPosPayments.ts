export type PosPaymentMethod = 'cash' | 'card' | 'transfer' | 'other'

export interface PosPaymentAllocation {
  id: string
  method: PosPaymentMethod
  amountText: string
}

export type PosPaymentAmountParseResult =
  | { status: 'incomplete' | 'invalid' | 'overflow' }
  | { status: 'ready'; amountMinor: number }

export type PosPaymentSummary =
  | { status: 'incomplete' | 'invalid' | 'overflow' }
  | {
      status: 'remaining' | 'exact' | 'overpaid'
      allocatedMinor: number
      targetMinor: number
      differenceMinor: number
    }

function isCurrencyExponent(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 9
}

function isPaymentMethod(value: string): value is PosPaymentMethod {
  return ['cash', 'card', 'transfer', 'other'].includes(value)
}

function parseSafeMinorUnits(value: string): PosPaymentAmountParseResult {
  const parsed = BigInt(value)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return { status: 'overflow' }
  return { status: 'ready', amountMinor: Number(parsed) }
}

function assertUniqueIds(allocations: readonly PosPaymentAllocation[]): Set<string> {
  const ids = new Set<string>()
  for (const allocation of allocations) {
    if (!allocation.id || ids.has(allocation.id)) {
      throw new Error('Payment allocation IDs must be unique.')
    }
    ids.add(allocation.id)
  }
  return ids
}

export function parsePosPaymentAmount(
  amountText: string,
  currencyExponent: number,
): PosPaymentAmountParseResult {
  if (!isCurrencyExponent(currencyExponent)) return { status: 'invalid' }

  const value = amountText.trim()
  if (!value) return { status: 'incomplete' }
  if (/\s/.test(value) || /[^0-9.,]/.test(value)) return { status: 'invalid' }

  const dotCount = [...value].filter((character) => character === '.').length
  const commaCount = [...value].filter((character) => character === ',').length
  if (dotCount + commaCount > 1 || (dotCount > 0 && commaCount > 0)) {
    return { status: 'invalid' }
  }

  const separator = dotCount === 1 ? '.' : commaCount === 1 ? ',' : undefined
  if (currencyExponent === 0) {
    if (separator || !/^\d+$/.test(value)) return { status: 'invalid' }
    return parseSafeMinorUnits(value)
  }

  if (!separator) {
    if (!/^\d+$/.test(value)) return { status: 'invalid' }
    return parseSafeMinorUnits(`${value}${'0'.repeat(currencyExponent)}`)
  }

  const [wholePart, fractionPart] = value.split(separator)
  if (fractionPart === '') return { status: 'incomplete' }
  if (!/^\d*$/.test(wholePart!) || !/^\d+$/.test(fractionPart)) {
    return { status: 'invalid' }
  }
  if (fractionPart.length > currencyExponent) return { status: 'invalid' }

  return parseSafeMinorUnits(
    `${wholePart || '0'}${fractionPart.padEnd(currencyExponent, '0')}`,
  )
}

export function createDefaultPosPaymentAllocations(
  createId: () => string,
): PosPaymentAllocation[] {
  return addPosPaymentAllocation([], createId)
}

export function addPosPaymentAllocation(
  allocations: readonly PosPaymentAllocation[],
  createId: () => string,
): PosPaymentAllocation[] {
  const ids = assertUniqueIds(allocations)
  const id = createId()
  if (!id || ids.has(id)) throw new Error('Payment allocation IDs must be unique.')
  return [...allocations, { id, method: 'cash', amountText: '' }]
}

export function updatePosPaymentAllocationMethod(
  allocations: readonly PosPaymentAllocation[],
  id: string,
  method: PosPaymentMethod,
): PosPaymentAllocation[] {
  if (!isPaymentMethod(method)) throw new Error('Payment method is invalid.')
  return allocations.map((allocation) => allocation.id === id
    ? { ...allocation, method }
    : { ...allocation })
}

export function updatePosPaymentAllocationAmount(
  allocations: readonly PosPaymentAllocation[],
  id: string,
  amountText: string,
): PosPaymentAllocation[] {
  return allocations.map((allocation) => allocation.id === id
    ? { ...allocation, amountText }
    : { ...allocation })
}

export function removePosPaymentAllocation(
  allocations: readonly PosPaymentAllocation[],
  id: string,
): PosPaymentAllocation[] {
  if (allocations.length <= 1) return [...allocations]
  return allocations.filter((allocation) => allocation.id !== id)
}

export function withPosPaymentOrdinals(
  allocations: readonly PosPaymentAllocation[],
): Array<PosPaymentAllocation & { ordinal: number }> {
  return allocations.map((allocation, ordinal) => ({ ...allocation, ordinal }))
}

export function summarizePosPayments(
  allocations: readonly PosPaymentAllocation[],
  targetMinor: number,
  currencyExponent: number,
): PosPaymentSummary {
  if (!Number.isSafeInteger(targetMinor) || targetMinor <= 0) {
    return { status: 'invalid' }
  }

  let allocatedMinor = 0
  let incomplete = false
  for (const allocation of allocations) {
    if (!isPaymentMethod(allocation.method)) return { status: 'invalid' }
    const parsed = parsePosPaymentAmount(allocation.amountText, currencyExponent)
    if (parsed.status !== 'ready') {
      if (parsed.status === 'overflow') return { status: 'overflow' }
      if (parsed.status === 'invalid') return { status: 'invalid' }
      incomplete = true
      continue
    }
    if (parsed.amountMinor === 0) return { status: 'invalid' }
    const nextAllocatedMinor = allocatedMinor + parsed.amountMinor
    if (!Number.isSafeInteger(nextAllocatedMinor)) return { status: 'overflow' }
    allocatedMinor = nextAllocatedMinor
  }

  if (incomplete) return { status: 'incomplete' }
  if (allocatedMinor === targetMinor) {
    return { status: 'exact', allocatedMinor, targetMinor, differenceMinor: 0 }
  }
  if (allocatedMinor < targetMinor) {
    return {
      status: 'remaining',
      allocatedMinor,
      targetMinor,
      differenceMinor: targetMinor - allocatedMinor,
    }
  }
  return {
    status: 'overpaid',
    allocatedMinor,
    targetMinor,
    differenceMinor: allocatedMinor - targetMinor,
  }
}
