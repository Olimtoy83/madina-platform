import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { authMigrations } from './authMigrations.js'
import { auditMigrations } from './auditMigrations.js'
import { domainMigrations } from './domainSchema.js'
import { stockMovementHistoryMigrations } from './stockMovementHistoryMigrations.js'
import { salesBoundedReadMigrations } from './salesBoundedReadMigrations.js'
import { purchasesBoundedReadMigrations } from './purchasesBoundedReadMigrations.js'
import { koreaAutoMigrations } from './koreaAutoMigrations.js'

export const allMigrations: readonly SqliteMigration[] = [
  ...authMigrations,
  ...domainMigrations,
  ...stockMovementHistoryMigrations,
  ...salesBoundedReadMigrations,
  ...purchasesBoundedReadMigrations,
  ...auditMigrations,
  ...koreaAutoMigrations,
]
