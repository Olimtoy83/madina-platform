import { describe, expect, it } from 'vitest'
import {
  addPosPaymentAllocation,
  createDefaultPosPaymentAllocations,
  parsePosPaymentAmount,
  removePosPaymentAllocation,
  summarizePosPayments,
  updatePosPaymentAllocationAmount,
  updatePosPaymentAllocationMethod,
  withPosPaymentOrdinals,
  type PosPaymentAllocation,
} from './retailPosPayments'

function sequentialIds(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++]!
}

const allocation: PosPaymentAllocation = {
  id: 'payment-1',
  method: 'cash',
  amountText: '123.45',
}

describe('retail POS payment amounts', () => {
  it.each([
    ['123', 2, 12300],
    ['123.4', 2, 12340],
    ['123.45', 2, 12345],
    ['123,4', 2, 12340],
    ['123,45', 2, 12345],
    ['  123.45  ', 2, 12345],
    ['.5', 2, 50],
    [',5', 2, 50],
    ['123', 0, 123],
    ['1.234', 3, 1234],
    ['9007199254740991', 0, Number.MAX_SAFE_INTEGER],
  ])('parses %s at exponent %i exactly', (text, exponent, amountMinor) => {
    expect(parsePosPaymentAmount(text, exponent)).toEqual({ status: 'ready', amountMinor })
  })

  it.each(['', '   ', '123.', '123,', '.'])('treats %j as incomplete', (text) => {
    expect(parsePosPaymentAmount(text, 2)).toEqual({ status: 'incomplete' })
  })

  it.each([
    ['-1', 2],
    ['1 2', 2],
    ['abc', 2],
    ['1.2.3', 2],
    ['1,2,3', 2],
    ['1,2.3', 2],
    ['1.234', 2],
    ['1.0', 0],
  ])('rejects invalid amount text %s', (text, exponent) => {
    expect(parsePosPaymentAmount(text, exponent)).toEqual({ status: 'invalid' })
  })

  it('parses zero while payment validation later rejects it', () => {
    expect(parsePosPaymentAmount('0.00', 2)).toEqual({ status: 'ready', amountMinor: 0 })
  })

  it('rejects amount overflow without number decimal arithmetic', () => {
    expect(parsePosPaymentAmount('9007199254740992', 0)).toEqual({ status: 'overflow' })
    expect(parsePosPaymentAmount('90071992547409.92', 2)).toEqual({ status: 'overflow' })
  })
})

describe('retail POS payment allocations', () => {
  it('creates a deterministic default cash allocation', () => {
    expect(createDefaultPosPaymentAllocations(sequentialIds('payment-1'))).toEqual([{
      id: 'payment-1',
      method: 'cash',
      amountText: '',
    }])
  })

  it('keeps IDs stable while method and amount text are edited', () => {
    const methodChanged = updatePosPaymentAllocationMethod([allocation], 'payment-1', 'card')
    const amountChanged = updatePosPaymentAllocationAmount(methodChanged, 'payment-1', '5,00')

    expect(amountChanged).toEqual([{ id: 'payment-1', method: 'card', amountText: '5,00' }])
  })

  it.each(['cash', 'card', 'transfer', 'other'] as const)(
    'supports the %s payment method without changing the allocation ID',
    (method) => {
      expect(updatePosPaymentAllocationMethod([allocation], 'payment-1', method)).toEqual([{
        ...allocation,
        method,
      }])
    },
  )

  it('adds separate allocations, including duplicate methods, with unique IDs', () => {
    const added = addPosPaymentAllocation([allocation], sequentialIds('payment-2'))
    const duplicateMethod = updatePosPaymentAllocationMethod(added, 'payment-2', 'cash')

    expect(duplicateMethod.map((item) => item.method)).toEqual(['cash', 'cash'])
    expect(new Set(duplicateMethod.map((item) => item.id)).size).toBe(2)
  })

  it('rejects duplicate generated IDs and does not remove the final allocation', () => {
    expect(() => addPosPaymentAllocation([allocation], () => 'payment-1')).toThrow(
      'Payment allocation IDs must be unique.',
    )
    expect(removePosPaymentAllocation([allocation], 'payment-1')).toEqual([allocation])
  })

  it('derives contiguous ordinals and compacts them after removal', () => {
    const allocations = [
      allocation,
      { id: 'payment-2', method: 'card' as const, amountText: '1.00' },
      { id: 'payment-3', method: 'cash' as const, amountText: '2.00' },
    ]

    expect(withPosPaymentOrdinals(allocations).map(({ id, ordinal }) => [id, ordinal])).toEqual([
      ['payment-1', 0], ['payment-2', 1], ['payment-3', 2],
    ])
    expect(withPosPaymentOrdinals(removePosPaymentAllocation(allocations, 'payment-2'))
      .map(({ id, ordinal }) => [id, ordinal])).toEqual([
        ['payment-1', 0], ['payment-3', 1],
      ])
  })
})

describe('retail POS payment summaries', () => {
  it('reports incomplete, invalid, remaining, exact, and overpaid states', () => {
    expect(summarizePosPayments([{ ...allocation, amountText: '' }], 12345, 2))
      .toEqual({ status: 'incomplete' })
    expect(summarizePosPayments([{ ...allocation, amountText: '0' }], 12345, 2))
      .toEqual({ status: 'invalid' })
    expect(summarizePosPayments([{ ...allocation, amountText: '100' }], 12345, 2))
      .toEqual({ status: 'remaining', allocatedMinor: 10000, targetMinor: 12345, differenceMinor: 2345 })
    expect(summarizePosPayments([allocation], 12345, 2))
      .toEqual({ status: 'exact', allocatedMinor: 12345, targetMinor: 12345, differenceMinor: 0 })
    expect(summarizePosPayments([{ ...allocation, amountText: '124' }], 12345, 2))
      .toEqual({ status: 'overpaid', allocatedMinor: 12400, targetMinor: 12345, differenceMinor: 55 })
  })

  it('rejects parsed and checked-addition overflow without partial totals', () => {
    expect(summarizePosPayments([{ ...allocation, amountText: '9007199254740992' }], 1, 0))
      .toEqual({ status: 'overflow' })
    expect(summarizePosPayments([
      { ...allocation, amountText: '9007199254740991' },
      { id: 'payment-2', method: 'card', amountText: '1' },
    ], 1, 0)).toEqual({ status: 'overflow' })
    expect(summarizePosPayments([allocation], Number.MAX_SAFE_INTEGER + 1, 2))
      .toEqual({ status: 'invalid' })
  })
})
