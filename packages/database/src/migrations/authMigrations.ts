import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { createSqlMigration } from './SqliteMigrationRunner.js'

// This explicit no-op baseline records that existing Clients, Tasks, and
// Commerce tables predate the migration runner and remain externally managed.
const legacySchemaBaseline = createSqlMigration(
  '000_legacy_schema_baseline',
  'SELECT 1;',
)

const authFoundation = createSqlMigration(
  '001_auth_foundation',
  `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      normalized_username TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      role TEXT NOT NULL CHECK (
        role IN ('admin', 'manager', 'operator', 'viewer')
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      session_version INTEGER NOT NULL CHECK (session_version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE user_credentials (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      scrypt_n INTEGER NOT NULL CHECK (scrypt_n > 1),
      scrypt_r INTEGER NOT NULL CHECK (scrypt_r > 0),
      scrypt_p INTEGER NOT NULL CHECK (scrypt_p > 0),
      key_length INTEGER NOT NULL CHECK (key_length > 0),
      password_changed_at TEXT NOT NULL
    );

    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      session_version INTEGER NOT NULL CHECK (session_version >= 1),
      CHECK (expires_at >= created_at),
      CHECK (last_seen_at >= created_at)
    );

    CREATE INDEX auth_sessions_active_user_expiry_idx
      ON auth_sessions (user_id, expires_at)
      WHERE revoked_at IS NULL;
  `,
)

export const authMigrations: readonly SqliteMigration[] = [
  legacySchemaBaseline,
  authFoundation,
]
