import type { DatabaseSync } from 'node:sqlite'
import type {
  Vehicle,
  VehicleListQuery,
  VehicleRepository,
  VehicleStatus,
  VehicleUnitOfWork,
} from '@madina/core'
import type { AuditEvent } from '@madina/shared'
import { appendAuditEvent } from '../audit/SqliteAuditRepository.js'
import { openDatabaseConnection } from '../connectionPolicy.js'

interface VehicleRow {
  id: string
  created_at: string
  updated_at: string
  make: string
  model: string
  year: number
  status: VehicleStatus
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    make: row.make,
    model: row.model,
    year: row.year,
    status: row.status,
  }
}

class SqliteVehicleUnitOfWork implements VehicleUnitOfWork {
  constructor(private readonly database: DatabaseSync) {}

  async findById(vehicleId: string): Promise<Vehicle | undefined> {
    const row = this.database.prepare(`
      SELECT id, created_at, updated_at, make, model, year, status
      FROM korea_auto_vehicles WHERE id = ?
    `).get(vehicleId) as VehicleRow | undefined
    return row ? toVehicle(row) : undefined
  }

  async list(query: VehicleListQuery): Promise<Vehicle[]> {
    const parameters: Array<string | number> = [query.throughCreatedAt.toISOString()]
    let filters = 'created_at <= ?'
    if (query.cursor) {
      filters += ` AND (created_at < ? OR (created_at = ? AND id < ?))`
      const createdAt = query.cursor.createdAt.toISOString()
      parameters.push(createdAt, createdAt, query.cursor.id)
    }
    parameters.push(query.limit)
    const rows = this.database.prepare(`
      SELECT id, created_at, updated_at, make, model, year, status
      FROM korea_auto_vehicles
      WHERE ${filters}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...parameters) as unknown as VehicleRow[]
    return rows.map(toVehicle)
  }

  async insert(vehicle: Vehicle): Promise<void> {
    this.database.prepare(`
      INSERT INTO korea_auto_vehicles (id, created_at, updated_at, make, model, year, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(vehicle.id, vehicle.createdAt.toISOString(), vehicle.updatedAt.toISOString(), vehicle.make, vehicle.model, vehicle.year, vehicle.status)
  }

  async update(vehicle: Vehicle): Promise<void> {
    this.database.prepare(`
      UPDATE korea_auto_vehicles
      SET updated_at = ?, make = ?, model = ?, year = ?, status = ?
      WHERE id = ?
    `).run(vehicle.updatedAt.toISOString(), vehicle.make, vehicle.model, vehicle.year, vehicle.status, vehicle.id)
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    appendAuditEvent(this.database, event)
  }
}

export class SqliteVehicleRepository implements VehicleRepository {
  private readonly database: DatabaseSync

  constructor(filename: string) {
    this.database = openDatabaseConnection(filename)
  }

  async withTransaction<T>(operation: (unitOfWork: VehicleUnitOfWork) => Promise<T>): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = await operation(new SqliteVehicleUnitOfWork(this.database))
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async findById(vehicleId: string): Promise<Vehicle | undefined> {
    return new SqliteVehicleUnitOfWork(this.database).findById(vehicleId)
  }

  async list(query: VehicleListQuery): Promise<Vehicle[]> {
    return new SqliteVehicleUnitOfWork(this.database).list(query)
  }

  close(): void {
    this.database.close()
  }
}
