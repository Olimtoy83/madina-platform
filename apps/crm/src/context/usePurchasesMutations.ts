import { useCallback, useRef } from 'react'
import type { Purchase } from '@madina/core'
import {
  cancelPurchase as cancelPurchaseApi,
  completePurchase as completePurchaseApi,
  createPurchase as createPurchaseApi,
  updatePurchase as updatePurchaseApi,
} from '../shared/api/commerceApi'
import {
  toCommerceMutationFailure,
  type CommerceMutationResult,
} from '../shared/commerceState'
import { useTransactionalState } from './useTransactionalState'

export function usePurchasesMutations() {
  const { reload } = useTransactionalState()
  const completionGuard = useRef(createCompletionGuard())

  const addPurchase = useCallback(async (
    purchase: Purchase,
  ): Promise<CommerceMutationResult<Purchase>> => {
    try {
      const savedPurchase = await createPurchaseApi({
        purchaseNumber: purchase.purchaseNumber,
        purchaseDate: purchase.purchaseDate.toISOString(),
        supplierName: purchase.supplierName,
        items: purchase.items,
        paymentMethod: purchase.paymentMethod,
        note: purchase.note,
      })
      await reload()
      return { success: true, value: toPurchase(savedPurchase) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const updatePurchase = useCallback(async (
    purchaseId: string,
    updates: Partial<Purchase>,
  ): Promise<CommerceMutationResult<Purchase>> => {
    try {
      const savedPurchase = await updatePurchaseApi(purchaseId, {
        purchaseDate: updates.purchaseDate?.toISOString(),
        supplierName: updates.supplierName,
        items: updates.items,
        paymentMethod: updates.paymentMethod,
        note: updates.note,
      })
      await reload()
      return { success: true, value: toPurchase(savedPurchase) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const completePurchase = useCallback(async (
    purchaseId: string,
  ): Promise<CommerceMutationResult<Purchase>> => {
    if (!completionGuard.current.begin(purchaseId)) {
      return { success: false, message: 'Завершение поступления уже выполняется.' }
    }
    try {
      const result = await completePurchaseApi(purchaseId)
      if (!result.success) return { success: false, message: result.message }
      await reload()
      return { success: true }
    } catch (error) {
      return toCommerceMutationFailure(error)
    } finally {
      completionGuard.current.finish(purchaseId)
    }
  }, [reload])

  const cancelPurchase = useCallback(async (
    purchaseId: string,
  ): Promise<CommerceMutationResult<Purchase>> => {
    try {
      const savedPurchase = await cancelPurchaseApi(purchaseId)
      await reload()
      return { success: true, value: toPurchase(savedPurchase) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  return { addPurchase, updatePurchase, completePurchase, cancelPurchase }
}

function createCompletionGuard() {
  const activeIds = new Set<string>()
  return {
    begin(id: string) {
      if (activeIds.has(id)) return false
      activeIds.add(id)
      return true
    },
    finish(id: string) {
      activeIds.delete(id)
    },
  }
}

function toPurchase(response: {
  createdAt: string
  updatedAt: string
  purchaseDate: string
} & Omit<Purchase, 'createdAt' | 'updatedAt' | 'purchaseDate'>): Purchase {
  return {
    ...response,
    createdAt: new Date(response.createdAt),
    updatedAt: new Date(response.updatedAt),
    purchaseDate: new Date(response.purchaseDate),
  }
}
