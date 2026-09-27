import {
  initializeDatabase,
  SqliteAuthRepository,
} from '@madina/database'
import { bootstrapAdmin } from './bootstrapAdmin.js'
import {
  createBootstrapAdminTerminal,
  type BootstrapAdminTerminal,
} from './terminal.js'
import {
  ensureDatabaseDirectory,
  getBootstrapDatabaseFile,
} from '../database.js'

export async function runBootstrapAdminCommand(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const databaseFile = getBootstrapDatabaseFile(environment)
  process.stdout.write(`Bootstrap database: ${databaseFile}\n`)
  ensureDatabaseDirectory(databaseFile)

  let repository: SqliteAuthRepository | undefined
  let terminal: BootstrapAdminTerminal | undefined

  try {
    initializeDatabase(databaseFile)
    repository = new SqliteAuthRepository(databaseFile)
    terminal = createBootstrapAdminTerminal()
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
  } finally {
    repository?.close()
    terminal?.close()
  }
}
