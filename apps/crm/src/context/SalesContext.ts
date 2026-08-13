import { createContext } from 'react'
import type { Sale } from '../entities/sale'

export interface SalesContextValue {
  sales: Sale[]

  addSale: (sale: Sale) => void

  updateSale: (
    saleId: string,
    updates: Partial<Sale>,
  ) => void

  completeSale: (
    saleId: string,
  ) => {
    success: boolean
    message?: string
  }

  cancelSale: (saleId: string) => void
}

export const SalesContext =
  createContext<SalesContextValue | null>(null)