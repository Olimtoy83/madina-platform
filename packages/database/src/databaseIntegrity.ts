import { existsSync } from 'node:fs'
import { openDatabaseConnection } from './connectionPolicy.js'

interface IntegrityCheckRow {
  integrity_check: string
}

export type DatabaseIntegrityCheckErrorCode =
  | 'database_not_found'
  | 'database_unreadable'
  | 'integrity_check_failed'
  | 'foreign_key_check_failed'

export class DatabaseIntegrityCheckError extends Error {
  readonly code: DatabaseIntegrityCheckErrorCode

  constructor(
    code: DatabaseIntegrityCheckErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DatabaseIntegrityCheckError'
    this.code = code
  }
}

export interface DatabaseIntegrityCheckResult {
  integrityCheck: 'ok'
  foreignKeyViolations: 0
}

export function checkDatabaseIntegrity(
  filename: string,
): DatabaseIntegrityCheckResult {
  if (!existsSync(filename)) {
    throw new DatabaseIntegrityCheckError(
      'database_not_found',
      'Database file does not exist.',
    )
  }

  let database: ReturnType<typeof openDatabaseConnection> | undefined

  try {
    database = openDatabaseConnection(filename, { readOnly: true })
    const integrityRows = database.prepare(
      'PRAGMA integrity_check',
    ).all() as unknown as IntegrityCheckRow[]

    if (
      integrityRows.length !== 1 ||
      integrityRows[0]?.integrity_check !== 'ok'
    ) {
      throw new DatabaseIntegrityCheckError(
        'integrity_check_failed',
        'Database integrity check failed.',
      )
    }

    const foreignKeyViolations = database.prepare(
      'PRAGMA foreign_key_check',
    ).all()

    if (foreignKeyViolations.length !== 0) {
      throw new DatabaseIntegrityCheckError(
        'foreign_key_check_failed',
        'Database foreign key check failed.',
      )
    }

    return {
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
    }
  } catch (error) {
    if (error instanceof DatabaseIntegrityCheckError) {
      throw error
    }

    throw new DatabaseIntegrityCheckError(
      'database_unreadable',
      'Database integrity check could not be completed.',
    )
  } finally {
    database?.close()
  }
}
