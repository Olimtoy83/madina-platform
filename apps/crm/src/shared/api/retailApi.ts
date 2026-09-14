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
