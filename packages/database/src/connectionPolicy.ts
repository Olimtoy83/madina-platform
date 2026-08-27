import {
  DatabaseSync,
  type DatabaseSyncOptions,
} from 'node:sqlite'

export const SQLITE_BUSY_TIMEOUT_MS = 5_000

export function configureDatabaseConnection(
  database: DatabaseSync,
): void {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
}

export function openDatabaseConnection(
  filename: string,
  options?: DatabaseSyncOptions,
): DatabaseSync {
  const database = options === undefined
    ? new DatabaseSync(filename)
    : new DatabaseSync(filename, options)

  try {
    configureDatabaseConnection(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
