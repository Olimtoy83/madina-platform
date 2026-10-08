import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RetailTransfers } from './RetailTransfers'
import type { RetailTransfer } from '../../shared/api/retailApi'

const api = vi.hoisted(() => ({ createRetailTransfer:vi.fn(), dispatchRetailTransfer:vi.fn(), getRetailLocations:vi.fn(), getRetailProducts:vi.fn(), getRetailTransfer:vi.fn(), getRetailTransfers:vi.fn(), isRetailInsufficientStockError:vi.fn(), receiveRetailTransfer:vi.fn() }))
const auth = vi.hoisted(() => ({ useAuth:vi.fn() }))
vi.mock('../../shared/api/retailApi', () => api)
vi.mock('../../context/useAuth', () => auth)

const manager = { id:'manager-1',username:'manager',role:'manager' as const }
const reader = { id:'reader-1',username:'reader',role:'viewer' as const }
const warehouse = { id:'w1',code:'WH',name:'Warehouse',type:'central_warehouse',status:'active' } as const
const store = { id:'s1',code:'STORE',name:'Store',type:'store',status:'active' } as const
const draftTransfer: RetailTransfer = { id:'t1',sourceLocationId:'w1',destinationLocationId:'s1',status:'draft',createdAt:'2026-10-01T00:00:00.000Z',createdBy:'manager-1' }
const dispatchedTransfer = { ...draftTransfer,status:'dispatched' as const }
const receivedTransfer = { ...draftTransfer,status:'received' as const }
const detail = (transfer:RetailTransfer=draftTransfer) => ({ transfer,lines:[{ id:'line-1',transferId:transfer.id,productId:'p1',productName:'Tea',productSourceId:'SKU-1',quantity:2 }] })

beforeEach(() => {
  auth.useAuth.mockReturnValue({ user:manager })
  api.getRetailLocations.mockResolvedValue([warehouse,store])
  api.getRetailTransfers.mockResolvedValue({ items:[draftTransfer] })
  api.getRetailTransfer.mockResolvedValue(detail())
  api.getRetailProducts.mockResolvedValue([{ id:'p1',sourceId:'SKU-1',name:'Tea',status:'active' }])
  api.createRetailTransfer.mockResolvedValue(detail({ ...draftTransfer,id:'t-new' }))
  api.dispatchRetailTransfer.mockResolvedValue({ transfer:dispatchedTransfer })
  api.receiveRetailTransfer.mockResolvedValue({ transfer:receivedTransfer })
  api.isRetailInsufficientStockError.mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function openTransfer(user=userEvent.setup()) { await screen.findByRole('button',{name:'Открыть'}); await user.click(screen.getByRole('button',{name:'Открыть'})); return user }

it('loads the journal, opens authoritative immutable lines, and appends the next page', async () => {
  api.getRetailTransfers.mockResolvedValueOnce({ items:[draftTransfer],nextCursor:'cursor-1' }).mockResolvedValueOnce({ items:[{ ...draftTransfer,id:'t2' }] })
  render(<RetailTransfers />)
  await screen.findByText('Warehouse')
  expect(api.getRetailTransfers).toHaveBeenCalledWith('w1',{cursor:undefined})
  const user = await openTransfer(); await screen.findByRole('heading',{name:'Перемещение: Черновик'})
  expect(screen.getByText('Tea')).toBeTruthy(); expect(screen.getByText('SKU-1')).toBeTruthy()
  await user.click(screen.getByRole('button',{name:'Показать ещё'}))
  await waitFor(() => expect(api.getRetailTransfers).toHaveBeenLastCalledWith('w1',{cursor:'cursor-1'}))
})

it('gates management controls by capability while preserving the read journal', async () => {
  auth.useAuth.mockReturnValue({ user:reader })
  render(<RetailTransfers />)
  await screen.findByText('Черновик')
  expect(screen.queryByRole('button',{name:'Новое перемещение'})).toBeNull()
  await openTransfer();
  await screen.findByRole('heading',{name:'Перемещение: Черновик'})
  expect(screen.queryByRole('button',{name:'Отправить перемещение'})).toBeNull()
})

it('creates a draft with unique active products and validated integer quantities', async () => {
  render(<RetailTransfers />); const user=userEvent.setup(); await screen.findByText('Черновик')
  await user.click(screen.getByRole('button',{name:'Новое перемещение'}))
  await user.type(screen.getByLabelText('Найти активный retail-товар'),'Tea')
  await user.click(await screen.findByRole('button',{name:'Tea (SKU-1)'}))
  await user.type(screen.getByLabelText('Найти активный retail-товар'),'Tea')
  await user.click(await screen.findByRole('button',{name:'Tea (SKU-1)'}))
  await screen.findByText('Этот товар уже добавлен в перемещение.')
  const quantity=screen.getByRole('spinbutton'); await user.clear(quantity); await user.type(quantity,'0')
  await user.click(screen.getByRole('button',{name:'Создать черновик'}))
  await screen.findByText('Добавьте хотя бы один товар с положительным целым количеством.')
  await user.clear(quantity); await user.type(quantity,'3')
  await user.click(screen.getByRole('button',{name:'Создать черновик'}))
  await waitFor(() => expect(api.createRetailTransfer).toHaveBeenCalledWith('w1',{ destinationLocationId:'s1',lines:[{productId:'p1',quantity:3}] }))
})

it('rejects an identical source and destination before sending a create request', async () => {
  render(<RetailTransfers />); const user=userEvent.setup(); await screen.findByText('Черновик'); await user.click(screen.getByRole('button',{name:'Новое перемещение'}))
  const selects=screen.getAllByRole('combobox'); await user.selectOptions(selects[2]!,'w1')
  await user.click(screen.getByRole('button',{name:'Создать черновик'}))
  await screen.findByText('Выберите разные активные точки отправки и приёма.')
  expect(api.createRetailTransfer).not.toHaveBeenCalled()
})

it('does not retry an ambiguous create response and offers journal refresh instead', async () => {
  api.createRetailTransfer.mockRejectedValueOnce(new Error('connection lost'))
  render(<RetailTransfers />); const user=userEvent.setup(); await screen.findByText('Черновик'); await user.click(screen.getByRole('button',{name:'Новое перемещение'})); await user.type(screen.getByLabelText('Найти активный retail-товар'),'Tea'); await user.click(await screen.findByRole('button',{name:'Tea (SKU-1)'})); await user.click(screen.getByRole('button',{name:'Создать черновик'}))
  await screen.findByText(/connection lost/)
  expect(api.createRetailTransfer).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button',{name:'Обновить журнал'}))
  await waitFor(() => expect(api.getRetailTransfers).toHaveBeenCalledTimes(2))
})

it('requires dispatch confirmation and keeps dispatch single-flight', async () => {
  let resolve!: (value:{transfer:typeof dispatchedTransfer}) => void
  api.dispatchRetailTransfer.mockReturnValueOnce(new Promise(resolvePromise => { resolve=resolvePromise }))
  api.getRetailTransfer.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail(dispatchedTransfer))
  render(<RetailTransfers />); const user=await openTransfer(); await screen.findByRole('heading',{name:'Перемещение: Черновик'})
  await user.click(screen.getByRole('button',{name:'Отправить перемещение'})); await screen.findByText('Отправить перемещение?')
  const confirm=screen.getByRole('button',{name:'Отправить'}); await user.click(confirm); await user.click(confirm)
  expect(api.dispatchRetailTransfer).toHaveBeenCalledTimes(1)
  resolve({ transfer:dispatchedTransfer })
  await screen.findByRole('heading',{name:'Перемещение: Отправлено'})
})

it('recovers a committed dispatch after response loss by refreshing authoritative detail', async () => {
  api.dispatchRetailTransfer.mockRejectedValueOnce(new Error('connection lost'))
  api.getRetailTransfer.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail(dispatchedTransfer))
  render(<RetailTransfers />); const user=await openTransfer(); await screen.findByRole('heading',{name:'Перемещение: Черновик'}); await user.click(screen.getByRole('button',{name:'Отправить перемещение'})); await user.click(await screen.findByRole('button',{name:'Отправить'}))
  await screen.findByText(/connection lost/)
  await user.click(screen.getByRole('button',{name:'Обновить документ'}))
  await screen.findByRole('heading',{name:'Перемещение: Отправлено'})
  expect(screen.queryByRole('button',{name:'Отправить перемещение'})).toBeNull()
})

