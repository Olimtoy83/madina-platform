import {
  deepEqual,
  equal,
  rejects,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  VehicleService,
  type Vehicle,
} from '@madina/core'
import type { CommandContext } from '@madina/shared'
import { SqliteAuditRepository } from '../audit/SqliteAuditRepository.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteVehicleRepository } from './SqliteVehicleRepository.js'

const context: CommandContext = {
  actorType: 'user',
  actorUserId: 'vehicle-operator',
  requestId: 'vehicle-request-1',
}

function createVehicle(id: string, createdAt: string): Vehicle {
  const timestamp = new Date(createdAt)
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    make: 'Kia',
    model: id,
    year: 2024,
    status: 'available',
  }
}

async function withRepository(
  run: (repository: SqliteVehicleRepository, filename: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-korea-auto-'))
  const filename = join(directory, 'vehicles.sqlite')
  initializeDatabase(filename)
  const repository = new SqliteVehicleRepository(filename)
  try {
    await run(repository, filename)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SqliteVehicleRepository persists vehicle writes and keyset traversal', async () => {
  await withRepository(async (repository) => {
    await repository.withTransaction(async (unitOfWork) => {
      await unitOfWork.insert(createVehicle('vehicle-a', '2026-08-30T10:00:00.000Z'))
      await unitOfWork.insert(createVehicle('vehicle-b', '2026-08-30T11:00:00.000Z'))
      await unitOfWork.insert(createVehicle('vehicle-c', '2026-08-30T11:00:00.000Z'))
    })

    const first = await repository.list({
      throughCreatedAt: new Date('2026-08-30T12:00:00.000Z'),
      limit: 2,
    })
    deepEqual(first.map((vehicle) => vehicle.id), ['vehicle-c', 'vehicle-b'])

    const second = await repository.list({
      throughCreatedAt: new Date('2026-08-30T12:00:00.000Z'),
      limit: 2,
      cursor: { createdAt: first.at(-1)!.createdAt, id: first.at(-1)!.id },
    })
    deepEqual(second.map((vehicle) => vehicle.id), ['vehicle-a'])

    const vehicle = await repository.findById('vehicle-a')
    equal(vehicle?.model, 'vehicle-a')
  })
})

test('audit failure rolls back the entire vehicle creation transaction', async () => {
  await withRepository(async (repository, filename) => {
    const database = new DatabaseSync(filename)
    database.exec(`
      CREATE TRIGGER fail_vehicle_audit_insert
      BEFORE INSERT ON audit_events
      BEGIN
        SELECT RAISE(ABORT, 'vehicle audit failure');
      END;
    `)
    database.close()

    const service = new VehicleService(repository)
    await rejects(
      service.create({ make: 'Kia', model: 'K5', year: 2024 }, context),
      /vehicle audit failure/,
    )
    equal((await repository.list({
      throughCreatedAt: new Date('2026-08-30T12:00:00.000Z'),
      limit: 10,
    })).length, 0)

    const auditRepository = new SqliteAuditRepository(filename)
    try {
      equal((await auditRepository.findAll()).length, 0)
    } finally {
      auditRepository.close()
    }
  })
})
