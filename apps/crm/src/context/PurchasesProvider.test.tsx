import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Purchase } from '@madina/core'
import type { CommerceAggregateState } from '../shared/commerceState'
import type { PurchasesContextValue } from './PurchasesContext'

const mocks = vi.hoisted(() => ({
  cancelPurchase: vi.fn(),
  completePurchase: vi.fn(),
  createPurchase: vi.fn(),
  reload: vi.fn(),
  snapshot: {} as CommerceAggregateState,
  updatePurchase: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useCallback: <T,>(callback: T): T => callback,
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
  }
})

vi.mock('../shared/api/commerceApi', () => ({
  cancelPurchase: mocks.cancelPurchase,
  completePurchase: mocks.completePurchase,
  createPurchase: mocks.createPurchase,
  updatePurchase: mocks.updatePurchase,
}))

vi.mock('./useTransactionalState', () => ({
  useTransactionalState: () => ({ snapshot: mocks.snapshot, reload: mocks.reload }),
}))

import { PurchasesProvider } from './PurchasesProvider'

const purchase: Purchase = {
  id: 'purchase-1',
  createdAt: new Date('2026-08-29T12:00:00.000Z'),
  updatedAt: new Date('2026-08-29T12:00:00.000Z'),
  purchaseNumber: 'PUR-0001',
  purchaseDate: new Date('2026-08-28T21:00:00.000Z'),
  supplierName: 'Supplier',
  items: [],
  totalAmount: 0,
  paymentMethod: 'cash',
  status: 'draft',
}

function getContextValue(): PurchasesContextValue {
  const element = PurchasesProvider({ children: null }) as unknown as {
    props: { value: PurchasesContextValue }
  }
  return element.props.value
}

describe('PurchasesProvider', () => {
  beforeEach(() => {
    mocks.snapshot = { products: [], purchases: [purchase] }
    mocks.reload.mockReset()
    mocks.createPurchase.mockReset()
    mocks.completePurchase.mockReset()
    mocks.cancelPurchase.mockReset()
  })

  it('revalidates the aggregate after confirmed purchase mutations', async () => {
    const response = {
      ...purchase,
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
      purchaseDate: purchase.purchaseDate.toISOString(),
    }
    mocks.createPurchase.mockResolvedValue(response)
    mocks.completePurchase.mockResolvedValue({ success: true })
    mocks.cancelPurchase.mockResolvedValue(response)
    const context = getContextValue()

    await expect(context.addPurchase(purchase)).resolves.toMatchObject({ success: true })
    await expect(context.completePurchase(purchase.id)).resolves.toEqual({ success: true })
    await expect(context.cancelPurchase(purchase.id)).resolves.toMatchObject({ success: true })

    expect(mocks.reload).toHaveBeenCalledTimes(3)
  })

  it('does not revalidate confirmed state when the server rejects a purchase completion', async () => {
    mocks.completePurchase.mockRejectedValue(new Error('Недостаточно товара'))
    const context = getContextValue()

    await expect(context.completePurchase(purchase.id)).resolves.toEqual({
      success: false,
      message: 'Недостаточно товара',
    })

    expect(mocks.reload).not.toHaveBeenCalled()
  })
})
