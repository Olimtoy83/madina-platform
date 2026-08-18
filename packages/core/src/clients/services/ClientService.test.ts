import { describe, expect, it } from 'vitest'
import type { Client } from '../types/client'
import type { Sale } from '../../sales/types/sale'
import {
  deactivateClient,
  getClientSalesStats,
  getCompletedSalesForClient,
} from './ClientService'

function createClient(
  overrides: Partial<Client> = {},
): Client {
  const now = new Date('2026-08-16T12:00:00')

  return {
    id: 'client-1',
    createdAt: now,
    updatedAt: now,
    name: 'Ahmad',
    status: 'active',
    ...overrides,
  }
}

function createSale(
  overrides: Partial<Sale> = {},
): Sale {
  const now = new Date('2026-08-16T12:00:00')

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    saleNumber: 'SALE-001',
    saleDate: now,
    clientName: 'Ahmad',
    items: [],
    totalAmount: 100,
    paymentMethod: 'cash',
    status: 'completed',
    ...overrides,
  }
}

describe('ClientService', () => {
  it('deactivates a client without changing its identity or sale snapshots', () => {
    const client = createClient()
    const sale = createSale({
      clientId: client.id,
      clientName: client.name,
    })

    const result = deactivateClient(client)

    expect(result).toMatchObject({
      id: client.id,
      status: 'inactive',
    })
    expect(result.createdAt).toBe(client.createdAt)
    expect(sale).toMatchObject({
      clientId: client.id,
      clientName: client.name,
    })
  })

  describe('getCompletedSalesForClient', () => {
    it('returns completed sales linked by clientId', () => {
      const client = createClient()

      const sales = [
        createSale({
          clientId: 'client-1',
        }),
        createSale({
          clientId: 'client-2',
        }),
      ]

      const result =
        getCompletedSalesForClient(
          client,
          sales,
        )

      expect(result).toHaveLength(1)
      expect(result[0].clientId).toBe(
        'client-1',
      )
    })

    it('matches a sale without clientId by normalized client name', () => {
      const client = createClient({
        name: '  Ahmad  ',
      })

      const sales = [
        createSale({
          clientId: undefined,
          clientName: ' ahmad ',
        }),
      ]

      const result =
        getCompletedSalesForClient(
          client,
          sales,
        )

      expect(result).toHaveLength(1)
    })

    it('does not match different client names', () => {
      const client = createClient({
        name: 'Ahmad',
      })

      const sales = [
        createSale({
          clientId: undefined,
          clientName: 'Omar',
        }),
      ]

      const result =
        getCompletedSalesForClient(
          client,
          sales,
        )

      expect(result).toHaveLength(0)
    })

    it('ignores non-completed sales', () => {
      const client = createClient()

      const sales = [
        createSale({
          status: 'draft',
          clientId: 'client-1',
        }),
        createSale({
          status: 'cancelled',
          clientId: 'client-1',
        }),
      ]

      const result =
        getCompletedSalesForClient(
          client,
          sales,
        )

      expect(result).toHaveLength(0)
    })

    it('sorts sales by newest sale date first', () => {
      const client = createClient()

      const older = createSale({
        clientId: 'client-1',
        saleDate: new Date(
          '2026-08-10T12:00:00',
        ),
      })

      const newer = createSale({
        clientId: 'client-1',
        saleDate: new Date(
          '2026-08-15T12:00:00',
        ),
      })

      const result =
        getCompletedSalesForClient(
          client,
          [older, newer],
        )

      expect(result[0].id).toBe(newer.id)
      expect(result[1].id).toBe(older.id)
    })
  })

  describe('getClientSalesStats', () => {
    it('calculates sales count, total amount and last sale date', () => {
      const client = createClient()

      const older = createSale({
        clientId: 'client-1',
        totalAmount: 100,
        saleDate: new Date(
          '2026-08-10T12:00:00',
        ),
      })

      const newer = createSale({
        clientId: 'client-1',
        totalAmount: 250,
        saleDate: new Date(
          '2026-08-15T12:00:00',
        ),
      })

      const result =
        getClientSalesStats(
          client,
          [older, newer],
        )

      expect(result.salesCount).toBe(2)
      expect(result.totalAmount).toBe(350)
      expect(result.lastSaleDate).toEqual(
        newer.saleDate,
      )
    })

    it('returns empty statistics when client has no completed sales', () => {
      const client = createClient()

      const result =
        getClientSalesStats(
          client,
          [],
        )

      expect(result).toEqual({
        salesCount: 0,
        totalAmount: 0,
        lastSaleDate: undefined,
      })
    })
  })
})
