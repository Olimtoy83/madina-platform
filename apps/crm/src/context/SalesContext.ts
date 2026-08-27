import { createContext } from 'react'
import type { Sale } from '@madina/core'
import type { CommerceMutationResult } from '../shared/commerceState'

export interface SalesContextValue {
  sales: Sale[]

  addSale: (
    sale: Sale,
  ) => Promise<CommerceMutationResult<Sale>>

  updateSale: (
    saleId: string,
    updates: Partial<Sale>,
  ) => Promise<CommerceMutationResult<Sale>>

  completeSale: (
    saleId: string,
  ) => Promise<CommerceMutationResult<Sale>>

  cancelSale: (
    saleId: string,
  ) => Promise<CommerceMutationResult<Sale>>
}

export const SalesContext =
  createContext<SalesContextValue | null>(null)
