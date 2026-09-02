export type RetailLocationType = 'central_warehouse' | 'store'
export type RetailLocationStatus = 'active' | 'inactive'

export type RetailProductStatus = 'active' | 'inactive'
export type RetailBaseUnit = 'piece'

export interface RetailProduct {
  id: string
  sourceId: string
  name: string
  status: RetailProductStatus
  baseUnit: RetailBaseUnit
  createdAt: Date
  updatedAt: Date
}

export interface RetailProductBarcode {
  id: string
  productId: string
  value: string
  createdAt: Date
  updatedAt: Date
}

export interface RetailProductImportRow {
  sourceRef: string
  sourceId: string
  name: string
  status?: RetailProductStatus
  barcode?: string
}

export type RetailProductImportOutcomeKind =
  | 'created'
  | 'updated'
  | 'no_op'
  | 'conflict'
  | 'quarantine'

export interface RetailProductImportOutcome {
  sourceRef: string
  sourceId?: string
  barcode?: string
  kind: RetailProductImportOutcomeKind
  reason?: string
}

export interface RetailProductImportResult {
  dryRun: boolean
  outcomes: readonly RetailProductImportOutcome[]
  summary: Record<RetailProductImportOutcomeKind, number>
}

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
  | 'retail:products:read'
  | 'retail:products:manage'
  | 'retail:products:import'

export const retailCapabilitiesByBaseRole = {
  admin: ['retail:locations:read', 'retail:locations:manage', 'retail:access:manage', 'retail:products:read', 'retail:products:manage', 'retail:products:import'],
  manager: ['retail:locations:read', 'retail:products:read'],
  operator: [],
  viewer: [],
} as const

export function hasRetailCapability(
  role: keyof typeof retailCapabilitiesByBaseRole,
  capability: RetailCapability,
): boolean {
  return retailCapabilitiesByBaseRole[role].includes(capability as never)
}
