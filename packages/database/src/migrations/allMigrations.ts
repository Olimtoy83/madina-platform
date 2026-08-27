import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { authMigrations } from './authMigrations.js'
import { auditMigrations } from './auditMigrations.js'
import { domainMigrations } from './domainSchema.js'

export const allMigrations: readonly SqliteMigration[] = [
  ...authMigrations,
  ...domainMigrations,
  ...auditMigrations,
]
