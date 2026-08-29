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
import {
  hashSessionSecret,
  type AuthSession,
  type User,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuditRepository,
  SqliteAuthRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

type TestRole = 'admin' | 'manager' | 'operator' | 'viewer'

interface AuditEventInput {
  id: string
  occurredAt: Date
  actorType: 'user' | 'system' | 'migration'
  actorUserId?: string
  requestId: string
  domain: 'clients' | 'tasks' | 'commerce' | 'users'
  entityType: string
  entityId: string
  action: 'client.created' | 'sale.completed' | 'purchase.completed'
  metadata?: Record<string, string>
}

function createUser(id: string, role: TestRole): User {
  const now = new Date('2026-08-28T12:00:00.000Z')
  return {
    id,
    username: id,
    normalizedUsername: id,
    role,
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function createEvent(
  id: string,
  occurredAt: string,
  overrides: Partial<AuditEventInput> = {},
): AuditEventInput {
  return {
    id,
    occurredAt: new Date(occurredAt),
    actorType: 'user',
    actorUserId: 'audit-admin',
    requestId: 'request-1',
    domain: 'commerce',
    entityType: 'sale',
    entityId: 'sale-1',
    action: 'sale.completed',
    metadata: { internalOnly: 'not in the API response' },
    ...overrides,
  }
}

async function seedSession(
  databaseFile: string,
  id: string,
  role: TestRole,
): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const now = new Date()
  const secret = `audit-session-secret-${id}`

  try {
    await repository.createUser(createUser(id, role))
    const session: AuthSession = {
      id: `session-${id}`,
      userId: id,
      tokenHash: hashSessionSecret(secret),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date('2026-09-04T12:00:00.000Z'),
      sessionVersion: 1,
    }
    await repository.createSession(session)
  } finally {
    repository.close()
  }

  return `madina-session=${secret}`
}

async function withApp(
  seed: (databaseFile: string) => Promise<void>,
  run: (app: FastifyInstance, cookies: Record<TestRole, string>) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-audit-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)

  const cookies = {
    admin: await seedSession(databaseFile, 'audit-admin', 'admin'),
    manager: await seedSession(databaseFile, 'audit-manager', 'manager'),
    operator: await seedSession(databaseFile, 'audit-operator', 'operator'),
    viewer: await seedSession(databaseFile, 'audit-viewer', 'viewer'),
  }

  await seed(databaseFile)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()

  try {
    await app.ready()
    await run(app, cookies)
  } finally {
    await app.close()

    if (previousDatabaseFile === undefined) {
      delete process.env.DATABASE_FILE
    } else {
      process.env.DATABASE_FILE = previousDatabaseFile
    }

    rmSync(directory, { recursive: true, force: true })
  }
}

async function appendEvents(
  databaseFile: string,
  events: readonly AuditEventInput[],
): Promise<void> {
  const repository = new SqliteAuditRepository(databaseFile)
  try {
    for (const event of events) await repository.append(event)
  } finally {
    repository.close()
  }
}

test('audit events route requires an admin session and omits metadata', async () => {
  await withApp(async (databaseFile) => {
    await appendEvents(databaseFile, [
      createEvent('audit-1', '2026-08-28T12:00:00.000Z'),
    ])
  }, async (app, cookies) => {
    equal((await app.inject({
      method: 'GET', url: '/api/v1/audit/events',
    })).statusCode, 401)

    for (const role of ['viewer', 'operator', 'manager'] as const) {
      equal((await app.inject({
        method: 'GET', url: '/api/v1/audit/events',
        headers: { cookie: cookies[role] },
      })).statusCode, 403)
    }

    const response = await app.inject({
      method: 'GET', url: '/api/v1/audit/events',
      headers: { cookie: cookies.admin },
    })
    equal(response.statusCode, 200)
    const payload = response.json() as { events: Record<string, unknown>[] }
    equal(payload.events.length, 1)
    deepEqual(Object.keys(payload.events[0]!).sort(), [
      'action', 'actorType', 'actorUserId', 'domain', 'entityId',
      'entityType', 'id', 'occurredAt', 'requestId',
    ])
    equal('metadata' in payload.events[0]!, false)
    equal('metadata_json' in payload.events[0]!, false)
  })
})

test('audit events route paginates deterministically and validates cursors and limits', async () => {
  await withApp(async (databaseFile) => {
    await appendEvents(databaseFile, Array.from({ length: 51 }, (_, index) =>
      createEvent(
        `audit-${String(index).padStart(3, '0')}`,
        `2026-08-28T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
      ),
    ))
  }, async (app, cookies) => {
    const first = await app.inject({
      method: 'GET', url: '/api/v1/audit/events', headers: { cookie: cookies.admin },
    })
    equal(first.statusCode, 200)
    const firstPayload = first.json() as {
      events: { id: string }[]
      nextCursor?: string
    }
    equal(firstPayload.events.length, 50)
    equal(typeof firstPayload.nextCursor, 'string')

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/audit/events?cursor=${encodeURIComponent(firstPayload.nextCursor!)}`,
      headers: { cookie: cookies.admin },
    })
    equal(second.statusCode, 200)
    const secondPayload = second.json() as { events: { id: string }[] }
    equal(secondPayload.events.length, 1)
    equal(new Set([
      ...firstPayload.events.map((event) => event.id),
      ...secondPayload.events.map((event) => event.id),
    ]).size, 51)

    equal((await app.inject({
      method: 'GET', url: '/api/v1/audit/events?limit=101',
      headers: { cookie: cookies.admin },
    })).statusCode, 400)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/audit/events?cursor=bad%2Bcursor',
      headers: { cookie: cookies.admin },
    })).statusCode, 400)
    equal((await app.inject({
      method: 'GET',
      url: `/api/v1/audit/events?actorUserId=changed&cursor=${encodeURIComponent(firstPayload.nextCursor!)}`,
      headers: { cookie: cookies.admin },
    })).statusCode, 400)
  })
})

test('audit events route applies supported filters and rejects invalid filter combinations', async () => {
  await withApp(async (databaseFile) => {
    await appendEvents(databaseFile, [
      createEvent('matching', '2026-08-28T12:00:02.000Z', {
        actorUserId: 'actor-1', entityType: 'purchase', entityId: 'purchase-1',
        requestId: 'request-match', action: 'purchase.completed',
      }),
      createEvent('other', '2026-08-28T12:00:01.000Z', {
        actorUserId: 'actor-2', entityType: 'purchase', entityId: 'purchase-2',
        requestId: 'request-other', action: 'purchase.completed',
      }),
    ])
  }, async (app, cookies) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/events?actorUserId=actor-1&entityType=purchase&entityId=purchase-1&requestId=request-match&fromOccurredAt=2026-08-28T12%3A00%3A01.500Z&toOccurredAt=2026-08-28T12%3A00%3A02.500Z&limit=100',
      headers: { cookie: cookies.admin },
    })
    equal(response.statusCode, 200)
    deepEqual((response.json() as { events: { id: string }[] }).events.map(
      (event) => event.id,
    ), ['matching'])

    for (const url of [
      '/api/v1/audit/events?entityType=purchase',
      '/api/v1/audit/events?fromOccurredAt=not-a-date',
      '/api/v1/audit/events?fromOccurredAt=2026-08-29T00%3A00%3A00Z&toOccurredAt=2026-08-28T00%3A00%3A00Z',
    ]) {
      equal((await app.inject({
        method: 'GET', url, headers: { cookie: cookies.admin },
      })).statusCode, 400)
    }
  })
})
