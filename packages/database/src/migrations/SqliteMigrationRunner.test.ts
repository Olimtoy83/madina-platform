import {
  equal,
  throws,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { authMigrations } from './authMigrations.js'
import {
  applyMigrations,
  MigrationChecksumMismatchError,
  type SqliteMigration,
} from './SqliteMigrationRunner.js'

function withDatabase(run: (database: DatabaseSync) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-migrations-'))
  const database = new DatabaseSync(join(directory, 'madina.sqlite'))

  try {
    run(database)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('applies auth migrations to a fresh database', () => {
  withDatabase((database) => {
    applyMigrations(database, authMigrations)

    const migrations = database.prepare(
      'SELECT id FROM schema_migrations ORDER BY id',
    ).all() as Array<{ id: string }>
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'users', 'user_credentials', 'auth_sessions'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>

    equal(migrations.length, 2)
    equal(tables.length, 3)
  })
})

test('records the legacy baseline without changing existing domain data', () => {
  withDatabase((database) => {
    database.exec(`
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO clients (id, name) VALUES ('client-1', 'Мадина');
      INSERT INTO tasks (id, title) VALUES ('task-1', 'Проверить склад');
      INSERT INTO products (id, name) VALUES ('product-1', 'Финики');
    `)

    applyMigrations(database, authMigrations)

    const client = database.prepare(
      'SELECT name FROM clients WHERE id = ?',
    ).get('client-1') as { name: string }
    const task = database.prepare(
      'SELECT title FROM tasks WHERE id = ?',
    ).get('task-1') as { title: string }
    const product = database.prepare(
      'SELECT name FROM products WHERE id = ?',
    ).get('product-1') as { name: string }
    equal(client.name, 'Мадина')
    equal(task.title, 'Проверить склад')
    equal(product.name, 'Финики')
  })
})

test('does not reapply an already recorded migration', () => {
  withDatabase((database) => {
    applyMigrations(database, authMigrations)
    applyMigrations(database, authMigrations)

    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get() as { count: number }
    equal(count.count, 2)
  })
})

test('rolls back a failed migration and does not record it', () => {
  withDatabase((database) => {
    const failingMigration: SqliteMigration = {
      id: '100_failing_migration',
      checksum: 'failing-checksum',
      up(target) {
        target.exec('CREATE TABLE should_not_exist (id TEXT PRIMARY KEY)')
        throw new Error('forced failure')
      },
    }

    throws(
      () => applyMigrations(database, [failingMigration]),
      /forced failure/,
    )

    const table = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'should_not_exist'
    `).get()
    const recorded = database.prepare(`
      SELECT id FROM schema_migrations WHERE id = '100_failing_migration'
    `).get()
    equal(table, undefined)
    equal(recorded, undefined)
  })
})

test('rejects checksum changes for an applied migration', () => {
  withDatabase((database) => {
    const first: SqliteMigration = {
      id: '100_test_migration',
      checksum: 'first-checksum',
      up() {},
    }
    const changed: SqliteMigration = {
      ...first,
      checksum: 'changed-checksum',
    }

    applyMigrations(database, [first])
    throws(
      () => applyMigrations(database, [changed]),
      MigrationChecksumMismatchError,
    )
  })
})
