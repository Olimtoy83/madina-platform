import type { BaseEntity } from '@madina/shared'

export type VehicleStatus =
  | 'available'
  | 'inactive'

export interface Vehicle extends BaseEntity {
  make: string
  model: string
  year: number
  status: VehicleStatus
}
