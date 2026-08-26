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

export type UpdateClientInput =
  Partial<CreateClientInput>

export function updateClient(
  client: Client,
  updates: UpdateClientInput,
): Client {
  const nextClient: Client = {
    ...client,
    updatedAt: new Date(),
  }

  if (Object.hasOwn(updates, 'name')) {
    const name = updates.name?.trim()

    if (!name) {
      throw new ClientValidationError(
        'Имя клиента обязательно.',
      )
    }

    nextClient.name = name
  }

  if (Object.hasOwn(updates, 'phone')) {
    nextClient.phone =
      normalizeOptionalText(updates.phone)
  }

  if (Object.hasOwn(updates, 'email')) {
    nextClient.email =
      normalizeOptionalText(updates.email)
  }

  if (Object.hasOwn(updates, 'company')) {
    nextClient.company =
      normalizeOptionalText(updates.company)
  }

  if (Object.hasOwn(updates, 'note')) {
    nextClient.note =
      normalizeOptionalText(updates.note)
  }

  if (
    Object.hasOwn(updates, 'status') &&
    updates.status !== undefined
  ) {
    nextClient.status = updates.status
  }

  return nextClient
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
