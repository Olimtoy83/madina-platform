import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sale } from '@madina/core'

const mocks = vi.hoisted(() => ({
  cancelSale: vi.fn(),
  completeSale: vi.fn(),
  createSale: vi.fn(),
  reload: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()

  return {
    ...react,
    useCallback: <T,>(callback: T): T => callback,
    useRef: <T,>(value: T) => ({ current: value }),
  }
})

vi.mock('../shared/api/commerceApi', () => ({
  cancelSale: mocks.cancelSale,
  completeSale: mocks.completeSale,
  createSale: mocks.createSale,
  updateSale: vi.fn(),
}))

vi.mock('./useTransactionalState', () => ({
  useTransactionalState: () => ({ reload: mocks.reload }),
}))

import { useSalesMutations } from './useSalesMutations'

const sale: Sale = {
  id: 'sale-1',
  createdAt: new Date('2026-08-29T12:00:00.000Z'),
  updatedAt: new Date('2026-08-29T12:00:00.000Z'),
  saleNumber: 'SAL-0001',
  saleDate: new Date('2026-08-29T12:00:00.000Z'),
  clientName: 'Клиент',
  items: [],
  totalAmount: 0,
  paymentMethod: 'cash',
  status: 'draft',
}

function getMutations() {
  return useSalesMutations()
}

describe('useSalesMutations', () => {
  beforeEach(() => {
    mocks.reload.mockReset()
    mocks.createSale.mockReset()
    mocks.completeSale.mockReset()
    mocks.cancelSale.mockReset()
  })

  it('revalidates the aggregate after confirmed sale mutations without a global sales collection', async () => {
    const response = {
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleDate: sale.saleDate.toISOString(),
    }
    mocks.createSale.mockResolvedValue(response)
    mocks.completeSale.mockResolvedValue({ success: true })
    mocks.cancelSale.mockResolvedValue(response)
    const mutations = getMutations()

    await expect(mutations.addSale(sale)).resolves.toMatchObject({ success: true })
    await expect(mutations.completeSale(sale.id)).resolves.toEqual({ success: true })
    await expect(mutations.cancelSale(sale.id)).resolves.toMatchObject({ success: true })

    expect(mocks.reload).toHaveBeenCalledTimes(3)
  })

  it('does not revalidate when the server rejects a sale mutation', async () => {
    mocks.completeSale.mockRejectedValue(new Error('Недостаточно товара'))
    const mutations = getMutations()

    await expect(mutations.completeSale(sale.id)).resolves.toEqual({
      success: false,
      message: 'Недостаточно товара',
    })

    expect(mocks.reload).not.toHaveBeenCalled()
  })
})
