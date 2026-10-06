import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RetailSaleDetail } from './RetailSaleDetail'

const api = vi.hoisted(() => ({ getRetailCompletedSale: vi.fn() }))
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }))
vi.mock('../../shared/api/retailApi', () => api)
vi.mock('../../context/useAuth', () => auth)

beforeEach(() => {
  auth.useAuth.mockReturnValue({ user: { id: 'manager-1', username: 'manager', role: 'manager' } })
  api.getRetailCompletedSale.mockResolvedValue({
    sale: { id: 'sale-1', location_id: 'location-uuid', location_name: 'SABONO UAT Store', location_code: 'SABONO-UAT', status: 'completed', currency_code: 'USD', currency_exponent: 2, payable_total_minor: 100, completed_at: '2026-09-19T00:00:00.000Z' },
    items: [], paymentAllocations: [
      { id: 'payment-cash', method: 'cash', amount_minor: 25, ordinal: 0, already_refunded_amount_minor: 0 },
      { id: 'payment-card', method: 'card', amount_minor: 25, ordinal: 1, already_refunded_amount_minor: 0 },
      { id: 'payment-transfer', method: 'transfer', amount_minor: 25, ordinal: 2, already_refunded_amount_minor: 0 },
      { id: 'payment-other', method: 'other', amount_minor: 25, ordinal: 3, already_refunded_amount_minor: 0 },
      { id: 'payment-unknown', method: 'voucher', amount_minor: 0, ordinal: 4, already_refunded_amount_minor: 0 },
    ],
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders current location display identity instead of the raw location UUID', async () => {
  render(<MemoryRouter initialEntries={['/retail/sales/sale-1?locationId=location-uuid']}><Routes><Route path="/retail/sales/:saleId" element={<RetailSaleDetail />} /></Routes></MemoryRouter>)
  expect(await screen.findByText((_, element) => element?.textContent === 'Торговая точка: SABONO UAT Store (SABONO-UAT)')).toBeTruthy()
  expect(screen.queryByText('location-uuid')).toBeNull()
})

it('renders localized payment methods and keeps an unknown method visible', async () => {
  render(<MemoryRouter initialEntries={['/retail/sales/sale-1?locationId=location-uuid']}><Routes><Route path="/retail/sales/:saleId" element={<RetailSaleDetail />} /></Routes></MemoryRouter>)
  await screen.findByText('Наличные')
  expect(screen.getByText('Карта')).toBeTruthy()
  expect(screen.getByText('Перевод')).toBeTruthy()
  expect(screen.getByText('Другое')).toBeTruthy()
  expect(screen.getByText('Неизвестный способ (voucher)')).toBeTruthy()
})
