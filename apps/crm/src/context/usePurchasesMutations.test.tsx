import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Purchase } from '@madina/core'

const mocks = vi.hoisted(() => ({
  cancelPurchase: vi.fn(),
  completePurchase: vi.fn(),
  createPurchase: vi.fn(),
  reload: vi.fn(),
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
  useTransactionalState: () => ({ reload: mocks.reload }),
}))

import { usePurchasesMutations } from './usePurchasesMutations'

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

function getMutations() {
  return usePurchasesMutations()
}

describe('usePurchasesMutations', () => {
  beforeEach(() => {
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
    const mutations = getMutations()

    await expect(mutations.addPurchase(purchase)).resolves.toMatchObject({ success: true })
    await expect(mutations.completePurchase(purchase.id)).resolves.toEqual({ success: true })
    await expect(mutations.cancelPurchase(purchase.id)).resolves.toMatchObject({ success: true })

    expect(mocks.reload).toHaveBeenCalledTimes(3)
  })

  it('does not revalidate confirmed state when the server rejects a purchase completion', async () => {
    mocks.completePurchase.mockRejectedValue(new Error('Недостаточно товара'))
    const mutations = getMutations()

    await expect(mutations.completePurchase(purchase.id)).resolves.toEqual({
      success: false,
      message: 'Недостаточно товара',
    })

    expect(mocks.reload).not.toHaveBeenCalled()
  })
})
