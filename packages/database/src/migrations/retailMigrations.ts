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

const retailProductsBarcodes = createSqlMigration('032_retail_products_barcodes_v1', `
  CREATE TABLE retail_products (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    base_unit TEXT NOT NULL CHECK (base_unit = 'piece'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE retail_product_barcodes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX retail_product_barcodes_value_idx
    ON retail_product_barcodes (value);
  CREATE INDEX retail_product_barcodes_product_idx
    ON retail_product_barcodes (product_id, value);
`)

export const retailMigrations = [retailAccessLocations, retailProductsBarcodes] as const
