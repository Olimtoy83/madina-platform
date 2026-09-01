import {
  deepEqual,
  equal,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
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
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../../../app.js'
import { retailRoutes } from './index.js'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

test('retail boundary composes without routes or CRM dependencies', async () => {
  const repositoryRoot = resolve(process.cwd(), '..', '..')
  const retail = readManifest(resolve(repositoryRoot, 'packages/retail/package.json'))
  const crm = readManifest(resolve(repositoryRoot, 'apps/crm/package.json'))

  deepEqual(retail.dependencies ?? {}, {})
  equal(retail.devDependencies?.['@madina/core'], undefined)
  equal(crm.dependencies?.['@madina/retail'], undefined)

  const app = Fastify()
  app.register(retailRoutes, { prefix: '/retail' })
  try {
    await app.ready()
    equal((await app.inject({ method: 'GET', url: '/retail' })).statusCode, 404)
  } finally {
    await app.close()
  }
})

interface UserFixture {
  id: string
  role: UserRole
}

async function seedSessions(
  filename: string,
  fixtures: readonly UserFixture[],
): Promise<Record<string, string>> {
  const repository = new SqliteAuthRepository(filename)
  const now = new Date()
  const sessions: Record<string, string> = {}

  try {
    for (const fixture of fixtures) {
      const user: User = {
        id: fixture.id,
        username: fixture.id,
        normalizedUsername: fixture.id,
        role: fixture.role,
        status: 'active',
        sessionVersion: 1,
        createdAt: now,
        updatedAt: now,
      }
      const secret = `retail-${fixture.id}-session`
      await repository.createUser(user)
      await repository.createSession({
        id: `session-${fixture.id}`,
        userId: user.id,
        tokenHash: hashSessionSecret(secret),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        sessionVersion: 1,
      })
      sessions[fixture.id] = secret
    }
  } finally {
    repository.close()
  }

  return sessions
}

function request(
  app: FastifyInstance,
  session: string,
  options: {
    method: 'GET' | 'POST' | 'DELETE'
    url: string
    payload?: unknown
  },
) {
  return app.inject({
    ...options,
    payload: options.payload as never,
    headers: {
      cookie: `madina-session=${session}`,
      origin: 'http://localhost:80',
    },
  })
}

test('Retail Location routes enforce capability and scoped active grants with accurate audit evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-retail-routes-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const previousDatabaseFile = process.env.DATABASE_FILE
  initializeDatabase(databaseFile)
  const sessions = await seedSessions(databaseFile, [
    { id: 'admin-1', role: 'admin' },
    { id: 'manager-1', role: 'manager' },
    { id: 'operator-1', role: 'operator' },
  ])
  process.env.DATABASE_FILE = databaseFile
  const app = buildApp()
  const audit = new SqliteAuditRepository(databaseFile)

  try {
    await app.ready()
    const noSession = await app.inject({
      method: 'GET', url: '/api/v1/retail/locations/missing',
    })
    equal(noSession.statusCode, 401)

    const locationAResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'STORE-A', name: 'Store A', type: 'store',
        status: 'active', role: 'admin', capability: 'retail:access:manage',
      },
    })
    equal(locationAResponse.statusCode, 201)
    const locationA = (locationAResponse.json() as { location: { id: string } }).location
    const locationBResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: { code: 'STORE-B', name: 'Store B', type: 'store' },
    })
    equal(locationBResponse.statusCode, 201)
    const locationB = (locationBResponse.json() as { location: { id: string } }).location

    const noCapability = await request(app, sessions['operator-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(noCapability.statusCode, 403)
    const noGrant = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(noGrant.statusCode, 403)

    const grant = await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationA.id}/grants`,
      payload: { userId: 'manager-1' },
    })
    equal(grant.statusCode, 200)
    const allowed = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(allowed.statusCode, 200)
    const crossLocation = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationB.id}`,
    })
    equal(crossLocation.statusCode, 403)

    const revoke = await request(app, sessions['admin-1']!, {
      method: 'DELETE',
      url: `/api/v1/retail/locations/${locationA.id}/grants/manager-1`,
    })
    equal(revoke.statusCode, 200)
    const revoked = await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${locationA.id}`,
    })
    equal(revoked.statusCode, 403)

    const inactiveResponse = await request(app, sessions['admin-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'STORE-INACTIVE', name: 'Inactive store', type: 'store', status: 'inactive',
      },
    })
    equal(inactiveResponse.statusCode, 201)
    const inactive = (inactiveResponse.json() as { location: { id: string } }).location
    equal((await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${inactive.id}/grants`,
      payload: { userId: 'manager-1' },
    })).statusCode, 200)
    equal((await request(app, sessions['manager-1']!, {
      method: 'GET', url: `/api/v1/retail/locations/${inactive.id}`,
    })).statusCode, 403)

    const auditBeforeDeniedOrFailed = (await audit.findAll()).length
    const selfGrant = await request(app, sessions['manager-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationB.id}/grants`,
      payload: { userId: 'manager-1', role: 'admin', capability: 'retail:access:manage' },
    })
    equal(selfGrant.statusCode, 403)
    const privilegePayload = await request(app, sessions['operator-1']!, {
      method: 'POST', url: '/api/v1/retail/locations',
      payload: {
        code: 'ATTACK', name: 'Attack', type: 'store', role: 'admin',
        capability: 'retail:locations:manage',
      },
    })
    equal(privilegePayload.statusCode, 403)
    const failedGrant = await request(app, sessions['admin-1']!, {
      method: 'POST', url: `/api/v1/retail/locations/${locationB.id}/grants`,
      payload: { userId: 'missing-user' },
    })
    equal(failedGrant.statusCode, 500)
    equal((await audit.findAll()).length, auditBeforeDeniedOrFailed)

    const events = await audit.findAll()
    equal(events.filter((event) => event.action === 'retail.location_created').length, 3)
    equal(events.filter((event) => event.action === 'retail.location_granted').length, 2)
    equal(events.filter((event) => event.action === 'retail.location_revoked').length, 1)
    equal(events.every((event) => event.actorUserId === 'admin-1'), true)
  } finally {
    audit.close()
    await app.close()
    if (previousDatabaseFile === undefined) delete process.env.DATABASE_FILE
    else process.env.DATABASE_FILE = previousDatabaseFile
    rmSync(directory, { recursive: true, force: true })
  }
})
