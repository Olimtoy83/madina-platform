import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RetailInventory } from './RetailInventory'

const api = vi.hoisted(() => ({ getRetailLocations: vi.fn(), getRetailInventory: vi.fn(), getRetailMovementHistory: vi.fn() }))
vi.mock('../../shared/api/retailApi', () => api)

const location = { id: 'location-1', code: 'STORE', name: 'Store', type: 'store', status: 'active' } as const
const inventory = (item: Record<string, unknown>) => ({ items: [{ productId: 'product-1', sourceId: 'SKU-1', name: 'Zero product', barcodes: ['BAR-1'], locationId: location.id, onHandQuantity: 0, ...item }], nextCursor: undefined })

beforeEach(() => {
  api.getRetailLocations.mockResolvedValue([location])
  api.getRetailInventory.mockResolvedValue(inventory({}))
  api.getRetailMovementHistory.mockResolvedValue({ balance: { onHandQuantity: 0 }, movements: [{ id: 'm-1', createdAt: '2026-10-01T00:00:00.000Z', type: 'opening', quantityDelta: 2, sourceLabel: 'Opening stock' }] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders authoritative non-zero stock and opens movement history', async () => {
  api.getRetailInventory.mockResolvedValue(inventory({ onHandQuantity: 7 }))
  render(<RetailInventory />)
  await screen.findByText('Zero product (SKU-1)')
  expect(screen.getByText('7')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Движения' }))
  await waitFor(() => expect(screen.getByText('Opening stock')).toBeTruthy())
  expect(screen.getByText('+2')).toBeTruthy()
})

it('uses the production search control for source identity and barcode searches', async () => {
  const user = userEvent.setup()
  render(<RetailInventory />)
  await screen.findByText('Zero product (SKU-1)')
  const search = screen.getByLabelText('Поиск товара или штрихкода')
  await user.type(search, 'SKU-2')
  await user.click(screen.getByRole('button', { name: 'Найти' }))
  await waitFor(() => expect(api.getRetailInventory).toHaveBeenLastCalledWith('location-1', { search: 'SKU-2', cursor: undefined }))
  api.getRetailInventory.mockResolvedValueOnce(inventory({ name: 'Barcode product', barcodes: ['460123'] }))
  await user.clear(search)
  await user.type(search, '460123')
  await user.click(screen.getByRole('button', { name: 'Найти' }))
  await waitFor(() => expect(api.getRetailInventory).toHaveBeenLastCalledWith('location-1', { search: '460123', cursor: undefined }))
  await screen.findByText('Barcode product (SKU-1)')
})

it('presents inventory read errors without invoking a business mutation', async () => {
  api.getRetailInventory.mockRejectedValueOnce(new Error('inventory unavailable'))
  render(<RetailInventory />)
  await screen.findByText('inventory unavailable')
  expect(api.getRetailMovementHistory).not.toHaveBeenCalled()
})

it('presents movement read errors while keeping the inventory list usable', async () => {
  const user = userEvent.setup()
  api.getRetailMovementHistory.mockRejectedValueOnce(new Error('movement unavailable'))
  render(<RetailInventory />)
  await screen.findByText('Zero product (SKU-1)')
  await user.click(screen.getByRole('button', { name: 'Движения' }))
  await screen.findByText('movement unavailable')
  expect(screen.getByText('Zero product (SKU-1)')).toBeTruthy()
})
