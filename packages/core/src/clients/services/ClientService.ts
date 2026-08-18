import type { Client } from '../types/client'
import type { Sale } from '../../sales/types/sale'

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
