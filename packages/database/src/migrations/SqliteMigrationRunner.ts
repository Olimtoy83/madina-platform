import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface SqliteMigration {
  id: string
  checksum: string
  up(database: DatabaseSync): void
}

interface AppliedMigrationRow {
  id: string
  checksum: string
}

export class MigrationChecksumMismatchError extends Error {
  constructor(migrationId: string) {
    super(`Migration checksum mismatch: ${migrationId}`)
    this.name = 'MigrationChecksumMismatchError'
  }
}

export class DuplicateMigrationIdError extends Error {
  constructor(migrationId: string) {
    super(`Duplicate migration id: ${migrationId}`)
    this.name = 'DuplicateMigrationIdError'
  }
}

export function createSqlMigration(
  id: string,
  sql: string,
): SqliteMigration {
  return {
    id,
    checksum: createHash('sha256').update(sql).digest('hex'),
    up(database) {
      database.exec(sql)
    },
  }
}

function validateMigrations(
  migrations: readonly SqliteMigration[],
): SqliteMigration[] {
  const ordered = [...migrations].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const migrationIds = new Set<string>()

  for (const migration of ordered) {
    if (migrationIds.has(migration.id)) {
      throw new DuplicateMigrationIdError(migration.id)
    }

    migrationIds.add(migration.id)
  }

  return ordered
}

function ensureMigrationsTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

export function applyMigrations(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[],
): void {
  ensureMigrationsTable(database)

  for (const migration of validateMigrations(migrations)) {
    database.exec('BEGIN IMMEDIATE')

    try {
      const applied = database.prepare(`
        SELECT id, checksum
        FROM schema_migrations
        WHERE id = ?
      `).get(migration.id) as AppliedMigrationRow | undefined

      if (applied) {
        if (applied.checksum !== migration.checksum) {
          throw new MigrationChecksumMismatchError(migration.id)
        }
      } else {
        migration.up(database)
        database.prepare(`
          INSERT INTO schema_migrations (id, checksum, applied_at)
          VALUES (?, ?, ?)
        `).run(
          migration.id,
          migration.checksum,
          new Date().toISOString(),
        )
      }

      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
