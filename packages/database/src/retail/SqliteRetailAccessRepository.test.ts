import {
  equal,
  rejects,
  throws,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { User } from '@madina/auth'
import { SqliteAuditRepository } from '../audit/SqliteAuditRepository.js'
import { SqliteAuthRepository } from '../auth/SqliteAuthRepository.js'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteRetailAccessRepository } from './SqliteRetailAccessRepository.js'

const context = {
  actorType: 'user' as const,
  actorUserId: 'admin-1',
  requestId: 'retail-repository-test',
}

function createUser(id: string): User {
  const now = new Date('2026-09-01T00:00:00.000Z')
  return {
    id,
    username: id,
    normalizedUsername: id,
    role: 'admin',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

async function withDatabase(run: (filename: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-access-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)

  try {
    await run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('retail access persistence reuses Auth users and records auditable grant lifecycle', async () => {
  await withDatabase(async (filename) => {
    const auth = new SqliteAuthRepository(filename)
    const retail = new SqliteRetailAccessRepository(filename)
    const audit = new SqliteAuditRepository(filename)

    try {
      await auth.createUser(createUser('admin-1'))
      await auth.createUser(createUser('user-1'))
      const location = await retail.createLocation({
        code: 'WH-01',
        name: 'Central warehouse',
        type: 'central_warehouse',
        status: 'active',
      }, context)

      await retail.grant('user-1', location.id, context)
      equal(await retail.hasActiveGrant('user-1', location.id), true)
      await retail.revoke('user-1', location.id, context)
      equal(await retail.hasActiveGrant('user-1', location.id), false)

      const events = await audit.findAll()
      equal(events.length, 3)
      equal(events.map((event) => event.action).sort().join(','), [
        'retail.location_created',
        'retail.location_granted',
        'retail.location_revoked',
      ].join(','))
      equal(events.every((event) => event.actorUserId === 'admin-1'), true)
      equal(events.every((event) => event.entityId === location.id), true)
    } finally {
      audit.close()
      retail.close()
      auth.close()
    }
  })
})

test('retail migration enforces additive Location and grant invariants', async () => {
  await withDatabase(async (filename) => {
    const database = new DatabaseSync(filename)
    try {
      database.exec('PRAGMA foreign_keys = ON')
      const migration = database.prepare(
        "SELECT id FROM schema_migrations WHERE id = '031_retail_access_locations_v1'",
      ).get() as { id: string } | undefined
      equal(migration?.id, '031_retail_access_locations_v1')

      const preexistingTables = database.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('users', 'clients', 'products')
      `).get() as { count: number }
      equal(preexistingTables.count, 3)

      database.prepare(`
        INSERT INTO users (
          id, username, normalized_username, role, status, session_version,
          created_at, updated_at
        ) VALUES ('user-1', 'user-1', 'user-1', 'manager', 'active', 1, ?, ?)
      `).run(context.requestId, context.requestId)
      database.prepare(`
        INSERT INTO retail_locations (
          id, code, name, type, status, created_at, updated_at
        ) VALUES ('location-1', 'STORE-01', 'Store', 'store', 'active', ?, ?)
      `).run(context.requestId, context.requestId)
      database.prepare(`
        INSERT INTO retail_user_location_grants (
          user_id, location_id, granted_at
        ) VALUES ('user-1', 'location-1', ?)
      `).run(context.requestId)

      throws(() => database.prepare(`
        INSERT INTO retail_locations (
          id, code, name, type, status, created_at, updated_at
        ) VALUES ('location-2', 'STORE-01', 'Duplicate', 'store', 'active', ?, ?)
      `).run(context.requestId, context.requestId))
      throws(() => database.prepare(`
        INSERT INTO retail_locations (
          id, code, name, type, status, created_at, updated_at
        ) VALUES ('location-3', 'STORE-03', 'Invalid', 'invalid', 'active', ?, ?)
      `).run(context.requestId, context.requestId))
      throws(() => database.prepare(`
        INSERT INTO retail_user_location_grants (user_id, location_id, granted_at)
        VALUES ('missing-user', 'location-1', ?)
      `).run(context.requestId))
      throws(() => database.prepare(`
        INSERT INTO retail_user_location_grants (user_id, location_id, granted_at)
        VALUES ('user-1', 'missing-location', ?)
      `).run(context.requestId))
      throws(() => database.prepare(`
        INSERT INTO retail_user_location_grants (user_id, location_id, granted_at)
        VALUES ('user-1', 'location-1', ?)
      `).run(context.requestId))
    } finally {
      database.close()
    }
  })
})

test('failed Retail persistence rolls back its success audit event', async () => {
  await withDatabase(async (filename) => {
    const auth = new SqliteAuthRepository(filename)
    const retail = new SqliteRetailAccessRepository(filename)
    const audit = new SqliteAuditRepository(filename)
    try {
      await auth.createUser(createUser('admin-1'))
      await retail.createLocation({
        code: 'STORE-01', name: 'Store', type: 'store', status: 'active',
      }, context)
      await rejects(retail.createLocation({
        code: 'STORE-01', name: 'Duplicate', type: 'store', status: 'active',
      }, context))
      equal((await audit.findAll()).length, 1)
    } finally {
      audit.close()
      retail.close()
      auth.close()
    }
  })
})
