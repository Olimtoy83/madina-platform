import {
  equal,
  rejects,
} from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type {
  AuthSession,
  User,
} from '@madina/auth'
import type {
  Client,
  Product,
  Task,
} from '@madina/core'
import { SqliteAuthRepository } from './auth/SqliteAuthRepository.js'
import {
  createVerifiedDatabaseBackup,
  DatabaseBackupError,
} from './databaseBackup.js'
import { checkDatabaseIntegrity } from './databaseIntegrity.js'
import { SqliteClientRepository } from './clients/SqliteClientRepository.js'
import { SqliteCommerceRepository } from './commerce/SqliteCommerceRepository.js'
import { initializeDatabase } from './migrations/initializeDatabase.js'
import { SqliteTaskRepository } from './tasks/SqliteTaskRepository.js'

const now = new Date('2026-08-28T00:00:00.000Z')

async function withDatabaseFiles(
  run: (source: string, target: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'madina-database-backup-'))
  const source = join(directory, 'source.sqlite')
  const target = join(directory, 'backup.sqlite')

  try {
    await run(source, target)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function seedRepresentativeData(filename: string): Promise<void> {
  initializeDatabase(filename)
  const auth = new SqliteAuthRepository(filename)
  const clients = new SqliteClientRepository(filename)
  const tasks = new SqliteTaskRepository(filename)
  const commerce = new SqliteCommerceRepository(filename)
  const user: User = {
    id: 'user-1', username: 'admin', normalizedUsername: 'admin',
    role: 'admin', status: 'active', sessionVersion: 1,
    createdAt: now, updatedAt: now,
  }
  const session: AuthSession = {
    id: 'session-1', userId: user.id, tokenHash: 'token-hash',
    createdAt: now, lastSeenAt: now,
    expiresAt: new Date('2026-09-04T00:00:00.000Z'),
    sessionVersion: 1,
  }
  const client: Client = {
    id: 'client-1', name: 'Мадина', status: 'active',
    createdAt: now, updatedAt: now,
  }
  const task: Task = {
    id: 'task-1', title: 'Проверить backup', status: 'todo',
    priority: 'medium', createdAt: now, updatedAt: now,
  }
  const product: Product = {
    id: 'product-1', name: 'Финики', category: 'dates', quantity: 5,
    unit: 'kg', costPrice: 100, salePrice: 150, status: 'active',
    createdAt: now, updatedAt: now,
  }

  try {
    await auth.createUser(user)
    await auth.createSession(session)
    await clients.save(client)
    await tasks.save(task)
    await commerce.saveProduct(product)
  } finally {
    auth.close()
    clients.close()
    tasks.close()
    commerce.close()
  }
}

function migrationCount(filename: string): number {
  const database = new DatabaseSync(filename)
  try {
    return (database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get() as { count: number }).count
  } finally {
    database.close()
  }
}

test('verified backup preserves representative data and remains migratable', async () => {
  await withDatabaseFiles(async (source, target) => {
    await seedRepresentativeData(source)
    const sourceMigrations = migrationCount(source)

    const result = await createVerifiedDatabaseBackup(source, target)

    equal(result.path, target)
    equal(result.validation.integrityCheck, 'ok')
    equal(result.validation.foreignKeyViolations, 0)
    equal(migrationCount(target), sourceMigrations)
    equal(checkDatabaseIntegrity(source).integrityCheck, 'ok')

    initializeDatabase(target)
    const auth = new SqliteAuthRepository(target)
    const clients = new SqliteClientRepository(target)
    const tasks = new SqliteTaskRepository(target)
    const commerce = new SqliteCommerceRepository(target)

    try {
      equal((await auth.findUserById('user-1'))?.username, 'admin')
      equal((await clients.findById('client-1'))?.name, 'Мадина')
      equal((await tasks.findById('task-1'))?.title, 'Проверить backup')
      equal((await commerce.findAllProducts())[0]?.name, 'Финики')
    } finally {
      auth.close()
      clients.close()
      tasks.close()
      commerce.close()
    }
  })
})

test('verified backup works while other source connections remain open', async () => {
  await withDatabaseFiles(async (source, target) => {
    await seedRepresentativeData(source)
    const auth = new SqliteAuthRepository(source)
    const clients = new SqliteClientRepository(source)
    const tasks = new SqliteTaskRepository(source)
    const commerce = new SqliteCommerceRepository(source)

    try {
      const result = await createVerifiedDatabaseBackup(source, target)
      equal(result.validation.integrityCheck, 'ok')
      equal(checkDatabaseIntegrity(target).foreignKeyViolations, 0)
    } finally {
      auth.close()
      clients.close()
      tasks.close()
      commerce.close()
    }
  })
})

test('verified backup does not create a missing source database', async () => {
  await withDatabaseFiles(async (source, target) => {
    await rejects(
      createVerifiedDatabaseBackup(source, target),
      (error: unknown) =>
        error instanceof DatabaseBackupError && error.code === 'source_not_found',
    )
    equal(existsSync(source), false)
    equal(existsSync(target), false)
  })
})

test('verified backup rejects an invalid source database', async () => {
  await withDatabaseFiles(async (source, target) => {
    writeFileSync(source, 'not a SQLite database')
    await rejects(
      createVerifiedDatabaseBackup(source, target),
      (error: unknown) =>
        error instanceof DatabaseBackupError &&
        error.code === 'source_validation_failed',
    )
    equal(existsSync(target), false)
  })
})

test('verified backup never overwrites an existing target', async () => {
  await withDatabaseFiles(async (source, target) => {
    await seedRepresentativeData(source)
    await createVerifiedDatabaseBackup(source, target)
    const previousBackup = readFileSync(target)

    await rejects(
      createVerifiedDatabaseBackup(source, target),
      (error: unknown) =>
        error instanceof DatabaseBackupError && error.code === 'target_exists',
    )

    equal(readFileSync(target).equals(previousBackup), true)
  })
})

test('verified backup removes its partial target when native backup fails', async () => {
  await withDatabaseFiles(async (source, target) => {
    await seedRepresentativeData(source)

    await rejects(
      createVerifiedDatabaseBackup(source, target, {
        runBackup: async () => {
          throw new Error('simulated native backup failure')
        },
      }),
      (error: unknown) =>
        error instanceof DatabaseBackupError && error.code === 'backup_failed',
    )

    equal(existsSync(target), false)
    equal(checkDatabaseIntegrity(source).integrityCheck, 'ok')
  })
})
