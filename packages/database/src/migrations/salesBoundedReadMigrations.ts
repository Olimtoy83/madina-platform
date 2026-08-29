import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { createSqlMigration } from './SqliteMigrationRunner.js'

const salesBoundedReadIndexes = createSqlMigration(
  '014_sales_bounded_read_indexes_v1',
  `
    CREATE INDEX sales_sale_date_id_idx
      ON sales (sale_date DESC, id DESC);
    CREATE INDEX sales_client_status_sale_date_id_idx
      ON sales (client_id, status, sale_date DESC, id DESC);
  `,
)

export const salesBoundedReadMigrations: readonly SqliteMigration[] = [
  salesBoundedReadIndexes,
]
