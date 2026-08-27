import {
  equal,
  throws,
} from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  checkDatabaseIntegrity,
  DatabaseIntegrityCheckError,
} from './databaseIntegrity.js'
import { clientsSchemaSql } from './migrations/domainSchema.js'
import { initializeDatabase } from './migrations/initializeDatabase.js'

function withDatabaseFile(run: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-database-integrity-'))
  const filename = join(directory, 'madina.sqlite')

  try {
    run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('checkDatabaseIntegrity succeeds for a fresh initialized database', () => {
  withDatabaseFile((filename) => {
    initializeDatabase(filename)

    equal(checkDatabaseIntegrity(filename).integrityCheck, 'ok')
  })
})

test('checkDatabaseIntegrity succeeds for an adopted legacy database', () => {
  withDatabaseFile((filename) => {
    const database = new DatabaseSync(filename)
    try {
      database.exec(clientsSchemaSql)
    } finally {
      database.close()
    }

    initializeDatabase(filename)

    equal(checkDatabaseIntegrity(filename).foreignKeyViolations, 0)
  })
})

test('checkDatabaseIntegrity rejects foreign key violations', () => {
  withDatabaseFile((filename) => {
    initializeDatabase(filename)
    const database = new DatabaseSync(filename)
    try {
      database.exec('PRAGMA foreign_keys = OFF')
      database.prepare(`
        INSERT INTO user_credentials (
          user_id, password_hash, salt, algorithm, version, scrypt_n,
          scrypt_r, scrypt_p, key_length, password_changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'missing-user', 'hash', 'salt', 'scrypt', 1, 2, 1, 1, 1,
        '2026-08-28T00:00:00.000Z',
      )
    } finally {
      database.close()
    }

    throws(
      () => checkDatabaseIntegrity(filename),
      (error: unknown) =>
        error instanceof DatabaseIntegrityCheckError &&
        error.code === 'foreign_key_check_failed',
    )
  })
})

test('checkDatabaseIntegrity does not create a missing database file', () => {
  withDatabaseFile((filename) => {
    throws(
      () => checkDatabaseIntegrity(filename),
      (error: unknown) =>
        error instanceof DatabaseIntegrityCheckError &&
        error.code === 'database_not_found',
    )
    equal(existsSync(filename), false)
  })
})

test('checkDatabaseIntegrity rejects an invalid SQLite file', () => {
  withDatabaseFile((filename) => {
    writeFileSync(filename, 'not a SQLite database')

    throws(
      () => checkDatabaseIntegrity(filename),
      (error: unknown) =>
        error instanceof DatabaseIntegrityCheckError &&
        error.code === 'database_unreadable',
    )
  })
})
