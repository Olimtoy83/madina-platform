import { createSqlMigration } from './SqliteMigrationRunner.js'

const retailAccessLocations = createSqlMigration('031_retail_access_locations_v1', `
  CREATE TABLE retail_locations (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('central_warehouse', 'store')),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE retail_user_location_grants (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    PRIMARY KEY (user_id, location_id)
  );
  CREATE INDEX retail_location_grants_active_location_idx
    ON retail_user_location_grants (location_id, user_id) WHERE revoked_at IS NULL;
`)

export const retailMigrations = [retailAccessLocations] as const
