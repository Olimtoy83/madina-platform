import {
  deepEqual,
  equal,
  throws,
} from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { openDatabaseConnection } from '../connectionPolicy.js'
import { allMigrations } from './allMigrations.js'
import { applyMigrations } from './SqliteMigrationRunner.js'

function withDatabaseFile(run: (filename: string) => void): void {
  const directory = mkdtempSync(
    join(tmpdir(), 'madina-retail-offline-conflict-resolution-migration-'),
  )
  const filename = join(directory, 'madina.sqlite')

  try {
    run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function seedLegacyMaterializedConflict(database: DatabaseSync): void {
  // This is the smallest complete 043 materialization graph. It mirrors the
  // immutable records written by the conflict materializer before 044 adds the
  // lifecycle projection, instead of inventing a partial incident row.
  database.exec(`
    INSERT INTO users (id, username, normalized_username, email, role, status, session_version, created_at, updated_at)
    VALUES ('manager-1', 'manager-1', 'manager-1', 'manager-1@example.test', 'manager', 'active', 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_locations (id, code, name, type, status, created_at, updated_at, currency_code, currency_exponent)
    VALUES ('location-1', 'STORE-1', 'Store 1', 'store', 'active', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', 'SAR', 2);
    INSERT INTO retail_products (id, source_id, name, status, base_unit, created_at, updated_at)
    VALUES ('product-1', 'SOURCE-1', 'Product 1', 'active', 'piece', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_offline_terminals (id, location_id, current_key_version, enrolled_by_user_id, enrolled_at, updated_at)
    VALUES ('terminal-1', 'location-1', 1, 'manager-1', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_offline_terminal_keys (terminal_id, key_version, key_algorithm, public_key, created_at, created_by_user_id)
    VALUES ('terminal-1', 1, 'ed25519', 'test-public-key', '2026-09-22T00:00:00.000Z', 'manager-1');
    INSERT INTO retail_offline_authorities (id, authority_version, terminal_id, terminal_key_version, user_id, location_id, issued_at, expires_at, currency_code, currency_exponent, payment_method, discounts_allowed, permit_count, issued_by_user_id)
    VALUES ('authority-1', 1, 'terminal-1', 1, 'manager-1', 'location-1', '2026-09-22T00:00:00.000Z', '2026-09-23T00:00:00.000Z', 'SAR', 2, 'cash', 0, 1, 'manager-1');
    INSERT INTO retail_offline_authority_permits (id, authority_id, sequence)
    VALUES ('permit-1', 'authority-1', 0);
    INSERT INTO retail_sales (id, location_id, status, currency_code, currency_exponent, subtotal_minor, payable_total_minor, created_at, completed_at)
    VALUES ('sale-1', 'location-1', 'completed', 'SAR', 2, 100, 100, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_sale_items (id, sale_id, product_id, quantity, unit_price_minor, line_total_minor)
    VALUES ('sale-item-1', 'sale-1', 'product-1', 1, 100, 100);
    INSERT INTO retail_inventory_movements (id, product_id, location_id, quantity_delta, movement_type, source_type, source_id, source_line_id, created_at)
    VALUES ('movement-1', 'product-1', 'location-1', -1, 'sale', 'retail_offline_stock_conflict_materialization', 'offline-operation-1', 'sale-item-1', '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_offline_stock_conflict_verifications (offline_operation_id, authority_id, authority_version, permit_id, terminal_id, terminal_key_version, user_id, location_id, currency_code, currency_exponent, proposed_sale_id, cash_allocation_id, claimed_completed_at, canonical_payload, payload_hash, signature, first_received_at, verified_at, verification_schema_version)
    VALUES ('offline-operation-1', 'authority-1', 1, 'permit-1', 'terminal-1', 1, 'manager-1', 'location-1', 'SAR', 2, 'sale-1', 'cash-allocation-1', '2026-09-22T00:00:00.000Z', 'canonical-payload-1', 'verification-payload-hash-1', 'signature-1', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', 1);
    INSERT INTO retail_offline_stock_conflict_verification_lines (offline_operation_id, sale_item_id, product_id, quantity, authorized_unit_price_minor, observed_on_hand_quantity, initial_deficit_quantity)
    VALUES ('offline-operation-1', 'sale-item-1', 'product-1', 1, 100, 0, 1);
    INSERT INTO retail_offline_stock_conflict_materialization_receipts (command_id, offline_operation_id, payload_hash, sale_id, materialized_at, materialized_by)
    VALUES ('materialize-command-1', 'offline-operation-1', 'materialize-payload-hash-1', 'sale-1', '2026-09-22T00:00:00.000Z', 'manager-1');
    INSERT INTO retail_offline_stock_conflict_incidents (offline_operation_id, sale_item_id, location_id, product_id, sale_id, movement_id, authority_id, permit_id, terminal_id, terminal_key_version, observed_on_hand_quantity, sold_quantity, resulting_on_hand_quantity, initial_deficit_quantity, materialization_deficit_quantity, status, policy_version, opened_at)
    VALUES ('offline-operation-1', 'sale-item-1', 'location-1', 'product-1', 'sale-1', 'movement-1', 'authority-1', 'permit-1', 'terminal-1', 1, 0, 1, -1, 1, 1, 'open', 1, '2026-09-22T00:00:00.000Z');
    INSERT INTO retail_offline_stock_conflict_incident_lifecycle (offline_operation_id, sale_item_id, location_id, product_id, current_state, version, updated_at, updated_by)
    VALUES ('offline-operation-1', 'sale-item-1', 'location-1', 'product-1', 'under_review', 2, '2026-09-22T00:01:00.000Z', 'manager-1');
    INSERT INTO retail_offline_stock_conflict_incident_events (event_id, offline_operation_id, sale_item_id, event_type, previous_state, resulting_state, command_id, payload_hash, actor_user_id, occurred_at)
    VALUES ('event-review-1', 'offline-operation-1', 'sale-item-1', 'review_started', 'open', 'under_review', 'review-command-1', 'review-payload-hash-1', 'manager-1', '2026-09-22T00:01:00.000Z');
  `)
}

test('migration 045 is registered immediately after migration 044', () => {
  const migration044 = '044_retail_offline_stock_conflict_lifecycle_v1'
  const migration045 = '045_retail_offline_stock_conflict_resolution_v1'
  const ids = allMigrations.map((migration) => migration.id)

  equal(ids.filter((id) => id === migration045).length, 1)
  equal(ids.indexOf(migration045), ids.indexOf(migration044) + 1)
})

test('migration 045 upgrades 044 lifecycle state without losing immutable history', () => {
  withDatabaseFile((filename) => {
    const database = openDatabaseConnection(filename)

    try {
      const migrationsThrough044 = allMigrations.filter(
        (migration) =>
          migration.id <= '044_retail_offline_stock_conflict_lifecycle_v1',
      )

      applyMigrations(database, migrationsThrough044)

      seedLegacyMaterializedConflict(database)

      applyMigrations(database, allMigrations)

      deepEqual(
        {
          ...database.prepare(`
            SELECT
              offline_operation_id,
              sale_item_id,
              location_id,
              product_id,
              current_state,
              version,
              updated_at,
              updated_by
            FROM retail_offline_stock_conflict_incident_lifecycle
            WHERE offline_operation_id = 'offline-operation-1'
              AND sale_item_id = 'sale-item-1'
          `).get(),
        },
        {
          offline_operation_id: 'offline-operation-1',
          sale_item_id: 'sale-item-1',
          location_id: 'location-1',
          product_id: 'product-1',
          current_state: 'under_review',
          version: 2,
          updated_at: '2026-09-22T00:01:00.000Z',
          updated_by: 'manager-1',
        },
      )

      deepEqual(
        {
          ...database.prepare(`
            SELECT
              event_id,
              offline_operation_id,
              sale_item_id,
              event_type,
              previous_state,
              resulting_state,
              command_id,
              payload_hash,
              actor_user_id,
              occurred_at
            FROM retail_offline_stock_conflict_incident_events
            WHERE event_id = 'event-review-1'
          `).get(),
        },
        {
          event_id: 'event-review-1',
          offline_operation_id: 'offline-operation-1',
          sale_item_id: 'sale-item-1',
          event_type: 'review_started',
          previous_state: 'open',
          resulting_state: 'under_review',
          command_id: 'review-command-1',
          payload_hash: 'review-payload-hash-1',
          actor_user_id: 'manager-1',
          occurred_at: '2026-09-22T00:01:00.000Z',
        },
      )

      equal(
        (
          database.prepare(`
            SELECT COUNT(*) AS count
            FROM retail_offline_stock_conflict_resolution_evidence
          `).get() as { count: number }
        ).count,
        0,
      )

      equal(
        (
          database.prepare(`
            SELECT COUNT(*) AS count
            FROM schema_migrations
            WHERE id = '045_retail_offline_stock_conflict_resolution_v1'
          `).get() as { count: number }
        ).count,
        1,
      )

      database.prepare(`
        UPDATE retail_offline_stock_conflict_incident_lifecycle
        SET
          current_state = 'resolved',
          version = 3,
          updated_at = '2026-09-22T00:02:00.000Z'
        WHERE offline_operation_id = 'offline-operation-1'
          AND sale_item_id = 'sale-item-1'
      `).run()

      equal(
        (
          database.prepare(`
            SELECT current_state
            FROM retail_offline_stock_conflict_incident_lifecycle
            WHERE offline_operation_id = 'offline-operation-1'
              AND sale_item_id = 'sale-item-1'
          `).get() as { current_state: string }
        ).current_state,
        'resolved',
      )

      throws(
        () =>
          database.prepare(`
            UPDATE retail_offline_stock_conflict_incident_events
            SET command_id = 'mutated'
            WHERE event_id = 'event-review-1'
          `).run(),
        /immutable/,
      )

      throws(
        () =>
          database.prepare(`
            DELETE FROM retail_offline_stock_conflict_incident_lifecycle
            WHERE offline_operation_id = 'offline-operation-1'
              AND sale_item_id = 'sale-item-1'
          `).run(),
        /cannot be deleted/,
      )
    } finally {
      database.close()
    }
  })
})
