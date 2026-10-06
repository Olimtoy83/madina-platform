import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RetailSalesJournal } from './RetailSalesJournal'

const api = vi.hoisted(() => ({ getRetailCompletedSales: vi.fn(), getRetailLocations: vi.fn() }))
vi.mock('../../shared/api/retailApi', () => api)

beforeEach(() => {
  api.getRetailLocations.mockResolvedValue([{ id: 'store-1', code: 'STORE', name: 'Store', type: 'store', status: 'active' }])
  api.getRetailCompletedSales.mockResolvedValue({ items: [{ id: 'sale-1', locationId: 'store-1', currencyCode: 'USD', currencyExponent: 2, payableTotalMinor: 100, completedAt: '2026-10-01T00:00:00.000Z', paymentMethods: ['cash', 'card', 'transfer', 'other', 'voucher'], hasReturns: false }] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders localized payment methods in the Sales Journal', async () => {
  render(<MemoryRouter><RetailSalesJournal /></MemoryRouter>)
  expect(await screen.findByText('Наличные, Карта, Перевод, Другое, Неизвестный способ (voucher)')).toBeTruthy()
})
