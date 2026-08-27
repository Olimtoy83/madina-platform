import type { ImportCommerceSnapshotRequest } from '@madina/api'
import { importCommerceSnapshot } from '../api/commerceApi'
import {
  loadTransactionalSnapshot,
  type TransactionalSnapshot,
} from '../transactionalStorage'

const MIGRATION_MARKER_KEY =
  'madina-crm:migration:commerce-to-server:v1'

export interface CommerceServerBootstrapResult {
  skipped: boolean
  imported: boolean
  idempotent: boolean
}

function hasMigrationMarker(): boolean {
  try {
    return localStorage.getItem(MIGRATION_MARKER_KEY) === 'done'
  } catch {
    return false
  }
}

function saveMigrationMarker(): void {
  localStorage.setItem(MIGRATION_MARKER_KEY, 'done')
}

function toImportSnapshot(
  snapshot: TransactionalSnapshot,
): ImportCommerceSnapshotRequest {
  return {
    products: snapshot.products.map((product) => ({
      ...product,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    })),
    stockMovements: snapshot.stockMovements.map((movement) => ({
      ...movement,
      createdAt: movement.createdAt.toISOString(),
      updatedAt: movement.updatedAt.toISOString(),
    })),
    purchases: snapshot.purchases.map((purchase) => ({
      ...purchase,
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
      purchaseDate: purchase.purchaseDate.toISOString(),
    })),
    sales: snapshot.sales.map((sale) => ({
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleDate: sale.saleDate.toISOString(),
    })),
    transactions: snapshot.transactions.map((transaction) => ({
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
      updatedAt: transaction.updatedAt.toISOString(),
      transactionDate: transaction.transactionDate.toISOString(),
    })),
  }
}

export async function bootstrapCommerceToServer(): Promise<
  CommerceServerBootstrapResult
> {
  if (hasMigrationMarker()) {
    return {
      skipped: true,
      imported: false,
      idempotent: false,
    }
  }

  const { snapshot } = loadTransactionalSnapshot()
  const response = await importCommerceSnapshot(
    toImportSnapshot(snapshot),
  )

  saveMigrationMarker()

  return {
    skipped: false,
    imported: response.imported,
    idempotent: response.idempotent,
  }
}
