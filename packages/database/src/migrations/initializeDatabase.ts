import { openDatabaseConnection } from '../connectionPolicy.js'
import { allMigrations } from './allMigrations.js'
import { applyMigrations } from './SqliteMigrationRunner.js'

export function initializeDatabase(filename: string): void {
  const database = openDatabaseConnection(filename)

  try {
    applyMigrations(database, allMigrations)
  } finally {
    database.close()
  }
}
