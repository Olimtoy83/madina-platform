export type RetailLocationType = 'central_warehouse' | 'store'
export type RetailLocationStatus = 'active' | 'inactive'

export interface RetailLocation {
  id: string
  code: string
  name: string
  type: RetailLocationType
  status: RetailLocationStatus
  createdAt: Date
  updatedAt: Date
}

export type RetailCapability =
  | 'retail:locations:read'
  | 'retail:locations:manage'
  | 'retail:access:manage'

export const retailCapabilitiesByBaseRole = {
  admin: ['retail:locations:read', 'retail:locations:manage', 'retail:access:manage'],
  manager: ['retail:locations:read'],
  operator: [],
  viewer: [],
} as const

export function hasRetailCapability(
  role: keyof typeof retailCapabilitiesByBaseRole,
  capability: RetailCapability,
): boolean {
  return retailCapabilitiesByBaseRole[role].includes(capability as never)
}
