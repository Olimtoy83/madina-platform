import {
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
import { allMigrations } from './allMigrations.js'
import { authMigrations } from './authMigrations.js'
import {
  clientsSchemaSql,
  commerceLegacySchemaSql,
  domainMigrations,
  DomainSchemaVerificationError,
  tasksSchemaSql,
} from './domainSchema.js'
import {
  applyMigrations,
  MigrationChecksumMismatchError,
  type SqliteMigration,
} from './SqliteMigrationRunner.js'

function withDatabase(run: (database: DatabaseSync) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-migrations-'))
  const database = new DatabaseSync(join(directory, 'madina.sqlite'))

  try {
    run(database)
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function hasAppliedMigration(
  database: DatabaseSync,
  migrationId: string,
): boolean {
  return database.prepare(`
    SELECT 1 FROM schema_migrations WHERE id = ?
  `).get(migrationId) !== undefined
}

test('applies auth migrations to a fresh database', () => {
  withDatabase((database) => {
    applyMigrations(database, authMigrations)

    const migrations = database.prepare(
      'SELECT id FROM schema_migrations ORDER BY id',
    ).all() as Array<{ id: string }>
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'users', 'user_credentials', 'auth_sessions'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>

    equal(migrations.length, 2)
    equal(tables.length, 3)
  })
})

test('records the legacy baseline without changing existing domain data', () => {
  withDatabase((database) => {
    database.exec(`
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO clients (id, name) VALUES ('client-1', 'Мадина');
      INSERT INTO tasks (id, title) VALUES ('task-1', 'Проверить склад');
      INSERT INTO products (id, name) VALUES ('product-1', 'Финики');
    `)

    applyMigrations(database, authMigrations)

    const client = database.prepare(
      'SELECT name FROM clients WHERE id = ?',
    ).get('client-1') as { name: string }
    const task = database.prepare(
      'SELECT title FROM tasks WHERE id = ?',
    ).get('task-1') as { title: string }
    const product = database.prepare(
      'SELECT name FROM products WHERE id = ?',
    ).get('product-1') as { name: string }
    equal(client.name, 'Мадина')
    equal(task.title, 'Проверить склад')
    equal(product.name, 'Финики')
  })
})

test('does not reapply an already recorded migration', () => {
  withDatabase((database) => {
    applyMigrations(database, authMigrations)
    applyMigrations(database, authMigrations)

    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations',
    ).get() as { count: number }
    equal(count.count, 2)
  })
})

test('applies verified domain migrations to a fresh database', () => {
  withDatabase((database) => {
    applyMigrations(database, allMigrations)

    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'clients', 'tasks', 'products', 'purchases', 'purchase_items',
        'sales', 'sale_items', 'stock_movements', 'transactions',
        'korea_auto_vehicles', 'retail_locations', 'retail_user_location_grants',
        'retail_products', 'retail_product_barcodes', 'retail_inventory_balances',
        'retail_inventory_movements', 'retail_inventory_reconciliations', 'retail_inventory_reconciliation_lines'
      )
    `).all() as Array<{ name: string }>
    const migrations = database.prepare(`
      SELECT id FROM schema_migrations ORDER BY id
    `).all() as Array<{ id: string }>

    equal(tables.length, 18)
    equal(migrations.map((migration) => migration.id).join(','), [
      '000_legacy_schema_baseline',
      '001_auth_foundation',
      '010_domain_clients_v1',
      '011_domain_tasks_v1',
      '012_domain_commerce_v1',
      '013_stock_movement_history_index_v1',
      '014_sales_bounded_read_indexes_v1',
      '015_purchases_bounded_read_index_v1',
      '020_audit_events_v1',
      '030_korea_auto_vehicles_v1',
      '031_retail_access_locations_v1',
      '032_retail_products_barcodes_v1',
      '033_retail_inventory_ledger_v1',
      '034_retail_inventory_reconciliation_v1',
    ].join(','))
  })
})

test('adopts an exact legacy clients schema without changing rows', () => {
  withDatabase((database) => {
    database.exec(clientsSchemaSql)
    database.prepare(`
      INSERT INTO clients (
        id, created_at, updated_at, name, phone, email, company, note, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'client-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
      'Мадина', '+70000000000', 'madina@example.test', 'Madina', 'Legacy', 'active',
    )

    applyMigrations(database, domainMigrations)

    const client = database.prepare(`
      SELECT * FROM clients WHERE id = 'client-1'
    `).get() as { name: string; note: string; status: string }
    equal(client.name, 'Мадина')
    equal(client.note, 'Legacy')
    equal(client.status, 'active')
    equal(hasAppliedMigration(database, '010_domain_clients_v1'), true)
  })
})

test('adopts an exact legacy tasks schema without changing rows', () => {
  withDatabase((database) => {
    database.exec(tasksSchemaSql)
    database.prepare(`
      INSERT INTO tasks (
        id, created_at, updated_at, title, description, status, priority, due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'task-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
      'Проверить склад', 'Legacy', 'todo', 'high', '2026-01-03T00:00:00.000Z',
    )

    applyMigrations(database, domainMigrations)

    const task = database.prepare(`
      SELECT * FROM tasks WHERE id = 'task-1'
    `).get() as { title: string; description: string; priority: string }
    equal(task.title, 'Проверить склад')
    equal(task.description, 'Legacy')
    equal(task.priority, 'high')
    equal(hasAppliedMigration(database, '011_domain_tasks_v1'), true)
  })
})

test('adopts an exact legacy commerce schema without changing rows', () => {
  withDatabase((database) => {
    database.exec(commerceLegacySchemaSql)
    database.exec(`
      INSERT INTO products VALUES (
        'product-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
        'Финики', 'dates', 2, 'kg', 100, 150, 'active'
      );
      INSERT INTO purchases VALUES (
        'purchase-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
        'P-1', '2026-01-02T00:00:00.000Z', 'Supplier', 100, 'cash', 'completed', 'Legacy'
      );
      INSERT INTO purchase_items VALUES ('purchase-1', 'product-1', 1, 'kg', 100, 100);
      INSERT INTO sales VALUES (
        'sale-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
        'S-1', '2026-01-02T00:00:00.000Z', 'client-1', 'Мадина', 150, 'cash', 'completed', 'Legacy'
      );
      INSERT INTO sale_items VALUES ('sale-1', 'product-1', 1, 'kg', 150, 150);
      INSERT INTO stock_movements VALUES (
        'movement-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
        'product-1', 'purchase', 1, 'kg', 'purchase-1', 'Legacy'
      );
      INSERT INTO transactions VALUES (
        'transaction-1', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
        'expense', 'purchase', 100, 'cash', '2026-01-02T00:00:00.000Z',
        'purchase-1', 'Legacy', 'completed'
      );
    `)

    applyMigrations(database, domainMigrations)

    const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM purchases) AS purchases,
        (SELECT COUNT(*) FROM purchase_items) AS purchase_items,
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM sale_items) AS sale_items,
        (SELECT COUNT(*) FROM stock_movements) AS stock_movements,
        (SELECT COUNT(*) FROM transactions) AS transactions
    `).get() as Record<string, number>
    equal(Object.values(counts).join(','), '1,1,1,1,1,1,1')
    equal(hasAppliedMigration(database, '012_domain_commerce_v1'), true)

    const product = database.prepare(`
      SELECT name, quantity, sale_price FROM products WHERE id = 'product-1'
    `).get() as { name: string; quantity: number; sale_price: number }
    const transaction = database.prepare(`
      SELECT reference_id, description, status
      FROM transactions WHERE id = 'transaction-1'
    `).get() as {
      reference_id: string
      description: string
      status: string
    }
    equal(product.name, 'Финики')
    equal(product.quantity, 2)
    equal(product.sale_price, 150)
    equal(transaction.reference_id, 'purchase-1')
    equal(transaction.description, 'Legacy')
    equal(transaction.status, 'completed')

    const index = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'stock_movements_reference_id_idx'
    `).get() as { name: string } | undefined
    equal(index?.name, 'stock_movements_reference_id_idx')
  })
})

test('rejects partial legacy commerce schema without recording ownership', () => {
  withDatabase((database) => {
    database.exec(`CREATE TABLE products (id TEXT PRIMARY KEY)`)

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '012_domain_commerce_v1'), false)
  })
})

test('rejects a clients schema with different columns', () => {
  withDatabase((database) => {
    database.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `)

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '010_domain_clients_v1'), false)
  })
})

