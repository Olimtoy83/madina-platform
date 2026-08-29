import { useCallback, useRef } from 'react'
import type { Sale } from '@madina/core'
import {
  cancelSale as cancelSaleApi,
  completeSale as completeSaleApi,
  createSale as createSaleApi,
  updateSale as updateSaleApi,
} from '../shared/api/commerceApi'
import {
  toCommerceMutationFailure,
  type CommerceMutationResult,
} from '../shared/commerceState'
import { useTransactionalState } from './useTransactionalState'

export function useSalesMutations() {
  const { reload } = useTransactionalState()
  const completionGuard = useRef(createCompletionGuard())

  const addSale = useCallback(async (
    sale: Sale,
  ): Promise<CommerceMutationResult<Sale>> => {
    try {
      const savedSale = await createSaleApi({
        saleNumber: sale.saleNumber,
        saleDate: sale.saleDate.toISOString(),
        clientId: sale.clientId,
        clientName: sale.clientName,
        items: sale.items,
        paymentMethod: sale.paymentMethod,
        note: sale.note,
      })
      await reload()
      return { success: true, value: toSale(savedSale) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const updateSale = useCallback(async (
    saleId: string,
    updates: Partial<Sale>,
  ): Promise<CommerceMutationResult<Sale>> => {
    try {
      const savedSale = await updateSaleApi(saleId, {
        saleDate: updates.saleDate?.toISOString(),
        clientId: updates.clientId,
        clientName: updates.clientName,
        items: updates.items,
        paymentMethod: updates.paymentMethod,
        note: updates.note,
      })
      await reload()
      return { success: true, value: toSale(savedSale) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  const completeSale = useCallback(async (
    saleId: string,
  ): Promise<CommerceMutationResult<Sale>> => {
    if (!completionGuard.current.begin(saleId)) {
      return { success: false, message: 'Завершение продажи уже выполняется.' }
    }
    try {
      const result = await completeSaleApi(saleId)
      if (!result.success) return { success: false, message: result.message }
      await reload()
      return { success: true }
    } catch (error) {
      return toCommerceMutationFailure(error)
    } finally {
      completionGuard.current.finish(saleId)
    }
  }, [reload])

  const cancelSale = useCallback(async (
    saleId: string,
  ): Promise<CommerceMutationResult<Sale>> => {
    try {
      const savedSale = await cancelSaleApi(saleId)
      await reload()
      return { success: true, value: toSale(savedSale) }
    } catch (error) {
      return toCommerceMutationFailure(error)
    }
  }, [reload])

  return {
    addSale,
    updateSale,
    completeSale,
    cancelSale,
  }
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

function toSale(response: {
  createdAt: string
  updatedAt: string
  saleDate: string
} & Omit<Sale, 'createdAt' | 'updatedAt' | 'saleDate'>): Sale {
  return {
    ...response,
    createdAt: new Date(response.createdAt),
    updatedAt: new Date(response.updatedAt),
    saleDate: new Date(response.saleDate),
  }
}
