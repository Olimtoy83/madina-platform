import { createContext } from 'react'
import type { Purchase } from '@madina/core'

export interface PurchasesContextValue {
  purchases: Purchase[]

  addPurchase: (purchase: Purchase) => void

  updatePurchase: (
    purchaseId: string,
    updates: Partial<Purchase>,
  ) => void

  completePurchase: (
    purchaseId: string,
  ) => {
    success: boolean
    message?: string
  }

  cancelPurchase: (purchaseId: string) => void
}

export const PurchasesContext =
  createContext<PurchasesContextValue | null>(null)
