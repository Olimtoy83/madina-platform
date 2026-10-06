import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RetailGoodsReceipts } from './RetailGoodsReceipts'

const api = vi.hoisted(() => ({ getRetailLocations: vi.fn(), getRetailGoodsReceipts: vi.fn(), getRetailGoodsReceipt: vi.fn(), getRetailProducts: vi.fn(), completeRetailGoodsReceipt: vi.fn(), createRetailGoodsReceipt: vi.fn(), updateRetailGoodsReceipt: vi.fn() }))
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }))
vi.mock('../../shared/api/retailApi', () => api)
vi.mock('../../context/useAuth', () => auth)

const manager = { id: 'manager-1', username: 'manager', role: 'manager' as const }
const reader = { id: 'reader-1', username: 'reader', role: 'viewer' as const }
const warehouse = { id: 'w1', code: 'WH', name: 'Warehouse', type: 'central_warehouse', status: 'active' } as const
const draft = { goodsReceipt: { id: 'r1', receiptReference: 'GR-1', status: 'draft' }, lines: [] }
const completed = { goodsReceipt: { id: 'r1', receiptReference: 'GR-1', status: 'completed' }, lines: [] }

beforeEach(() => {
  auth.useAuth.mockReturnValue({ user: manager })
  api.getRetailLocations.mockResolvedValue([warehouse])
  api.getRetailGoodsReceipts.mockResolvedValue({ items: [{ id: 'r1', receiptReference: 'GR-1', status: 'draft', createdAt: '2026-01-01T00:00:00.000Z' }] })
  api.getRetailGoodsReceipt.mockResolvedValue(draft)
  api.getRetailProducts.mockResolvedValue([{ id: 'p2', sourceId: 'SKU-2', name: 'Tea', status: 'active' }])
  api.updateRetailGoodsReceipt.mockResolvedValue(draft)
  api.completeRetailGoodsReceipt.mockResolvedValue(completed)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function openDraft(user = userEvent.setup()) {
  await screen.findByText('GR-1')
  await user.click(screen.getByRole('button', { name: 'Открыть' }))
  await screen.findByText('Черновик поступления')
  return user
}

it('edits an existing draft with the selected product and quantity on the same receipt', async () => {
  render(<RetailGoodsReceipts />)
  const user = await openDraft()
  await user.type(screen.getByLabelText('Найти активный retail-товар'), 'Tea')
  await screen.findByRole('button', { name: 'Tea (SKU-2)' })
  await user.click(screen.getByRole('button', { name: 'Tea (SKU-2)' }))
  await user.clear(screen.getByRole('spinbutton'))
  await user.type(screen.getByRole('spinbutton'), '4')
  await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
  await waitFor(() => expect(api.updateRetailGoodsReceipt).toHaveBeenCalledWith('w1', 'r1', { supplierReference: undefined, shipmentReference: undefined, notes: undefined, lines: [{ productId: 'p2', quantity: 4 }] }))
  expect(api.createRetailGoodsReceipt).not.toHaveBeenCalled()
  expect(screen.getByText('Черновик поступления')).toBeTruthy()
})

it('opens a new draft and creates it at the authorized warehouse', async () => {
  api.createRetailGoodsReceipt.mockResolvedValue({ goodsReceipt: { id: 'r2', receiptReference: 'GR-NEW', status: 'draft' }, lines: [{ productId: 'p2', quantity: 1 }] })
  render(<RetailGoodsReceipts />)
  const user = userEvent.setup()
  await screen.findByText('GR-1')
  await user.click(screen.getByRole('button', { name: 'Новое поступление' }))
  await screen.findByText('Черновик поступления')
  await user.type(screen.getByLabelText('Номер поступления'), 'GR-NEW')
  await user.type(screen.getByLabelText('Найти активный retail-товар'), 'Tea')
  await user.click(await screen.findByRole('button', { name: 'Tea (SKU-2)' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
  await waitFor(() => expect(api.createRetailGoodsReceipt).toHaveBeenCalledWith('w1', { receiptReference: 'GR-NEW', supplierReference: undefined, shipmentReference: undefined, notes: undefined, lines: [{ productId: 'p2', quantity: 1 }] }))
})

it('keeps the same draft available after a validation conflict so it can be retried', async () => {
  api.updateRetailGoodsReceipt.mockRejectedValueOnce(new Error('validation conflict'))
  render(<RetailGoodsReceipts />)
  const user = await openDraft()
  await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
  await screen.findByText('validation conflict')
  expect(screen.getByText('Черновик поступления')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
  await waitFor(() => expect(api.updateRetailGoodsReceipt).toHaveBeenCalledTimes(2))
  expect(api.updateRetailGoodsReceipt.mock.calls.every(([locationId, receiptId]) => locationId === 'w1' && receiptId === 'r1')).toBe(true)
  expect(api.createRetailGoodsReceipt).not.toHaveBeenCalled()
})

it('retries ambiguous completion for the same receipt and prevents synchronous duplicates', async () => {
  api.completeRetailGoodsReceipt.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(completed)
  render(<RetailGoodsReceipts />)
  const user = await openDraft()
  await user.click(screen.getByRole('button', { name: 'Завершить поступление' }))
  await screen.findByText(/connection lost/)
  const complete = screen.getByRole('button', { name: 'Завершить поступление' })
  await user.click(complete)
  await user.click(complete)
  await screen.findByText('Документ завершён и не редактируется.')
  expect(api.completeRetailGoodsReceipt).toHaveBeenCalledTimes(2)
  expect(api.completeRetailGoodsReceipt.mock.calls).toEqual([['w1', 'r1'], ['w1', 'r1']])
  expect(api.createRetailGoodsReceipt).not.toHaveBeenCalled()
})

it('keeps receipt reading available but hides management controls from read-only users', async () => {
  auth.useAuth.mockReturnValue({ user: reader })
  render(<RetailGoodsReceipts />)
  await openDraft()
  expect(screen.queryByRole('button', { name: 'Новое поступление' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Сохранить черновик' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Завершить поступление' })).toBeNull()
  expect(screen.queryByLabelText('Найти активный retail-товар')).toBeNull()
})
