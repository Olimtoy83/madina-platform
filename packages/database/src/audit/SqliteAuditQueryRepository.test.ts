import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AuditEvent } from '@madina/shared'
import { initializeDatabase } from '../migrations/initializeDatabase.js'
import { SqliteAuditRepository } from './SqliteAuditRepository.js'
import { SqliteAuditQueryRepository } from './SqliteAuditQueryRepository.js'

function event(
  id: string,
  occurredAt: string,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    id,
    occurredAt: new Date(occurredAt),
    actorType: 'user',
    actorUserId: 'user-1',
    requestId: 'request-1',
    domain: 'clients',
    entityType: 'client',
    entityId: 'client-1',
    action: 'client.created',
    ...overrides,
  }
}

async function withRepository(
  run: (repository: SqliteAuditQueryRepository, writer: SqliteAuditRepository) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-audit-query-'))
  const filename = join(directory, 'madina.sqlite')
  initializeDatabase(filename)
  const repository = new SqliteAuditQueryRepository(filename)
  const writer = new SqliteAuditRepository(filename)

  try {
    await run(repository, writer)
  } finally {
    writer.close()
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SqliteAuditQueryRepository orders events by occurredAt and id descending', async () => {
  await withRepository(async (repository, writer) => {
    await writer.append(event('event-a', '2026-08-28T12:00:00.000Z'))
    await writer.append(event('event-c', '2026-08-28T12:00:00.000Z'))
    await writer.append(event('event-b', '2026-08-28T12:00:00.000Z'))
    await writer.append(event('event-newest', '2026-08-28T12:00:01.000Z'))

    const events = await repository.listEvents({ limit: 10 })
    deepEqual(events.map((item) => item.id), [
      'event-newest', 'event-c', 'event-b', 'event-a',
    ])
  })
})

test('SqliteAuditQueryRepository continues a keyset page without duplicates or skipped rows', async () => {
  await withRepository(async (repository, writer) => {
    for (const id of ['event-a', 'event-b', 'event-c', 'event-d']) {
      await writer.append(event(id, '2026-08-28T12:00:00.000Z'))
    }

    const firstPage = await repository.listEvents({ limit: 2 })
    const secondPage = await repository.listEvents({
      limit: 2,
      cursor: {
        occurredAt: firstPage[1]!.occurredAt,
        id: firstPage[1]!.id,
      },
    })

    deepEqual(firstPage.map((item) => item.id), ['event-d', 'event-c'])
    deepEqual(secondPage.map((item) => item.id), ['event-b', 'event-a'])
    equal(new Set([...firstPage, ...secondPage].map((item) => item.id)).size, 4)
  })
})

test('SqliteAuditQueryRepository filters by actor, resource, request id, and occurredAt range', async () => {
  await withRepository(async (repository, writer) => {
    await writer.append(event('matching', '2026-08-28T12:00:02.000Z', {
      actorUserId: 'actor-1', entityType: 'sale', entityId: 'sale-1',
      requestId: 'request-match', domain: 'commerce', action: 'sale.completed',
    }))
    await writer.append(event('other-actor', '2026-08-28T12:00:01.000Z', {
      actorUserId: 'actor-2', entityType: 'sale', entityId: 'sale-1',
      requestId: 'request-match', domain: 'commerce', action: 'sale.completed',
    }))
    await writer.append(event('other-resource', '2026-08-28T12:00:00.000Z', {
      actorUserId: 'actor-1', entityType: 'sale', entityId: 'sale-2',
      requestId: 'request-other', domain: 'commerce', action: 'sale.completed',
    }))

    const events = await repository.listEvents({
      limit: 10,
      actorUserId: 'actor-1',
      entityType: 'sale',
      entityId: 'sale-1',
      requestId: 'request-match',
      fromOccurredAt: new Date('2026-08-28T12:00:01.500Z'),
      toOccurredAt: new Date('2026-08-28T12:00:02.500Z'),
    })

    deepEqual(events.map((item) => item.id), ['matching'])
  })
})

test('SqliteAuditQueryRepository returns an empty result when no events match', async () => {
  await withRepository(async (repository) => {
    deepEqual(await repository.listEvents({
      limit: 10,
      actorUserId: 'missing-user',
    }), [])
  })
})
