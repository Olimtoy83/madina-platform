import {
  existsSync,
  mkdirSync,
} from 'node:fs'
import {
  isAbsolute,
  join,
} from 'node:path'
import {
  createVerifiedDatabaseBackup,
  type DatabaseBackupResult,
} from '@madina/database'

export class BackupDirectoryConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupDirectoryConfigurationError'
  }
}

function backupTimestamp(now: Date): string {
  return `${now.toISOString()
    .slice(0, 19)
    .replaceAll('-', '')
    .replaceAll(':', '')}Z`
}

export function getBackupDirectory(): string {
  const backupDirectory = process.env.MADINA_BACKUP_DIR

  if (!backupDirectory) {
    throw new BackupDirectoryConfigurationError(
      'MADINA_BACKUP_DIR must be configured as an absolute path.',
    )
  }

  if (!isAbsolute(backupDirectory)) {
    throw new BackupDirectoryConfigurationError(
      'MADINA_BACKUP_DIR must be configured as an absolute path.',
    )
  }

  return backupDirectory
}

export function createBackupDestination(
  backupDirectory: string,
  now = new Date(),
): string {
  const timestamp = backupTimestamp(now)
  const baseName = `madina-${timestamp}`

  for (let index = 0; ; index += 1) {
    const suffix = index === 0 ? '' : `-${String(index).padStart(3, '0')}`
    const destination = join(backupDirectory, `${baseName}${suffix}.sqlite`)

    if (!existsSync(destination)) {
      return destination
    }
  }
}

export async function runDatabaseBackup(
  databaseFile: string,
  backupDirectory: string,
  now = new Date(),
): Promise<DatabaseBackupResult> {
  mkdirSync(backupDirectory, { recursive: true })

  return createVerifiedDatabaseBackup(
    databaseFile,
    createBackupDestination(backupDirectory, now),
  )
}
