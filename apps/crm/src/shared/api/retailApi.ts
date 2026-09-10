import type { RetailLocation } from '@madina/retail'
import { requestJson } from './httpClient'

const retailLocationsUrl = '/api/v1/retail/locations'

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

export async function getRetailLocations(): Promise<RetailLocation[]> {
  const response = await requestJson<RetailLocationsListResponse>(
    retailLocationsUrl,
  )

  return response.locations.map(toRetailLocation)
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
