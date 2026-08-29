import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { createSqlMigration } from './SqliteMigrationRunner.js'

const stockMovementHistoryIndex = createSqlMigration(
  '013_stock_movement_history_index_v1',
  `
    CREATE INDEX stock_movements_created_at_id_idx
      ON stock_movements (created_at DESC, id DESC);
  `,
)

export const stockMovementHistoryMigrations: readonly SqliteMigration[] = [
  stockMovementHistoryIndex,
]
