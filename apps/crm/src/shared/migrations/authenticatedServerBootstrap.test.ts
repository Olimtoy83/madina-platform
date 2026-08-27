import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
  clients: vi.fn(),
  commerce: vi.fn(),
  tasks: vi.fn(),
}))

vi.mock('./clientServerBootstrap', () => ({
  bootstrapClientsToServer: mocks.clients,
}))
vi.mock('./commerceServerBootstrap', () => ({
  bootstrapCommerceToServer: mocks.commerce,
}))
vi.mock('./taskServerBootstrap', () => ({
  bootstrapTasksToServer: mocks.tasks,
}))

import { bootstrapAuthenticatedServerData } from './authenticatedServerBootstrap'

const admin = {
  id: 'admin-1',
  username: 'madina.admin',
  role: 'admin' as const,
}

beforeEach(() => {
  mocks.clients.mockReset().mockResolvedValue({})
  mocks.tasks.mockReset().mockResolvedValue({})
  mocks.commerce.mockReset().mockResolvedValue({})
})

describe('authenticatedServerBootstrap', () => {
  it('runs legacy bridges only for an authenticated admin', async () => {
    await expect(bootstrapAuthenticatedServerData(admin)).resolves.toEqual({
      skipped: false,
    })

    expect(mocks.clients).toHaveBeenCalledOnce()
    expect(mocks.tasks).toHaveBeenCalledOnce()
    expect(mocks.commerce).toHaveBeenCalledOnce()
  })

  it('does not invoke admin-only imports for a non-admin', async () => {
    await expect(bootstrapAuthenticatedServerData({
      ...admin,
      role: 'operator',
    })).resolves.toEqual({
      skipped: true,
    })

    expect(mocks.clients).not.toHaveBeenCalled()
    expect(mocks.tasks).not.toHaveBeenCalled()
    expect(mocks.commerce).not.toHaveBeenCalled()
  })

  it('fails without reporting a completed bootstrap when an import fails', async () => {
    mocks.clients.mockRejectedValue(new Error('Import failed'))

    await expect(bootstrapAuthenticatedServerData(admin)).rejects.toThrow(
      'Import failed',
    )

    expect(mocks.tasks).not.toHaveBeenCalled()
    expect(mocks.commerce).not.toHaveBeenCalled()
  })
})
