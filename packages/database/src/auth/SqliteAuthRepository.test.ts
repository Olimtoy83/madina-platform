import {
  equal,
  rejects,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type {
  AuthSession,
  User,
} from '@madina/auth'
import { hashPassword } from '@madina/auth'
import { SqliteAuthRepository } from './SqliteAuthRepository.js'

const now = new Date('2026-08-27T00:00:00.000Z')

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'Madina.Admin',
    normalizedUsername: 'madina.admin',
    email: 'admin@example.test',
    role: 'admin',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: 'token-hash-1',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date('2026-08-28T00:00:00.000Z'),
    sessionVersion: 1,
    ...overrides,
  }
}

async function withRepository(
  run: (repository: SqliteAuthRepository) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-auth-repository-'))
  const repository = new SqliteAuthRepository(join(directory, 'madina.sqlite'))

  try {
    await run(repository)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SqliteAuthRepository creates and reads a user', async () => {
  await withRepository(async (repository) => {
    await repository.createUser(createUser())

    const user = await repository.findUserByNormalizedUsername('madina.admin')
    equal(user?.username, 'Madina.Admin')
    equal(user?.email, 'admin@example.test')
    equal(user?.role, 'admin')
  })
})

test('SqliteAuthRepository enforces unique normalized usernames', async () => {
  await withRepository(async (repository) => {
    await repository.createUser(createUser())

    await rejects(
      repository.createUser(createUser({
        id: 'user-2',
        username: 'madina.admin',
      })),
    )
  })
})

test('SqliteAuthRepository persists user status, role, and session version', async () => {
  await withRepository(async (repository) => {
    const user = createUser({
      role: 'manager',
      status: 'inactive',
      sessionVersion: 3,
    })
    await repository.createUser(user)

    const saved = await repository.findUserById(user.id)
    equal(saved?.role, 'manager')
    equal(saved?.status, 'inactive')
    equal(saved?.sessionVersion, 3)
  })
})

test('SqliteAuthRepository stores credential metadata without plaintext', async () => {
  await withRepository(async (repository) => {
    await repository.createUser(createUser())
    const password = 'correct horse battery staple'
    const passwordHash = await hashPassword(password)
    await repository.saveCredential({
      userId: 'user-1',
      ...passwordHash,
      passwordChangedAt: now,
    })

    const credential = await repository.findCredentialByUserId('user-1')
    equal(credential?.algorithm, 'scrypt')
    equal(credential?.hash === password, false)
    equal(JSON.stringify(credential).includes(password), false)
    equal(credential?.N, 2 ** 17)
  })
})

test('SqliteAuthRepository persists and revokes sessions with constraints', async () => {
  await withRepository(async (repository) => {
    await repository.createUser(createUser())
    await repository.createSession(createSession())

    const session = await repository.findSessionByTokenHash('token-hash-1')
    equal(session?.userId, 'user-1')
    equal(session?.revokedAt, undefined)

    await rejects(repository.createSession(createSession({ id: 'session-2' })))
    await repository.revokeSession('session-1', now)

    const revokedSession = await repository.findSessionById('session-1')
    equal(revokedSession?.revokedAt?.toISOString(), now.toISOString())
  })
})

test('SqliteAuthRepository rolls back a failed first-admin creation', async () => {
  await withRepository(async (repository) => {
    const user = createUser()
    const passwordHash = await hashPassword('correct horse battery staple')

    await rejects(repository.createFirstAdmin(user, {
      userId: user.id,
      ...passwordHash,
      keyLength: 0,
      passwordChangedAt: now,
    }))

    equal(
      await repository.findUserByNormalizedUsername(user.normalizedUsername),
      undefined,
    )
    equal(await repository.findCredentialByUserId(user.id), undefined)
  })
})

test('SqliteAuthRepository rolls back failed user lifecycle transactions', async () => {
  await withRepository(async (repository) => {
    const user = createUser()
    const passwordHash = await hashPassword('correct horse battery staple')

    await rejects(repository.withUserManagementTransaction(async (unitOfWork) => {
      await unitOfWork.createUser(user)
      await unitOfWork.saveCredential({
        userId: user.id,
        ...passwordHash,
        passwordChangedAt: now,
      })
      throw new Error('Simulated lifecycle failure')
    }))

    equal(await repository.findUserById(user.id), undefined)
    equal(await repository.findCredentialByUserId(user.id), undefined)
  })
})
