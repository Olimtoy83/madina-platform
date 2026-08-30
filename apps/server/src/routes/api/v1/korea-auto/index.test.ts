import {
  deepEqual,
  equal,
  match,
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
  type UserRole,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuditRepository,
  SqliteAuthRepository,
} from '@madina/database'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'

interface SeededSession {
  userId: string
  secret: string
}

async function seedSession(
  databaseFile: string,
  role: UserRole,
): Promise<SeededSession> {
  const repository = new SqliteAuthRepository(databaseFile)
  const timestamp = new Date()
  const userId = `vehicle-${role}`
  const secret = `vehicle-${role}-session`
  const user: User = {
    id: userId,
    username: `vehicle.${role}`,
    normalizedUsername: `vehicle.${role}`,
    role,
    status: 'active',
    sessionVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  try {
    await repository.createUser(user)
    await repository.createSession({
      id: `${userId}-session`,
      userId,
      tokenHash: hashSessionSecret(secret),
      createdAt: timestamp,
      lastSeenAt: timestamp,
      expiresAt: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000),
      sessionVersion: 1,
    })
  } finally {
    repository.close()
  }
  return { userId, secret }
}

async function withApp(
  run: (
    app: FastifyInstance,
    databaseFile: string,
    sessions: Record<'viewer' | 'operator', SeededSession>,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-korea-auto-routes-'))
  const databaseFile = join(directory, 'vehicles.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = {
    viewer: await seedSession(databaseFile, 'viewer'),
    operator: await seedSession(databaseFile, 'operator'),
  }
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  try {
    await app.ready()
    await run(app, databaseFile, sessions)
  } finally {
    await app.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
}

function headers(secret: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `madina-session=${secret}`,
    origin: 'http://localhost:3000',
    ...extra,
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

test('vehicle routes enforce RBAC and atomically audit create, update, and status changes', async () => {
  await withApp(async (app, databaseFile, sessions) => {
    equal((await app.inject({ method: 'GET', url: '/api/v1/korea-auto/vehicles' })).statusCode, 401)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.viewer.secret),
    })).statusCode, 200)
    equal((await app.inject({
      method: 'POST', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.viewer.secret),
      payload: { make: 'Kia', model: 'K5', year: 2024 },
    })).statusCode, 403)

    const suppliedRequestId = 'client-controlled-request-id'
    const created = await app.inject({
      method: 'POST', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.operator.secret, { 'x-request-id': suppliedRequestId }),
      payload: { make: ' Kia ', model: ' K5 ', year: 2024 },
    })
    equal(created.statusCode, 201)
    const vehicle = created.json() as { id: string; make: string; model: string; status: string }
    deepEqual(
      { make: vehicle.make, model: vehicle.model, status: vehicle.status },
      { make: 'Kia', model: 'K5', status: 'available' },
    )

    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/korea-auto/vehicles/${vehicle.id}`,
      headers: headers(sessions.operator.secret), payload: { model: 'K8' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/korea-auto/vehicles/${vehicle.id}`,
      headers: headers(sessions.operator.secret), payload: { status: 'inactive' },
    })).statusCode, 200)
    const byId = await app.inject({
      method: 'GET', url: `/api/v1/korea-auto/vehicles/${vehicle.id}`,
      headers: headers(sessions.viewer.secret),
    })
    equal(byId.statusCode, 200)
    equal((byId.json() as { model: string; status: string }).model, 'K8')
    equal((byId.json() as { model: string; status: string }).status, 'inactive')

    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      deepEqual(events.map((event) => event.action).sort(), [
        'vehicle.created', 'vehicle.status_changed', 'vehicle.updated',
      ])
      for (const event of events) {
        equal(event.domain, 'korea-auto')
        equal(event.actorUserId, sessions.operator.userId)
        equal(event.entityId, vehicle.id)
        equal(isUuid(event.requestId), true)
      }
      equal(events.some((event) => event.requestId === suppliedRequestId), false)
      deepEqual(events.find((event) => event.action === 'vehicle.status_changed')?.metadata, {
        from: 'available', to: 'inactive',
      })
    } finally {
      auditRepository.close()
    }
  })
})

test('vehicle routes provide bounded keyset reads and validate input', async () => {
  await withApp(async (app, _databaseFile, sessions) => {
    const create = async (model: string) => app.inject({
      method: 'POST', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.operator.secret),
      payload: { make: 'Hyundai', model, year: 2025 },
    })
    equal((await create('Avante')).statusCode, 201)
    equal((await create('Sonata')).statusCode, 201)
    equal((await create('Tucson')).statusCode, 201)

    const first = await app.inject({
      method: 'GET', url: '/api/v1/korea-auto/vehicles?limit=2',
      headers: headers(sessions.viewer.secret),
    })
    equal(first.statusCode, 200)
    const firstPayload = first.json() as {
      vehicles: { items: Array<{ id: string }>; nextCursor?: string }
    }
    equal(firstPayload.vehicles.items.length, 2)
    match(firstPayload.vehicles.nextCursor!, /^[A-Za-z0-9_-]+$/)

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/korea-auto/vehicles?limit=2&cursor=${encodeURIComponent(firstPayload.vehicles.nextCursor!)}`,
      headers: headers(sessions.viewer.secret),
    })
    equal(second.statusCode, 200)
    const secondPayload = second.json() as { vehicles: { items: Array<{ id: string }> } }
    equal(secondPayload.vehicles.items.length, 1)
    const identifiers = [
      ...firstPayload.vehicles.items,
      ...secondPayload.vehicles.items,
    ].map((vehicle) => vehicle.id)
    equal(new Set(identifiers).size, 3)

    equal((await app.inject({
      method: 'GET', url: '/api/v1/korea-auto/vehicles?cursor=not-a-cursor',
      headers: headers(sessions.viewer.secret),
    })).statusCode, 400)
    equal((await app.inject({
      method: 'POST', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.operator.secret),
      payload: { make: 'Kia', model: 'K5', year: 1800 },
    })).statusCode, 400)
    equal((await app.inject({
      method: 'POST', url: '/api/v1/korea-auto/vehicles',
      headers: headers(sessions.operator.secret),
      payload: { make: 'Kia', model: 'K5', year: 2024, vin: 'future' },
    })).statusCode, 400)
    equal((await app.inject({
      method: 'GET', url: '/api/v1/korea-auto/vehicles/missing',
      headers: headers(sessions.viewer.secret),
    })).statusCode, 404)
  })
})
