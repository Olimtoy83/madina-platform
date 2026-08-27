import { getDatabaseFile } from '../database.js'
import {
  getBackupDirectory,
  runDatabaseBackup,
} from './databaseBackup.js'

try {
  const result = await runDatabaseBackup(
    getDatabaseFile(),
    getBackupDirectory(),
  )
  process.stdout.write(`Database backup created: ${result.path}\n`)
  process.stdout.write('Backup validation passed.\n')
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'Database backup failed.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
