import type { SqliteMigration } from './SqliteMigrationRunner.js'
import { createSqlMigration } from './SqliteMigrationRunner.js'

const auditEventsFoundation = createSqlMigration(
  '020_audit_events_v1',
  `
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      actor_user_id TEXT,
      actor_type TEXT NOT NULL CHECK (
        actor_type IN ('user', 'system', 'migration')
      ),
      request_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX audit_events_occurred_at_id_idx
      ON audit_events (occurred_at DESC, id DESC);
    CREATE INDEX audit_events_entity_occurred_at_idx
      ON audit_events (entity_type, entity_id, occurred_at DESC);
    CREATE INDEX audit_events_actor_occurred_at_idx
      ON audit_events (actor_user_id, occurred_at DESC);
    CREATE INDEX audit_events_request_id_idx
      ON audit_events (request_id);

    CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'audit_events are append-only');
    END;

    CREATE TRIGGER audit_events_no_delete
    BEFORE DELETE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'audit_events are append-only');
    END;
  `,
)

export const auditMigrations: readonly SqliteMigration[] = [
  auditEventsFoundation,
]
