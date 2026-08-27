import {
  closeSync,
  existsSync,
  openSync,
  rmSync,
} from 'node:fs'
import {
  backup,
  type DatabaseSync,
} from 'node:sqlite'
import {
  checkDatabaseIntegrity,
  type DatabaseIntegrityCheckResult,
} from './databaseIntegrity.js'
import { openDatabaseConnection } from './connectionPolicy.js'

export type DatabaseBackupErrorCode =
  | 'source_not_found'
  | 'source_validation_failed'
  | 'target_exists'
  | 'backup_failed'
  | 'backup_validation_failed'

export class DatabaseBackupError extends Error {
  readonly code: DatabaseBackupErrorCode

  constructor(
    code: DatabaseBackupErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DatabaseBackupError'
    this.code = code
  }
}

export interface DatabaseBackupResult {
  path: string
  pagesCopied: number
  validation: DatabaseIntegrityCheckResult
}

export interface DatabaseBackupOptions {
  runBackup?: typeof backup
}

function reserveBackupTarget(targetFile: string): void {
  try {
    const descriptor = openSync(targetFile, 'wx')
    closeSync(descriptor)
  } catch {
    throw new DatabaseBackupError(
      'target_exists',
      'Backup target already exists or cannot be created.',
    )
  }
}

export async function createVerifiedDatabaseBackup(
  sourceFile: string,
  targetFile: string,
  options: DatabaseBackupOptions = {},
): Promise<DatabaseBackupResult> {
  if (!existsSync(sourceFile)) {
    throw new DatabaseBackupError(
      'source_not_found',
      'Source database file does not exist.',
    )
  }

  try {
    checkDatabaseIntegrity(sourceFile)
  } catch {
    throw new DatabaseBackupError(
      'source_validation_failed',
      'Source database validation failed.',
    )
  }

  if (existsSync(targetFile)) {
    throw new DatabaseBackupError(
      'target_exists',
      'Backup target already exists or cannot be created.',
    )
  }

  let sourceDatabase: DatabaseSync | undefined
  let targetReserved = false
  let backupCompleted = false

  try {
    reserveBackupTarget(targetFile)
    targetReserved = true
    sourceDatabase = openDatabaseConnection(sourceFile, {
      readOnly: true,
    })
    const pagesCopied = await (options.runBackup ?? backup)(
      sourceDatabase,
      targetFile,
    )
    backupCompleted = true
    sourceDatabase.close()
    sourceDatabase = undefined

    const validation = checkDatabaseIntegrity(targetFile)

    return {
      path: targetFile,
      pagesCopied,
      validation,
    }
  } catch (error) {
    if (targetReserved) {
      rmSync(targetFile, { force: true })
    }

    if (error instanceof DatabaseBackupError) {
      throw error
    }

    if (backupCompleted) {
      throw new DatabaseBackupError(
        'backup_validation_failed',
        'Backup database validation failed.',
      )
    }

    throw new DatabaseBackupError(
      'backup_failed',
      'Database backup could not be completed.',
    )
  } finally {
    sourceDatabase?.close()
  }
}
