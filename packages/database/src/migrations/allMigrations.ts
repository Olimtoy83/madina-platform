import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { authMigrations } from './authMigrations.js'
import { domainMigrations } from './domainSchema.js'

export const allMigrations: readonly SqliteMigration[] = [
  ...authMigrations,
  ...domainMigrations,
]
