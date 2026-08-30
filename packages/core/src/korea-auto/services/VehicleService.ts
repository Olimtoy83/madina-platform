import type { CommandContext } from '@madina/shared'
import type { VehicleRepository, VehicleUnitOfWork } from '../repositories/VehicleRepository.js'
import type { Vehicle, VehicleStatus } from '../types/vehicle.js'

export const VEHICLE_MIN_YEAR = 1886
export const VEHICLE_MAX_YEAR = 2100

export interface CreateVehicleInput {
  make: string
  model: string
  year: number
  status?: VehicleStatus
}

export type UpdateVehicleInput = Partial<CreateVehicleInput>

export class VehicleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VehicleValidationError'
  }
}

export class VehicleNotFoundError extends Error {
  constructor() {
    super('Vehicle not found.')
    this.name = 'VehicleNotFoundError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  if (Object.keys(input).some((field) => !allowedFields.includes(field))) {
    throw new VehicleValidationError('Vehicle input contains an unsupported field.')
  }
}

function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new VehicleValidationError(`${label} is required.`)
  }
  const normalized = value.trim()
  if (!normalized) throw new VehicleValidationError(`${label} is required.`)
  return normalized
}

function validateYear(year: unknown): number {
  if (
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year < VEHICLE_MIN_YEAR ||
    year > VEHICLE_MAX_YEAR
  ) {
    throw new VehicleValidationError(
      `Vehicle year must be between ${VEHICLE_MIN_YEAR} and ${VEHICLE_MAX_YEAR}.`,
    )
  }
  return year
}

function validateStatus(status: unknown): VehicleStatus {
  if (status !== 'available' && status !== 'inactive') {
    throw new VehicleValidationError('Vehicle status is invalid.')
  }
  return status
}

export function createVehicle(input: CreateVehicleInput): Vehicle {
  if (!isRecord(input)) {
    throw new VehicleValidationError('Vehicle input is invalid.')
  }
  assertKnownFields(input, ['make', 'model', 'year', 'status'])
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    make: normalizeRequiredText(input.make, 'Vehicle make'),
    model: normalizeRequiredText(input.model, 'Vehicle model'),
    year: validateYear(input.year),
    status: validateStatus(input.status ?? 'available'),
  }
}

export function updateVehicle(
  vehicle: Vehicle,
  updates: UpdateVehicleInput,
): Vehicle {
  if (!isRecord(updates)) {
    throw new VehicleValidationError('Vehicle update is invalid.')
  }
  assertKnownFields(updates, ['make', 'model', 'year', 'status'])
  if (Object.keys(updates).length === 0) {
    throw new VehicleValidationError('Vehicle update must include at least one field.')
  }
  const next: Vehicle = { ...vehicle, updatedAt: new Date() }
  if (Object.hasOwn(updates, 'make')) next.make = normalizeRequiredText(updates.make ?? '', 'Vehicle make')
  if (Object.hasOwn(updates, 'model')) next.model = normalizeRequiredText(updates.model ?? '', 'Vehicle model')
  if (Object.hasOwn(updates, 'year')) next.year = validateYear(updates.year ?? Number.NaN)
  if (Object.hasOwn(updates, 'status')) next.status = validateStatus(updates.status ?? 'available')
  return next
}

export class VehicleService {
  private readonly repository: VehicleRepository

  constructor(repository: VehicleRepository) {
    this.repository = repository
  }

  async create(input: CreateVehicleInput, context: CommandContext): Promise<Vehicle> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const vehicle = createVehicle(input)
      await unitOfWork.insert(vehicle)
      await appendVehicleAudit(unitOfWork, context, 'vehicle.created', vehicle.id)
      return vehicle
    })
  }

  async update(
    vehicleId: string,
    updates: UpdateVehicleInput,
    context: CommandContext,
  ): Promise<Vehicle> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const vehicle = await unitOfWork.findById(vehicleId)
      if (!vehicle) throw new VehicleNotFoundError()
      const updated = updateVehicle(vehicle, updates)
      await unitOfWork.update(updated)
      const statusChanged = vehicle.status !== updated.status
      const hasNonStatusUpdates = Object.keys(updates).some((field) => field !== 'status')
      if (hasNonStatusUpdates || !statusChanged) {
        await appendVehicleAudit(unitOfWork, context, 'vehicle.updated', updated.id)
      }
      if (statusChanged) {
        await appendVehicleAudit(unitOfWork, context, 'vehicle.status_changed', updated.id, { from: vehicle.status, to: updated.status })
      }
      return updated
    })
  }
}

async function appendVehicleAudit(
  unitOfWork: VehicleUnitOfWork,
  context: CommandContext,
  action: 'vehicle.created' | 'vehicle.updated' | 'vehicle.status_changed',
  entityId: string,
  metadata?: { from: VehicleStatus; to: VehicleStatus },
): Promise<void> {
  await unitOfWork.appendAuditEvent({
    id: crypto.randomUUID(),
    occurredAt: new Date(),
    actorType: context.actorType,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    domain: 'korea-auto',
    action,
    entityType: 'vehicle',
    entityId,
    metadata,
  })
}
