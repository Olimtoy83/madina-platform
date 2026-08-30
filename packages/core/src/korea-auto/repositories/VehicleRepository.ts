import type { AuditEvent } from '@madina/shared'
import type { Vehicle } from '../types/vehicle.js'

export interface VehicleListQuery {
  throughCreatedAt: Date
  limit: number
  cursor?: { createdAt: Date; id: string }
}

export interface VehicleReadRepository {
  findById(vehicleId: string): Promise<Vehicle | undefined>
  list(query: VehicleListQuery): Promise<Vehicle[]>
}

export interface VehicleUnitOfWork extends VehicleReadRepository {
  insert(vehicle: Vehicle): Promise<void>
  update(vehicle: Vehicle): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
}

export interface VehicleRepository extends VehicleReadRepository {
  withTransaction<T>(
    operation: (unitOfWork: VehicleUnitOfWork) => Promise<T>,
  ): Promise<T>
}
