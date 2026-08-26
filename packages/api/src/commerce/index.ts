export interface CompletePurchaseRequest {
  purchaseId: string
}

export interface CompleteSaleRequest {
  saleId: string
}

export interface CommerceCompletionResponse {
  success: boolean
  idempotent: boolean
  message?: string
}
