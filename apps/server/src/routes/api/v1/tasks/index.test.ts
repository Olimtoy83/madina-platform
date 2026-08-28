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
  const sessionSecret = 'tasks-audit-test-session'
  const timestamp = new Date()
  const user: User = {
    id: 'tasks-audit-admin', username: 'tasks.audit.admin',
    normalizedUsername: 'tasks.audit.admin', role: 'admin',
    status: 'active', sessionVersion: 1,
    createdAt: timestamp, updatedAt: timestamp,
  }
  try {
    await repository.createUser(user)
    await repository.createSession({
      id: 'tasks-audit-session', userId: user.id,
      tokenHash: hashSessionSecret(sessionSecret),
      createdAt: timestamp, lastSeenAt: timestamp,
      expiresAt: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000),
      sessionVersion: user.sessionVersion,
    })
  } finally {
    repository.close()
  }
  return sessionSecret
}

async function withApp(
  run: (app: FastifyInstance, databaseFile: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-tasks-audit-'))
  const databaseFile = join(directory, 'tasks.sqlite')
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

function importTask(id: string, title: string) {
  return {
    id, title, createdAt: now, updatedAt: now,
    status: 'todo' as const, priority: 'medium' as const,
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

test('task create, update, and delete append attributed audit events', async () => {
  await withApp(async (app, databaseFile) => {
    const suppliedRequestId = 'client-controlled-request-id'
    const created = await app.inject({
      method: 'POST', url: '/api/v1/tasks',
      headers: { 'x-request-id': suppliedRequestId },
      payload: { title: 'Проверить остатки', status: 'todo', priority: 'medium' },
    })
    equal(created.statusCode, 201)
    const taskId = (created.json() as { id: string }).id
    equal((await app.inject({
      method: 'PATCH', url: `/api/v1/tasks/${taskId}`,
      payload: { status: 'completed' },
    })).statusCode, 200)
    equal((await app.inject({
      method: 'DELETE', url: `/api/v1/tasks/${taskId}`,
    })).statusCode, 204)

    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      deepEqual(events.map((event) => event.action).sort(), [
        'task.created', 'task.deleted', 'task.updated',
      ])
      for (const event of events) {
        equal(event.domain, 'tasks')
        equal(event.actorType, 'user')
        equal(event.actorUserId, 'tasks-audit-admin')
        equal(event.entityId, taskId)
        equal(isUuid(event.requestId), true)
      }
      equal(events.some((event) => event.requestId === suppliedRequestId), false)
    } finally {
      auditRepository.close()
    }
  })
})

test('task import is atomic, rejects duplicates, and audits every successful repeat', async () => {
  await withApp(async (app, databaseFile) => {
    const payload = {
      tasks: [
        importTask('task-import-1', 'Первая'),
        importTask('task-import-2', 'Вторая'),
      ],
    }
    deepEqual((await app.inject({
      method: 'POST', url: '/api/v1/tasks/import', payload,
    })).json(), { created: 2, updated: 0 })
    deepEqual((await app.inject({
      method: 'POST', url: '/api/v1/tasks/import', payload,
    })).json(), { created: 0, updated: 2 })
    equal((await app.inject({
      method: 'POST', url: '/api/v1/tasks/import',
      payload: { tasks: [
        importTask('task-invalid-1', 'Валидная'),
        { ...importTask('task-invalid-2', 'Ошибка'), dueDate: 'invalid-date' },
      ] },
    })).statusCode, 400)
    equal((await app.inject({
      method: 'POST', url: '/api/v1/tasks/import',
      payload: { tasks: [
        importTask('task-duplicate', 'Первая'),
        importTask('task-duplicate', 'Вторая'),
      ] },
    })).statusCode, 400)
    const listed = await app.inject({ method: 'GET', url: '/api/v1/tasks' })
    equal((listed.json() as { tasks: unknown[] }).tasks.length, 2)
    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      equal(events.length, 2)
      for (const event of events) {
        equal(event.action, 'tasks.imported')
        equal(event.entityType, 'task_import')
        equal(event.entityId, 'tasks-import')
        equal(event.actorUserId, 'tasks-audit-admin')
      }
    } finally {
      auditRepository.close()
    }
  })
})
