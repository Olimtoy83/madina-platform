import {
  initializeDatabase,
  SqliteAuthRepository,
} from '@madina/database'
import { bootstrapAdmin } from './bootstrapAdmin.js'
import { createBootstrapAdminTerminal } from './terminal.js'
import {
  ensureDatabaseDirectory,
  getDatabaseFile,
} from '../database.js'

const terminal = createBootstrapAdminTerminal()
const databaseFile = getDatabaseFile()

ensureDatabaseDirectory(databaseFile)

let repository: SqliteAuthRepository | undefined

try {
  initializeDatabase(databaseFile)
  repository = new SqliteAuthRepository(databaseFile)
  const username = await terminal.prompt('Username: ')
  const password = await terminal.promptSecret('Password: ')
  const passwordConfirmation = await terminal.promptSecret('Confirm password: ')
  const admin = await bootstrapAdmin(repository, {
    username,
    password,
    passwordConfirmation,
  })

  terminal.writeLine(
    `Created active admin ${admin.username} (${admin.id}).`,
  )
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'Unable to bootstrap the first admin.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
} finally {
  repository?.close()
  terminal.close()
}
