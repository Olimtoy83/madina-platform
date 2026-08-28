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
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  UsernameValidationError,
  verifyPassword,
} from '@madina/auth'
import {
  initializeDatabase,
  SqliteAuthRepository,
  SqliteAuditRepository,
} from '@madina/database'
import {
  bootstrapAdmin,
  FirstAdminAlreadyExistsError,
  PasswordConfirmationMismatchError,
} from './bootstrapAdmin.js'

const now = new Date('2026-08-27T00:00:00.000Z')
const password = 'correct horse battery staple'

async function withRepository(
  run: (repository: SqliteAuthRepository, databaseFile: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-bootstrap-admin-'))
  const databaseFile = join(directory, 'madina.sqlite')
  initializeDatabase(databaseFile)
  initializeDatabase(databaseFile)
  const repository = new SqliteAuthRepository(databaseFile)

  try {
    await run(repository, databaseFile)
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

test('bootstrapAdmin creates an active admin, credential, and system audit event', async () => {
  await withRepository(async (repository, databaseFile) => {
    const admin = await bootstrapAdmin(repository, input(), now)
    const user = await repository.findUserById(admin.id)
    const credential = await repository.findCredentialByUserId(admin.id)

    equal(user?.username, 'Madina.Admin')
    equal(user?.normalizedUsername, 'madina.admin')
    equal(user?.role, 'admin')
    equal(user?.status, 'active')
    equal(await verifyPassword(password, credential!), true)
    equal(JSON.stringify(credential).includes(password), false)
    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      const events = await auditRepository.findAll()
      equal(events.length, 1)
      const [event] = events
      equal(event?.action, 'user.bootstrap_admin_created')
      equal(event?.actorType, 'system')
      equal(event?.actorUserId, undefined)
      equal(event?.domain, 'users')
      equal(event?.entityType, 'user')
      equal(event?.entityId, admin.id)
      equal(
        /^cli:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          event?.requestId ?? '',
        ),
        true,
      )
      const serializedEvents = JSON.stringify(events)
      equal(serializedEvents.includes(password), false)
      equal(serializedEvents.includes(credential!.hash), false)
      equal(serializedEvents.includes(credential!.salt), false)
    } finally {
      auditRepository.close()
    }
  })
})

test('bootstrapAdmin rejects any second bootstrap attempt without another audit event', async () => {
  await withRepository(async (repository, databaseFile) => {
    await bootstrapAdmin(repository, input(), now)

    await rejects(
      bootstrapAdmin(repository, input({ username: 'another.admin' }), now),
      FirstAdminAlreadyExistsError,
    )

    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      equal((await auditRepository.findAll()).length, 1)
    } finally {
      auditRepository.close()
    }
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

test('bootstrapAdmin rolls back user, credential, and audit event when audit insert fails', async () => {
  await withRepository(async (repository, databaseFile) => {
    const database = new DatabaseSync(databaseFile)
    database.exec(`CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit failure'); END;`)
    database.close()

    await rejects(
      bootstrapAdmin(repository, input(), now),
      /audit failure/,
    )

    equal(await repository.findUserByNormalizedUsername('madina.admin'), undefined)
    const verificationDatabase = new DatabaseSync(databaseFile)
    try {
      const credentialCount = verificationDatabase.prepare(
        'SELECT COUNT(*) AS count FROM user_credentials',
      ).get() as { count: number }
      equal(credentialCount.count, 0)
    } finally {
      verificationDatabase.close()
    }
    const auditRepository = new SqliteAuditRepository(databaseFile)
    try {
      equal((await auditRepository.findAll()).length, 0)
    } finally {
      auditRepository.close()
    }
  })
})
