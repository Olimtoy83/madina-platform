import type { Client } from '../types/client'
import type { Sale } from '../../sales/types/sale'

export interface CreateClientInput {
  name: string
  phone?: string
  email?: string
  company?: string
  note?: string
  status: Client['status']
}

export class ClientValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientValidationError'
  }
}

function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim()

  return normalized || undefined
}

export function createClient(
  input: CreateClientInput,
): Client {
  const name = input.name.trim()

  if (!name) {
    throw new ClientValidationError(
      'Имя клиента обязательно.',
    )
  }

  const now = new Date()

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name,
    phone: normalizeOptionalText(input.phone),
    email: normalizeOptionalText(input.email),
    company: normalizeOptionalText(input.company),
    note: normalizeOptionalText(input.note),
    status: input.status,
  }
}

export function deactivateClient(
  client: Client,
): Client {
  return {
    ...client,
    status: 'inactive',
    updatedAt: new Date(),
  }
}

export interface ClientSalesStats {
  salesCount: number
  totalAmount: number
  lastSaleDate?: Date
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export function getCompletedSalesForClient(
  client: Client,
  sales: Sale[],
): Sale[] {
  return sales
    .filter(
      (sale) =>
        sale.status === 'completed' &&
        (
          sale.clientId === client.id ||
          (
            !sale.clientId &&
            normalizeName(sale.clientName) ===
              normalizeName(client.name)
          )
        ),
    )
    .sort(
      (a, b) =>
        b.saleDate.getTime() -
        a.saleDate.getTime(),
    )
}

export function getClientSalesStats(
  client: Client,
  sales: Sale[],
): ClientSalesStats {
  const completedSales =
    getCompletedSalesForClient(
      client,
      sales,
    )

  return {
    salesCount: completedSales.length,
    totalAmount: completedSales.reduce(
      (sum, sale) =>
        sum + sale.totalAmount,
      0,
    ),
    lastSaleDate:
      completedSales[0]?.saleDate,
  }
}