it('shows insufficient-stock dispatch conflict without inventing success', async () => {
  api.dispatchRetailTransfer.mockRejectedValueOnce(new Error('stock'))
  api.isRetailInsufficientStockError.mockReturnValue(true)
  render(<RetailTransfers />); const user=await openTransfer(); await screen.findByRole('heading',{name:'Перемещение: Черновик'}); await user.click(screen.getByRole('button',{name:'Отправить перемещение'})); await user.click(await screen.findByRole('button',{name:'Отправить'}))
  await screen.findByText(/Недостаточно остатка/)
  expect(screen.getByRole('heading',{name:'Перемещение: Черновик'})).toBeTruthy()
})

it('requires receive confirmation, remains single-flight, and makes received transfers read-only', async () => {
  api.getRetailTransfers.mockResolvedValue({ items:[dispatchedTransfer] })
  api.getRetailTransfer.mockResolvedValueOnce(detail(dispatchedTransfer)).mockResolvedValueOnce(detail(receivedTransfer))
  let resolve!: (value:{transfer:typeof receivedTransfer}) => void
  api.receiveRetailTransfer.mockReturnValueOnce(new Promise(resolvePromise => { resolve=resolvePromise }))
  render(<RetailTransfers />); const user=await openTransfer(); await screen.findByRole('heading',{name:'Перемещение: Отправлено'}); await user.click(screen.getByRole('button',{name:'Принять перемещение'})); const confirm=await screen.findByRole('button',{name:'Принять'}); await user.click(confirm); await user.click(confirm)
  expect(api.receiveRetailTransfer).toHaveBeenCalledTimes(1); resolve({ transfer:receivedTransfer })
  await screen.findByRole('heading',{name:'Перемещение: Принято'})
  expect(screen.getByText('Перемещение принято и доступно только для чтения.')).toBeTruthy()
  expect(screen.queryByRole('button',{name:'Принять перемещение'})).toBeNull()
})

it('presents forbidden and API errors without a mutation', async () => {
  api.getRetailTransfers.mockRejectedValueOnce(new Error('Forbidden'))
  render(<RetailTransfers />)
  await screen.findByText('Forbidden')
  expect(api.createRetailTransfer).not.toHaveBeenCalled(); expect(api.dispatchRetailTransfer).not.toHaveBeenCalled(); expect(api.receiveRetailTransfer).not.toHaveBeenCalled()
})
