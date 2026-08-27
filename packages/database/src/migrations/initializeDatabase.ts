import { DatabaseSync } from 'node:sqlite'
import { allMigrations } from './allMigrations.js'
import { applyMigrations } from './SqliteMigrationRunner.js'

export function initializeDatabase(filename: string): void {
  const database = new DatabaseSync(filename)

  try {
    database.exec('PRAGMA foreign_keys = ON')
    applyMigrations(database, allMigrations)
  } finally {
    database.close()
  }
}
