import { equal } from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SqliteAuthRepository } from './auth/SqliteAuthRepository.js'
import {
  openDatabaseConnection,
  SQLITE_BUSY_TIMEOUT_MS,
} from './connectionPolicy.js'
import { SqliteCommerceRepository } from './commerce/SqliteCommerceRepository.js'
import { initializeDatabase } from './migrations/initializeDatabase.js'
import { SqliteClientRepository } from './clients/SqliteClientRepository.js'
import { SqliteTaskRepository } from './tasks/SqliteTaskRepository.js'

interface RepositoryConnection {
  database: DatabaseSync
}

function policyValue(
  database: DatabaseSync,
  pragma: 'foreign_keys' | 'busy_timeout',
): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, number>
  return row[pragma === 'foreign_keys' ? 'foreign_keys' : 'timeout']
}

function repositoryDatabase(repository: unknown): DatabaseSync {
  return (repository as RepositoryConnection).database
}

test('every production-style database connection applies the SQLite policy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'madina-connection-policy-'))
  const filename = join(directory, 'madina.sqlite')
  const initializer = openDatabaseConnection(filename)

  try {
    equal(policyValue(initializer, 'foreign_keys'), 1)
    equal(policyValue(initializer, 'busy_timeout'), SQLITE_BUSY_TIMEOUT_MS)
  } finally {
    initializer.close()
  }

  initializeDatabase(filename)
  const auth = new SqliteAuthRepository(filename)
  const clients = new SqliteClientRepository(filename)
  const tasks = new SqliteTaskRepository(filename)
  const commerce = new SqliteCommerceRepository(filename)

  try {
    for (const repository of [auth, clients, tasks, commerce]) {
      const database = repositoryDatabase(repository)
      equal(policyValue(database, 'foreign_keys'), 1)
      equal(policyValue(database, 'busy_timeout'), SQLITE_BUSY_TIMEOUT_MS)
    }
  } finally {
    auth.close()
    clients.close()
    tasks.close()
    commerce.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
