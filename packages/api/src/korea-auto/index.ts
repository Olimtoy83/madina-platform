export type VehicleStatus = 'available' | 'inactive'

export interface VehicleResponse {
  id: string
  createdAt: string
  updatedAt: string
  make: string
  model: string
  year: number
  status: VehicleStatus
}

export interface CreateVehicleRequest {
  make: string
  model: string
  year: number
  status?: VehicleStatus
}

export type UpdateVehicleRequest = Partial<CreateVehicleRequest>

export interface VehiclesListQuery {
  limit?: string
  cursor?: string
}

export interface VehiclesListResponse {
  vehicles: {
    items: VehicleResponse[]
    nextCursor?: string
  }
}
