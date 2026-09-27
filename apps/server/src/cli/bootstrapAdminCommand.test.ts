import {
  equal,
  rejects,
} from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { ServerConfigurationError } from '../database.js'
import { runBootstrapAdminCommand } from './bootstrapAdminCommandRunner.js'

for (const [label, databaseFile] of [
  ['absent', undefined],
  ['empty', ''],
  ['whitespace', '   '],
  ['relative', 'data/selected.sqlite'],
] as const) {
  test(`production bootstrap rejects ${label} DATABASE_FILE before side effects`, async () => {
    const temporaryRoot = realpathSync(tmpdir())
    const directory = mkdtempSync(join(temporaryRoot, 'madina-bootstrap-target-'))
    const previousDirectory = process.cwd()

    try {
      process.chdir(directory)
      await rejects(
        runBootstrapAdminCommand({
          NODE_ENV: 'production',
          DATABASE_FILE: databaseFile,
        }),
        ServerConfigurationError,
      )
      equal(existsSync(join(directory, 'data')), false)
    } finally {
      process.chdir(previousDirectory)
      equal(dirname(realpathSync(directory)), temporaryRoot)
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
