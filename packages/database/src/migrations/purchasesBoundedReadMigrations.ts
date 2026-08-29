import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { createSqlMigration } from './SqliteMigrationRunner.js'

const purchasesBoundedReadIndex = createSqlMigration(
  '015_purchases_bounded_read_index_v1',
  `
    CREATE INDEX purchases_purchase_date_id_idx
      ON purchases (purchase_date DESC, id DESC);
  `,
)

export const purchasesBoundedReadMigrations: readonly SqliteMigration[] = [
  purchasesBoundedReadIndex,
]
