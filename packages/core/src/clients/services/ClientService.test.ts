import { describe, expect, it, vi } from 'vitest'
import type { Client } from '../types/client'
import type { Sale } from '../../sales/types/sale'
import {
  ClientValidationError,
  createClient as createDomainClient,
  deactivateClient,
  getClientSalesStats,
  getCompletedSalesForClient,
  updateClient,
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
  describe('createClient', () => {
    it('creates and normalizes a client', () => {
      const randomUUID = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue(
          '00000000-0000-4000-8000-000000000001',
        )

      try {
        const result = createDomainClient({
          name: '  Ahmad  ',
          phone: '  +966500000000  ',
          email: '  ahmad@example.com  ',
          company: '  Madina  ',
          note: '   ',
          status: 'active',
        })

        expect(result).toMatchObject({
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Ahmad',
          phone: '+966500000000',
          email: 'ahmad@example.com',
          company: 'Madina',
          note: undefined,
          status: 'active',
        })
        expect(result.createdAt).toBeInstanceOf(Date)
        expect(result.updatedAt).toBe(
          result.createdAt,
        )
      } finally {
        randomUUID.mockRestore()
      }
    })

    it('rejects an empty client name', () => {
      const randomUUID = vi.spyOn(
        crypto,
        'randomUUID',
      )

      try {
        expect(() =>
          createDomainClient({
            name: '   ',
            status: 'active',
          }),
        ).toThrow(ClientValidationError)

        expect(randomUUID).not.toHaveBeenCalled()
      } finally {
        randomUUID.mockRestore()
      }
    })
  })

  describe('updateClient', () => {
    it('updates and normalizes editable client fields', () => {
      const client = createClient({
        phone: '+966500000000',
        email: 'old@example.com',
        company: 'Old Company',
        note: 'Old note',
      })

      const result = updateClient(client, {
        name: '  Omar  ',
        phone: '  +966511111111  ',
        email: '   ',
        company: '  New Company  ',
        note: '  New note  ',
        status: 'inactive',
      })

      expect(result).toMatchObject({
        id: client.id,
        name: 'Omar',
        phone: '+966511111111',
        email: undefined,
        company: 'New Company',
        note: 'New note',
        status: 'inactive',
      })
      expect(result.createdAt).toBe(
        client.createdAt,
      )
      expect(result.updatedAt).toBeInstanceOf(Date)
    })

    it('preserves fields that are not updated', () => {
      const client = createClient({
        phone: '+966500000000',
        company: 'Madina',
      })

      const result = updateClient(client, {
        status: 'inactive',
      })

      expect(result).toMatchObject({
        name: client.name,
        phone: client.phone,
        company: client.company,
        status: 'inactive',
      })
    })

    it('rejects an empty updated client name', () => {
      const client = createClient()

      expect(() =>
        updateClient(client, {
          name: '   ',
        }),
      ).toThrow(ClientValidationError)
    })
  })

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
