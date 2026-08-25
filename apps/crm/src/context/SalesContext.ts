import { createContext } from 'react'
import type { Sale } from '@madina/core'

export interface SalesContextValue {
  sales: Sale[]

  addSale: (
    sale: Sale,
  ) => {
    success: boolean
    message?: string
  }

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

  cancelSale: (
    saleId: string,
  ) => {
    success: boolean
    message?: string
  }
}

export const SalesContext =
  createContext<SalesContextValue | null>(null)