test('rejects a tasks schema with a different status constraint', () => {
  withDatabase((database) => {
    database.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK (status IN ('todo', 'completed')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_date TEXT
      )
    `)

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '011_domain_tasks_v1'), false)
  })
})

test('rejects a commerce schema with a different foreign key', () => {
  withDatabase((database) => {
    database.exec(commerceLegacySchemaSql.replace(
      'product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL,',
      'product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, quantity REAL NOT NULL,',
    ))

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '012_domain_commerce_v1'), false)
  })
})

test('rejects a commerce schema with a different unique index', () => {
  withDatabase((database) => {
    database.exec(commerceLegacySchemaSql.replace(
      'UNIQUE (category, reference_id)',
      'UNIQUE (category, description)',
    ))

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '012_domain_commerce_v1'), false)
  })
})

test('rejects a commerce schema with a different check constraint', () => {
  withDatabase((database) => {
    database.exec(commerceLegacySchemaSql.replace(
      "type IN ('purchase', 'sale', 'adjustment')",
      "type IN ('purchase', 'sale')",
    ))

    throws(
      () => applyMigrations(database, domainMigrations),
      DomainSchemaVerificationError,
    )

    equal(hasAppliedMigration(database, '012_domain_commerce_v1'), false)
  })
})

test('domain migrations are idempotent after successful adoption', () => {
  withDatabase((database) => {
    applyMigrations(database, domainMigrations)
    applyMigrations(database, domainMigrations)

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations
    `).get() as { count: number }
    equal(count.count, 3)
  })
})

test('rolls back a failed migration and does not record it', () => {
  withDatabase((database) => {
    const failingMigration: SqliteMigration = {
      id: '100_failing_migration',
      checksum: 'failing-checksum',
      up(target) {
        target.exec('CREATE TABLE should_not_exist (id TEXT PRIMARY KEY)')
        throw new Error('forced failure')
      },
    }

    throws(
      () => applyMigrations(database, [failingMigration]),
      /forced failure/,
    )

    const table = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'should_not_exist'
    `).get()
    const recorded = database.prepare(`
      SELECT id FROM schema_migrations WHERE id = '100_failing_migration'
    `).get()
    equal(table, undefined)
    equal(recorded, undefined)
  })
})

test('rejects checksum changes for an applied migration', () => {
  withDatabase((database) => {
    const first: SqliteMigration = {
      id: '100_test_migration',
      checksum: 'first-checksum',
      up() {},
    }
    const changed: SqliteMigration = {
      ...first,
      checksum: 'changed-checksum',
    }

    applyMigrations(database, [first])
    throws(
      () => applyMigrations(database, [changed]),
      MigrationChecksumMismatchError,
    )
  })
})
