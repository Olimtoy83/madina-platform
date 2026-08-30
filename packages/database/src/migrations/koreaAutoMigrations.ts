import { createSqlMigration } from './SqliteMigrationRunner.js'

const koreaAutoVehiclesFoundation = createSqlMigration(
  '030_korea_auto_vehicles_v1',
  `
    CREATE TABLE korea_auto_vehicles (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL CHECK (year BETWEEN 1886 AND 2100),
      status TEXT NOT NULL CHECK (status IN ('available', 'inactive'))
    );

    CREATE INDEX korea_auto_vehicles_created_at_id_idx
      ON korea_auto_vehicles (created_at DESC, id DESC);
  `,
)

export const koreaAutoMigrations: readonly ReturnType<
  typeof createSqlMigration
>[] = [
  koreaAutoVehiclesFoundation,
]
