import { createContext } from 'react'
import type { Purchase } from '@madina/core'
import type { CommerceMutationResult } from '../shared/commerceState'

export interface PurchasesContextValue {
  purchases: Purchase[]

  addPurchase: (
    purchase: Purchase,
  ) => Promise<CommerceMutationResult<Purchase>>

  updatePurchase: (
    purchaseId: string,
    updates: Partial<Purchase>,
  ) => Promise<CommerceMutationResult<Purchase>>

  completePurchase: (
    purchaseId: string,
  ) => Promise<CommerceMutationResult<Purchase>>

  cancelPurchase: (
    purchaseId: string,
  ) => Promise<CommerceMutationResult<Purchase>>
}

export const PurchasesContext =
  createContext<PurchasesContextValue | null>(null)
