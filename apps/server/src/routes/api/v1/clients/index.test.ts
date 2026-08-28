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
  type User,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuditRepository,
  SqliteAuthRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

const now = '2026-08-28T00:00:00.000Z'

async function seedAdminSession(databaseFile: string): Promise<string> {
  const repository = new SqliteAuthRepository(databaseFile)
  const sessionSecret = 'clients-audit-test-session'
  const timestamp = new Date()
  const user: User = {
    id: 'clients-audit-admin',
    username: 'clients.audit.admin',
    normalizedUsername: 'clients.audit.admin',
    role: 'admin', status: 'active', sessionVersion: 1,
    createdAt: timestamp, updatedAt: timestamp,
  }

  try {
    await repository.createUser(user)
    await repository.createSession({
      id: 'clients-audit-session', userId: user.id,
      tokenHash: hashSessionSecret(sessionSecret),
      createdAt: timestamp, lastSeenAt: timestamp,
      expiresAt: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000),
      sessionVersion: 1,
    })
  } finally {
    repository.close()
  }
  return sessionSecret
}

async function withApp(
  run: (app: FastifyInstance, databaseFile: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-clients-audit-'))
  const databaseFile = join(directory, 'clients.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessionSecret = await seedAdminSession(databaseFile)
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const inject = app.inject.bind(app)
  app.inject = ((options: { headers?: Record<string, string> }) => inject({
    ...options,
    headers: {
      cookie: `madina-session=${sessionSecret}`,
      origin: 'http://localhost:3000',
      ...options.headers,
    },
  })) as typeof app.inject

  try {
    await app.ready()
    await run(app, databaseFile)
  } finally {
    await app.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
}

function importClient(id: string, name: string) {
  return {
    id, name, createdAt: now, updatedAt: now,
    status: 'active' as const,
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

test('client create and update routes append attributed audit events', async () => {
  await withApp(async (app, databaseFile) => {
    const suppliedRequestId = 'client-controlled-request-id'
    const created = await app.inject({
      method: 'POST', url: '/api/v1/clients',
      headers: { 'x-request-id': suppliedRequestId },
      payload: { name: 'Мадина', status: 'active' },
    })
    equal(created.statusCode, 201)
    const clientId = (created.json() as { id: string }).id

    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/clients/${clientId}`,
      payload: { name: 'Мадина Т.' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/clients/${clientId}`,
      payload: { status: 'inactive' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/clients/${clientId}`,
      payload: { name: 'Мадина Турсунова', status: 'active' },
    })).statusCode, 200)

    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      const actions = events.map((event) => event.action).sort()
      deepEqual(actions, [
        'client.created',
        'client.status_changed',
        'client.status_changed',
        'client.updated',
        'client.updated',
      ])
      for (const event of events) {
        equal(event.domain, 'clients')
        equal(event.actorType, 'user')
        equal(event.actorUserId, 'clients-audit-admin')
        equal(event.entityId, clientId)
        equal(isUuid(event.requestId), true)
      }
      equal(events.some((event) => event.requestId === suppliedRequestId), false)
    } finally {
      auditRepository.close()
    }
  })
})

test('client import is atomic, rejects duplicate IDs, and audits every successful repeat', async () => {
  await withApp(async (app, databaseFile) => {
    const payload = {
      clients: [
        importClient('client-import-1', 'Первый'),
        importClient('client-import-2', 'Второй'),
      ],
    }
    const first = await app.inject({
      method: 'POST', url: '/api/v1/clients/import', payload,
    })
    equal(first.statusCode, 200)
    deepEqual(first.json(), { created: 2, updated: 0 })
    const second = await app.inject({
      method: 'POST', url: '/api/v1/clients/import', payload,
    })
    equal(second.statusCode, 200)
    deepEqual(second.json(), { created: 0, updated: 2 })

    const invalid = await app.inject({
      method: 'POST', url: '/api/v1/clients/import',
      payload: { clients: [
        importClient('client-invalid-1', 'Валидный'),
        { ...importClient('client-invalid-2', 'Ошибка'), updatedAt: 'invalid-date' },
      ] },
    })
    equal(invalid.statusCode, 400)
    const duplicates = await app.inject({
      method: 'POST', url: '/api/v1/clients/import',
      payload: { clients: [
        importClient('client-duplicate', 'Первый'),
        importClient('client-duplicate', 'Второй'),
      ] },
    })
    equal(duplicates.statusCode, 400)

    const listed = await app.inject({ method: 'GET', url: '/api/v1/clients' })
    equal(listed.statusCode, 200)
    equal((listed.json() as { clients: unknown[] }).clients.length, 2)
    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      equal(events.length, 2)
      for (const event of events) {
        equal(event.action, 'clients.imported')
        equal(event.entityType, 'client_import')
        equal(event.entityId, 'clients-import')
        equal(event.actorUserId, 'clients-audit-admin')
      }
      deepEqual(
        events.map((event) => event.metadata).sort(
          (left, right) => Number(left?.created) - Number(right?.created),
        ),
        [
          { created: 0, updated: 2, total: 2 },
          { created: 2, updated: 0, total: 2 },
        ],
      )
    } finally {
      auditRepository.close()
    }
  })
})
