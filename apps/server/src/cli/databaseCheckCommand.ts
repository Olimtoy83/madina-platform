import { existsSync } from 'node:fs'
import { getDatabaseFile } from '../database.js'
import { runDatabaseCheck } from './databaseCheck.js'

const databaseFile = getDatabaseFile()

try {
  if (!existsSync(databaseFile)) {
    throw new Error('Database file does not exist.')
  }

  runDatabaseCheck(databaseFile)
  process.stdout.write('Database integrity check passed.\n')
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'Database integrity check failed.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
