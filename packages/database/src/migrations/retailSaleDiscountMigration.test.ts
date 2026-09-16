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
import test from 'node:test'

import { openDatabaseConnection } from '../connectionPolicy.js'
import { allMigrations } from './allMigrations.js'
import { applyMigrations } from './SqliteMigrationRunner.js'

function withDatabaseFile(run: (filename: string) => void): void {
  const directory = mkdtempSync(
    join(tmpdir(), 'madina-retail-sale-discount-migration-'),
  )
  const filename = join(directory, 'madina.sqlite')

  try {
    run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('migration 038 is registered immediately after migration 037', () => {
  const migration038 = '038_retail_sale_discounts_v1'
  const migration037 = '037_retail_sales_payment_completion_v1'
  const ids = allMigrations.map((migration) => migration.id)

  equal(ids.filter((id) => id === migration038).length, 1)
  equal(ids.indexOf(migration038), ids.indexOf(migration037) + 1)
})

test('migration 038 upgrades a 037 Sale without losing immutable evidence', () => {
  withDatabaseFile((filename) => {
    const database = openDatabaseConnection(filename)

    try {
      const migrationsThrough037 = allMigrations.filter(
        (migration) =>
          migration.id <= '037_retail_sales_payment_completion_v1',
      )

      applyMigrations(database, migrationsThrough037)

      database.exec(`
        INSERT INTO retail_locations (
          id, code, name, type, status, created_at, updated_at,
          currency_code, currency_exponent
        ) VALUES (
          'location-1', 'STORE-1', 'Store 1', 'store', 'active',
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z',
          'SAR', 2
        );

        INSERT INTO retail_products (
          id, source_id, name, status, base_unit, created_at, updated_at
        ) VALUES (
          'product-1', 'SOURCE-1', 'Product 1', 'active', 'piece',
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_sales (
          id, location_id, status, currency_code, currency_exponent,
          subtotal_minor, payable_total_minor, created_at, completed_at
        ) VALUES (
          'sale-1', 'location-1', 'completed', 'SAR', 2,
          10000, 10000,
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_sale_items (
          id, sale_id, product_id, quantity,
          unit_price_minor, line_total_minor
        ) VALUES (
          'sale-item-1', 'sale-1', 'product-1', 2, 5000, 10000
        );

        INSERT INTO retail_payment_allocations (
          id, sale_id, method, amount_minor, ordinal
        ) VALUES (
          'payment-1', 'sale-1', 'cash', 10000, 0
        );

        INSERT INTO retail_operation_receipts (
          operation_kind, client_operation_id, schema_version,
          payload_hash, sale_id, accepted_at
        ) VALUES (
          'sale.complete', 'operation-1', 1,
          'hash-1', 'sale-1',
          '2026-09-16T00:00:00.000Z'
        );
      `)

      applyMigrations(database, allMigrations)

      deepEqual(
        {
          ...database.prepare(`
          SELECT id, location_id, subtotal_minor, payable_total_minor
          FROM retail_sales
          WHERE id = 'sale-1'
        `).get()
        },
        {
          id: 'sale-1',
          location_id: 'location-1',
          subtotal_minor: 10000,
          payable_total_minor: 10000,
        },
      )

      deepEqual(
        {
          ...database.prepare(`
          SELECT id, sale_id, product_id, quantity,
                 unit_price_minor, line_total_minor
          FROM retail_sale_items
          WHERE id = 'sale-item-1'
        `).get()
        },
        {
          id: 'sale-item-1',
          sale_id: 'sale-1',
          product_id: 'product-1',
          quantity: 2,
          unit_price_minor: 5000,
          line_total_minor: 10000,
        },
      )

      deepEqual(
        {
          ...database.prepare(`
          SELECT id, sale_id, method, amount_minor, ordinal
          FROM retail_payment_allocations
          WHERE id = 'payment-1'
        `).get()
        },
        {
          id: 'payment-1',
          sale_id: 'sale-1',
          method: 'cash',
          amount_minor: 10000,
          ordinal: 0,
        },
      )

      deepEqual(
        {
          ...database.prepare(`
          SELECT operation_kind, client_operation_id, schema_version,
                 payload_hash, sale_id
          FROM retail_operation_receipts
          WHERE client_operation_id = 'operation-1'
        `).get()
        },
        {
          operation_kind: 'sale.complete',
          client_operation_id: 'operation-1',
          schema_version: 1,
          payload_hash: 'hash-1',
          sale_id: 'sale-1',
        },
      )

      equal(
        database.prepare(`
          SELECT COUNT(*) AS count
          FROM retail_sale_item_discounts
        `).get()!.count,
        0,
      )

      deepEqual(
        database.prepare('PRAGMA foreign_key_check').all(),
        [],
      )
    } finally {
      database.close()
    }
  })
})

test('migration 038 creates the discount evidence schema and preserves Sale protections', () => {
  withDatabaseFile((filename) => {
    const database = openDatabaseConnection(filename)

    try {
      applyMigrations(database, allMigrations)

      const columns = database
        .prepare('PRAGMA table_info(retail_sale_item_discounts)')
        .all()
        .map((row) => ({
          name: row.name,
          type: row.type,
          notnull: row.notnull,
          pk: row.pk,
        }))

      deepEqual(columns, [
        {
          name: 'sale_item_id',
          type: 'TEXT',
          notnull: 0,
          pk: 1,
        },
        {
          name: 'amount_minor',
          type: 'INTEGER',
          notnull: 1,
          pk: 0,
        },
        {
          name: 'authorized_by',
          type: 'TEXT',
          notnull: 1,
          pk: 0,
        },
        {
          name: 'created_at',
          type: 'TEXT',
          notnull: 1,
          pk: 0,
        },
      ])

      const foreignKeys = database
        .prepare('PRAGMA foreign_key_list(retail_sale_item_discounts)')
        .all()
        .map((row) => ({
          table: row.table,
          from: row.from,
          to: row.to,
          onDelete: row.on_delete,
        }))
        .sort((left, right) =>
          String(left.from).localeCompare(String(right.from)),
        )

      deepEqual(foreignKeys, [
        {
          table: 'users',
          from: 'authorized_by',
          to: 'id',
          onDelete: 'RESTRICT',
        },
        {
          table: 'retail_sale_items',
          from: 'sale_item_id',
          to: 'id',
          onDelete: 'RESTRICT',
        },
      ])

      const protectedObjects = database.prepare(`
        SELECT type, name
        FROM sqlite_master
        WHERE name IN (
          'retail_sales_location_completed_idx',
          'retail_sales_no_update',
          'retail_sales_no_delete',
          'retail_sale_items_no_update',
          'retail_sale_items_no_delete',
          'retail_payment_allocations_no_update',
          'retail_payment_allocations_no_delete',
          'retail_sale_item_discounts_no_update',
          'retail_sale_item_discounts_no_delete'
        )
        ORDER BY name
      `).all()

      equal(protectedObjects.length, 9)

      deepEqual(
        protectedObjects.map((row) => row.name),
        [
          'retail_payment_allocations_no_delete',
          'retail_payment_allocations_no_update',
          'retail_sale_item_discounts_no_delete',
          'retail_sale_item_discounts_no_update',
          'retail_sale_items_no_delete',
          'retail_sale_items_no_update',
          'retail_sales_location_completed_idx',
          'retail_sales_no_delete',
          'retail_sales_no_update',
        ],
      )

      deepEqual(
        database.prepare('PRAGMA foreign_key_check').all(),
        [],
      )
    } finally {
      database.close()
    }
  })
})

test('migration 038 enforces discounted Sale and immutable discount evidence constraints', () => {
  withDatabaseFile((filename) => {
    const database = openDatabaseConnection(filename)

    try {
      applyMigrations(database, allMigrations)

      database.exec(`
        INSERT INTO users (
          id, username, normalized_username, role, status,
          session_version, created_at, updated_at
        ) VALUES (
          'user-1', 'manager', 'manager', 'manager', 'active', 1,
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_locations (
          id, code, name, type, status, created_at, updated_at,
          currency_code, currency_exponent
        ) VALUES (
          'location-1', 'STORE-1', 'Store 1', 'store', 'active',
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z',
          'SAR', 2
        );

        INSERT INTO retail_products (
          id, source_id, name, status, base_unit, created_at, updated_at
        ) VALUES (
          'product-1', 'SOURCE-1', 'Product 1', 'active', 'piece',
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_sales (
          id, location_id, status, currency_code, currency_exponent,
          subtotal_minor, payable_total_minor, created_at, completed_at
        ) VALUES (
          'discount-sale', 'location-1', 'completed', 'SAR', 2,
          10000, 9000,
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_sale_items (
          id, sale_id, product_id, quantity,
          unit_price_minor, line_total_minor
        ) VALUES (
          'discount-item', 'discount-sale', 'product-1',
          2, 5000, 10000
        );

        INSERT INTO retail_sales (
          id, location_id, status, currency_code, currency_exponent,
          subtotal_minor, payable_total_minor, created_at, completed_at
        ) VALUES (
          'fk-sale', 'location-1', 'completed', 'SAR', 2,
          1000, 1000,
          '2026-09-16T00:00:00.000Z',
          '2026-09-16T00:00:00.000Z'
        );

        INSERT INTO retail_sale_items (
          id, sale_id, product_id, quantity,
          unit_price_minor, line_total_minor
        ) VALUES (
          'fk-item', 'fk-sale', 'product-1',
          1, 1000, 1000
        );

        INSERT INTO retail_sale_item_discounts (
          sale_item_id, amount_minor, authorized_by, created_at
        ) VALUES (
          'discount-item', 1000, 'user-1',
          '2026-09-16T00:00:00.000Z'
        );
      `)

      const originalDiscount = database.prepare(`
        SELECT *
        FROM retail_sale_item_discounts
        WHERE sale_item_id = 'discount-item'
      `).get()

      deepEqual(
        { ...originalDiscount },
        {
          sale_item_id: 'discount-item',
          amount_minor: 1000,
          authorized_by: 'user-1',
          created_at: '2026-09-16T00:00:00.000Z',
        },
      )

      throws(
        () => database.prepare(`
          UPDATE retail_sale_item_discounts
          SET amount_minor = 2000
          WHERE sale_item_id = 'discount-item'
        `).run(),
        /immutable/,
      )

      deepEqual(
        database.prepare(`
          SELECT *
          FROM retail_sale_item_discounts
          WHERE sale_item_id = 'discount-item'
        `).get(),
        originalDiscount,
      )

      throws(
        () => database.prepare(`
          DELETE FROM retail_sale_item_discounts
          WHERE sale_item_id = 'discount-item'
        `).run(),
        /immutable/,
      )

      deepEqual(
        database.prepare(`
          SELECT *
          FROM retail_sale_item_discounts
          WHERE sale_item_id = 'discount-item'
        `).get(),
        originalDiscount,
      )

      throws(
        () => database.prepare(`
          INSERT INTO retail_sale_item_discounts (
            sale_item_id, amount_minor, authorized_by, created_at
          ) VALUES (
            'missing-item', 100, 'user-1',
            '2026-09-16T00:00:00.000Z'
          )
        `).run(),
        /FOREIGN KEY constraint failed/,
      )

      throws(
        () => database.prepare(`
          INSERT INTO retail_sale_item_discounts (
            sale_item_id, amount_minor, authorized_by, created_at
          ) VALUES (
            'fk-item', 100, 'missing-user',
            '2026-09-16T00:00:00.000Z'
          )
        `).run(),
        /FOREIGN KEY constraint failed/,
      )

      throws(
        () => database.prepare(`
          INSERT INTO retail_sale_item_discounts (
            sale_item_id, amount_minor, authorized_by, created_at
          ) VALUES (
            'discount-item', 0, 'user-1',
            '2026-09-16T00:00:00.000Z'
          )
        `).run(),
        /CHECK constraint failed/,
      )

      throws(
        () => database.prepare(`
          INSERT INTO retail_sales (
            id, location_id, status, currency_code, currency_exponent,
            subtotal_minor, payable_total_minor, created_at, completed_at
          ) VALUES (
            'overpay-sale', 'location-1', 'completed', 'SAR', 2,
            10000, 10001,
            '2026-09-16T00:00:00.000Z',
            '2026-09-16T00:00:00.000Z'
          )
        `).run(),
        /CHECK constraint failed/,
      )

      throws(
        () => database.prepare(`
          INSERT INTO retail_sales (
            id, location_id, status, currency_code, currency_exponent,
            subtotal_minor, payable_total_minor, created_at, completed_at
          ) VALUES (
            'zero-payable-sale', 'location-1', 'completed', 'SAR', 2,
            10000, 0,
            '2026-09-16T00:00:00.000Z',
            '2026-09-16T00:00:00.000Z'
          )
        `).run(),
        /CHECK constraint failed/,
      )

      deepEqual(
        database.prepare('PRAGMA foreign_key_check').all(),
        [],
      )
    } finally {
      database.close()
    }
  })
})