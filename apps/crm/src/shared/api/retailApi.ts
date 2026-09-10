import type { RetailProductResponse } from '@madina/api'
import type { RetailLocation, RetailProduct } from '@madina/retail'
import { requestJson } from './httpClient'

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
