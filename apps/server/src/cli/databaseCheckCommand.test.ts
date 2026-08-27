import {
  equal,
  match,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { initializeDatabase } from '@madina/database'

function runCommand(databaseFile: string) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'cli', 'databaseCheckCommand.js')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_FILE: databaseFile,
      },
    },
  )
}

function withDatabaseFile(run: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-database-check-cli-'))
  const filename = join(directory, 'madina.sqlite')

  try {
    run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('db:check CLI exits successfully for a healthy database', () => {
  withDatabaseFile((filename) => {
    initializeDatabase(filename)

    const result = runCommand(filename)

    equal(result.status, 0)
    match(result.stdout, /Database integrity check passed\./)
    equal(result.stderr, '')
  })
})

test('db:check CLI exits non-zero without creating a missing database', () => {
  withDatabaseFile((filename) => {
    const result = runCommand(filename)

    equal(result.status, 1)
    match(result.stderr, /Database file does not exist\./)
  })
})
