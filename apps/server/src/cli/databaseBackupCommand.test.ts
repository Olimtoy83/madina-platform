import {
  equal,
  match,
} from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  checkDatabaseIntegrity,
  initializeDatabase,
} from '@madina/database'
import { createBackupDestination } from './databaseBackup.js'

function runCommand(
  databaseFile: string,
  backupDirectory: string,
) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'cli', 'databaseBackupCommand.js')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_FILE: databaseFile,
        MADINA_BACKUP_DIR: backupDirectory,
      },
    },
  )
}

function withFiles(
  run: (databaseFile: string, backupDirectory: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-database-backup-cli-'))
  const databaseFile = join(directory, 'madina.sqlite')
  const backupDirectory = join(directory, 'backups')

  try {
    run(databaseFile, backupDirectory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('db:backup CLI creates a verified backup', () => {
  withFiles((databaseFile, backupDirectory) => {
    initializeDatabase(databaseFile)

    const result = runCommand(databaseFile, backupDirectory)

    equal(result.status, 0)
    match(result.stdout, /Database backup created:/)
    match(result.stdout, /Backup validation passed\./)
    const files = readdirSync(backupDirectory)
    equal(files.length, 1)
    equal(checkDatabaseIntegrity(join(backupDirectory, files[0]!)).integrityCheck, 'ok')
  })
})

test('db:backup CLI exits non-zero without creating a missing source database', () => {
  withFiles((databaseFile, backupDirectory) => {
    const result = runCommand(databaseFile, backupDirectory)

    equal(result.status, 1)
    match(result.stderr, /Source database file does not exist\./)
    equal(existsSync(databaseFile), false)
  })
})

test('db:backup names collisions with a deterministic numeric suffix', () => {
  withFiles((databaseFile, backupDirectory) => {
    initializeDatabase(databaseFile)
    mkdirSync(backupDirectory)
    const now = new Date('2026-08-28T12:34:56.000Z')
    const first = createBackupDestination(backupDirectory, now)
    writeFileSync(first, '')

    equal(
      createBackupDestination(backupDirectory, now),
      join(backupDirectory, 'madina-20260828T123456Z-001.sqlite'),
    )
  })
})
