import { describe, expect, it, vi } from 'vitest'
import type { Vehicle } from '../types/vehicle.js'
import {
  createVehicle,
  updateVehicle,
  VehicleValidationError,
} from './VehicleService.js'

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  const createdAt = new Date('2026-08-30T12:00:00.000Z')
  return {
    id: 'vehicle-1',
    createdAt,
    updatedAt: createdAt,
    make: 'Kia',
    model: 'K5',
    year: 2024,
    status: 'available',
    ...overrides,
  }
}

describe('VehicleService domain rules', () => {
  it('creates a normalized available vehicle by default', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('vehicle-1')
    try {
      expect(createVehicle({ make: '  Kia ', model: ' K5  ', year: 2024 })).toMatchObject({
        id: 'vehicle-1',
        make: 'Kia',
        model: 'K5',
        year: 2024,
        status: 'available',
      })
    } finally {
      randomUUID.mockRestore()
    }
  })

  it('rejects incomplete, invalid, and premature status input', () => {
    expect(() => createVehicle({ make: ' ', model: 'K5', year: 2024 })).toThrow(VehicleValidationError)
    expect(() => createVehicle({ make: 'Kia', model: 'K5', year: 1885 })).toThrow(VehicleValidationError)
    expect(() => createVehicle({ make: 'Kia', model: 'K5', year: 2101 })).toThrow(VehicleValidationError)
    expect(() => createVehicle({ make: 'Kia', model: 'K5', year: 2024, status: 'sold' as never })).toThrow(VehicleValidationError)
    expect(() => createVehicle({ make: 'Kia', model: 'K5', year: 2024, vin: 'future' } as never)).toThrow(VehicleValidationError)
  })

  it('updates only supplied fields and rejects an empty update', () => {
    expect(updateVehicle(vehicle(), { model: '  K8 ', status: 'inactive' })).toMatchObject({
      make: 'Kia', model: 'K8', year: 2024, status: 'inactive',
    })
    expect(() => updateVehicle(vehicle(), {})).toThrow(VehicleValidationError)
    expect(() => updateVehicle(vehicle(), { trim: 'future' } as never)).toThrow(VehicleValidationError)
  })
})
