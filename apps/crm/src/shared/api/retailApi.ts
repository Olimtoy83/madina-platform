import type { RetailProductResponse } from '@madina/api'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import { requestJson, requestResponse } from './httpClient'

const retailLocationsUrl = '/api/v1/retail/locations'
const retailProductsUrl = '/api/v1/retail/products'

interface RetailLocationResponse extends Omit<
  RetailLocation,
  'createdAt' | 'updatedAt'
> {
  createdAt: string
  updatedAt: string
}

interface RetailLocationsListResponse {
  locations: RetailLocationResponse[]
}

interface RetailProductsListResponse {
  products: RetailProductResponse[]
}

interface RetailProductPriceResponse {
  unitPriceMinor: number
}

export interface RetailSaleCompletionRequest {
  clientOperationId: string
  saleId: string
  lines: ReadonlyArray<{
    id: string
    productId: string
    quantity: number
  }>
  allocations: ReadonlyArray<{
    id: string
    method: 'cash' | 'card' | 'transfer' | 'other'
    amountMinor: number
    ordinal: number
  }>
}

interface RetailSaleCompletionResponse {
  sale: unknown
  items: unknown[]
  allocations: unknown[]
}

export interface RetailCompletedSale {
  sale: {
    id: string
    location_id: string
    status: 'completed'
    currency_code: string
    currency_exponent: number
    payable_total_minor: number
    completed_at: string
  }
  items: ReadonlyArray<{
    sale_item_id: string
    product_id: string
    source_id: string
    name: string
    quantity: number
    unit_price_minor: number
    line_total_minor: number
    discount_amount_minor: number
    already_returned_quantity: number
    already_refunded_amount_minor: number
  }>
  paymentAllocations: ReadonlyArray<{
    id: string
    method: string
    amount_minor: number
    ordinal: number
    already_refunded_amount_minor: number
  }>
}

export interface RetailReturnRequest {
  clientOperationId: string
  items: ReadonlyArray<{ saleItemId: string; quantity: number }>
}

export interface RetailReturnCompletionResponse {
  saleReturn: { id: string; original_sale_id: string; completed_at: string }
  items: ReadonlyArray<{ original_sale_item_id: string; quantity: number; refunded_amount_minor: number }>
  refundAllocations: ReadonlyArray<{ method: string; amount_minor: number; ordinal: number }>
  movements: ReadonlyArray<unknown>
}

export interface RetailReturnCompletionResult {
  status: 200 | 201
  body: RetailReturnCompletionResponse
}

export interface RetailSaleCompletionResult {
  status: 200 | 201
  body: RetailSaleCompletionResponse
}

export async function getRetailLocations(): Promise<RetailLocation[]> {
  const response = await requestJson<RetailLocationsListResponse>(
    retailLocationsUrl,
  )

  return response.locations.map(toRetailLocation)
}

/** A location-scoped read: unlike the location list, this proves the current grant. */
export async function getRetailLocation(locationId: string): Promise<RetailLocation> {
  const response = await requestJson<{ location: RetailLocationResponse }>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}`,
  )
  return toRetailLocation(response.location)
}

export interface RetailOfflineTerminalDetail {
  terminalId: string
  locationId: string
  currentKeyVersion: number
  revoked: boolean
}

export interface RetailOfflineAuthorityPermit {
  permitId: string
  sequence: number
  status: 'AVAILABLE' | 'CONSUMED_CONFLICT_PENDING' | 'CONSUMED_ACCEPTED'
}

export interface RetailOfflineAuthorityDetail {
  authorityId: string
  authorityVersion: number
  terminalId: string
  terminalKeyVersion: number
  userId: string
  locationId: string
  issuedAt: string
  expiresAt: string
  currencyCode: string
  currencyExponent: number
  permitCount: number
  revoked: boolean
  productPrices: Array<{ productId: string; unitPriceMinor: number }>
  permits: RetailOfflineAuthorityPermit[]
  permitCounts: { available: number; conflictPending: number; accepted: number }
  revocation?: { revokedAt: string; revokedByUserId: string; reason: string }
}

export async function getRetailOfflineTerminalDetail(locationId: string, terminalId: string): Promise<RetailOfflineTerminalDetail> {
  const response = await requestJson<{ terminal: RetailOfflineTerminalDetail }>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/offline-terminals/${encodeURIComponent(terminalId)}`,
  )
  return response.terminal
}

export async function getRetailOfflineAuthorityDetail(locationId: string, authorityId: string): Promise<RetailOfflineAuthorityDetail> {
  const response = await requestJson<{ authority: RetailOfflineAuthorityDetail }>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/offline-authorities/${encodeURIComponent(authorityId)}`,
  )
  return response.authority
}

export async function getRetailOfflineAuthorityPermits(locationId: string, authorityId: string): Promise<RetailOfflineAuthorityPermit[]> {
  const response = await requestJson<{ permits: RetailOfflineAuthorityPermit[] }>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/offline-authorities/${encodeURIComponent(authorityId)}/permits`,
  )
  return response.permits
}

export async function getRetailProducts(
  search: string,
): Promise<RetailProduct[]> {
  const term = search.trim()
  if (!term) return []

  const response = await requestJson<RetailProductsListResponse>(
    `${retailProductsUrl}?search=${encodeURIComponent(term)}`,
  )

  return response.products.map(toRetailProduct)
}

export async function getRetailProductByBarcode(
  barcode: string,
): Promise<RetailProduct | undefined> {
  const value = barcode.trim()
  if (!value) return undefined

  const response = await requestJson<{ product: RetailProductResponse }>(
    `${retailProductsUrl}/by-barcode/${encodeURIComponent(value)}`,
  )

  return toRetailProduct(response.product)
}

export async function getRetailProductPrice(
  locationId: string,
  productId: string,
): Promise<number> {
  const response = await requestJson<RetailProductPriceResponse>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/products/${encodeURIComponent(productId)}/price`,
  )

  return response.unitPriceMinor
}

export async function completeRetailSale(
  locationId: string,
  payload: RetailSaleCompletionRequest,
): Promise<RetailSaleCompletionResult> {
  const response = await requestResponse(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/sales/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )

  if (response.status !== 200 && response.status !== 201) {
    throw new Error('Unexpected Retail Sale completion response status.')
  }

  return {
    status: response.status,
    body: await response.json() as RetailSaleCompletionResponse,
  }
}

export function getRetailCompletedSale(locationId: string, saleId: string): Promise<RetailCompletedSale> {
  return requestJson<RetailCompletedSale>(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/sales/${encodeURIComponent(saleId)}`,
  )
}

export async function completeRetailReturn(
  locationId: string,
  saleId: string,
  payload: RetailReturnRequest,
): Promise<RetailReturnCompletionResult> {
  const response = await requestResponse(
    `${retailLocationsUrl}/${encodeURIComponent(locationId)}/sales/${encodeURIComponent(saleId)}/returns`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
  )
  if (response.status !== 200 && response.status !== 201) {
    throw new Error('Unexpected Retail Return completion response status.')
  }
  return { status: response.status, body: await response.json() as RetailReturnCompletionResponse }
}

function toRetailLocation(
  location: RetailLocationResponse,
): RetailLocation {
  return {
    ...location,
    createdAt: new Date(location.createdAt),
    updatedAt: new Date(location.updatedAt),
  }
}

function toRetailProduct(
  product: RetailProductResponse,
): RetailProduct {
  return {
    ...product,
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
  }
}
