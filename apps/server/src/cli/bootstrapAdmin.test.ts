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
import {
  UsernameValidationError,
  verifyPassword,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuthRepository,
} from '@madina/database'
import {
  bootstrapAdmin,
  FirstAdminAlreadyExistsError,
  PasswordConfirmationMismatchError,
} from './bootstrapAdmin.js'

const now = new Date('2026-08-27T00:00:00.000Z')
const password = 'correct horse battery staple'

async function withRepository(
  run: (repository: SqliteAuthRepository) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-bootstrap-admin-'))
  const databaseFile = join(directory, 'madina.sqlite')
  initializeDatabase(databaseFile)
  initializeDatabase(databaseFile)
  const repository = new SqliteAuthRepository(databaseFile)

  try {
    await run(repository)
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function input(overrides: Partial<{
  username: string
  password: string
  passwordConfirmation: string
}> = {}) {
  return {
    username: 'Madina.Admin',
    password,
    passwordConfirmation: password,
    ...overrides,
  }
}

test('bootstrapAdmin creates an active admin and a verifiable credential', async () => {
  await withRepository(async (repository) => {
    const admin = await bootstrapAdmin(repository, input(), now)
    const user = await repository.findUserById(admin.id)
    const credential = await repository.findCredentialByUserId(admin.id)

    equal(user?.username, 'Madina.Admin')
    equal(user?.normalizedUsername, 'madina.admin')
    equal(user?.role, 'admin')
    equal(user?.status, 'active')
    equal(await verifyPassword(password, credential!), true)
    equal(JSON.stringify(credential).includes(password), false)
  })
})

test('bootstrapAdmin rejects any second bootstrap attempt', async () => {
  await withRepository(async (repository) => {
    await bootstrapAdmin(repository, input(), now)

    await rejects(
      bootstrapAdmin(repository, input({ username: 'another.admin' }), now),
      FirstAdminAlreadyExistsError,
    )
  })
})

test('bootstrapAdmin rejects bootstrap when a non-admin user already exists', async () => {
  await withRepository(async (repository) => {
    await repository.createUser({
      id: 'existing-user',
      username: 'operator',
      normalizedUsername: 'operator',
      role: 'operator',
      status: 'active',
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    })

    await rejects(
      bootstrapAdmin(repository, input(), now),
      FirstAdminAlreadyExistsError,
    )
  })
})

test('bootstrapAdmin validates the username and password confirmation', async () => {
  await withRepository(async (repository) => {
    await rejects(
      bootstrapAdmin(repository, input({ username: '   ' }), now),
      UsernameValidationError,
    )
    await rejects(
      bootstrapAdmin(repository, input({ passwordConfirmation: 'different password' }), now),
      PasswordConfirmationMismatchError,
    )
  })
})
