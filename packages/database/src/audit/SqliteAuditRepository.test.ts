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
import type { AuditEvent } from '@madina/shared'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import {
  appendAuditEvent,
  SqliteAuditRepository,
} from './SqliteAuditRepository.js'

const occurredAt = new Date('2026-08-28T12:00:00.000Z')

function createEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'audit-1',
    occurredAt,
    actorType: 'user',
    actorUserId: 'user-1',
    requestId: 'request-1',
    domain: 'clients',
    entityType: 'client',
    entityId: 'client-1',
    action: 'client.created',
    metadata: { changedFields: ['name'], count: 1 },
    ...overrides,
  }
}

async function withRepository(
  run: (repository: SqliteAuditRepository, filename: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-audit-repository-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)
  const repository = new SqliteAuditRepository(filename)

  try {
    await run(repository, filename)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SqliteAuditRepository appends and reads a user audit event', async () => {
  await withRepository(async (repository) => {
    await repository.append(createEvent())

    const event = await repository.findById('audit-1')
    equal(event?.actorType, 'user')
    equal(event?.actorUserId, 'user-1')
    equal(event?.occurredAt.toISOString(), occurredAt.toISOString())
    equal(event?.metadata?.count, 1)
  })
})

test('SqliteAuditRepository supports system and migration actors without fake users', async () => {
  await withRepository(async (repository) => {
    await repository.append(createEvent({
      id: 'audit-system', actorType: 'system', actorUserId: undefined,
      action: 'user.bootstrap_admin_created', domain: 'users',
      entityType: 'user', entityId: 'user-1', metadata: undefined,
    }))
    await repository.append(createEvent({
      id: 'audit-migration', actorType: 'migration', actorUserId: undefined,
      action: 'commerce.snapshot_imported', domain: 'commerce',
      entityType: 'commerce_snapshot', entityId: 'legacy-snapshot',
    }))

    equal((await repository.findById('audit-system'))?.actorUserId, undefined)
    equal((await repository.findById('audit-migration'))?.actorType, 'migration')
  })
})

test('SqliteAuditRepository requires actorUserId for a user event', async () => {
  await withRepository(async (repository) => {
    await rejects(repository.append(createEvent({ actorUserId: undefined })))
  })
})

test('SqliteAuditRepository preserves null metadata and rejects duplicate ids', async () => {
  await withRepository(async (repository) => {
    const event = createEvent({ metadata: undefined })
    await repository.append(event)
    equal((await repository.findById(event.id))?.metadata, undefined)
    await rejects(repository.append(event))
  })
})

test('audit_events rejects an invalid actor type at the database level', async () => {
  await withRepository(async (_repository, filename) => {
    const database = new DatabaseSync(filename)
    try {
      throws(() => database.prepare(`
        INSERT INTO audit_events (
          id, occurred_at, actor_type, request_id, domain, entity_type,
          entity_id, action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'invalid-actor', occurredAt.toISOString(), 'unknown', 'request-1',
        'clients', 'client', 'client-1', 'client.created',
      ))
    } finally {
      database.close()
    }
  })
})

test('audit_events triggers block update and delete', async () => {
  await withRepository(async (repository, filename) => {
    await repository.append(createEvent())
    const database = new DatabaseSync(filename)
    try {
      throws(() => database.prepare(
        'UPDATE audit_events SET action = ? WHERE id = ?',
      ).run('client.updated', 'audit-1'))
      throws(() => database.prepare(
        'DELETE FROM audit_events WHERE id = ?',
      ).run('audit-1'))
    } finally {
      database.close()
    }
  })
})

test('appendAuditEvent participates in the caller transaction rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-audit-transaction-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)
  const database = new DatabaseSync(filename)

  try {
    database.exec('BEGIN IMMEDIATE')
    appendAuditEvent(database, createEvent())
    database.exec('ROLLBACK')

    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM audit_events',
    ).get() as { count: number }
    equal(count.count, 0)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
