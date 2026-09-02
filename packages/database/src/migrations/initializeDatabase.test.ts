import {
  equal,
  throws,
} from 'node:assert/strict'
import {
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { clientsSchemaSql } from './domainSchema.js'
import { initializeDatabase } from './initializeDatabase.js'
import { DomainSchemaVerificationError } from './domainSchema.js'

function withDatabaseFile(run: (filename: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'madina-initialize-database-'))
  const filename = join(directory, 'madina.sqlite')

  try {
    run(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function migrationIds(filename: string): string[] {
  const database = new DatabaseSync(filename)
  try {
    return (database.prepare(`
      SELECT id FROM schema_migrations ORDER BY id
    `).all() as Array<{ id: string }>).map((row) => row.id)
  } finally {
    database.close()
  }
}

test('initializeDatabase prepares every migration on a fresh database', () => {
  withDatabaseFile((filename) => {
    initializeDatabase(filename)

    equal(migrationIds(filename).join(','), [
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
      '035_retail_goods_receipts_v1',
    ].join(','))
  })
})

test('initializeDatabase adopts an exact legacy database and closes its connection', () => {
  withDatabaseFile((filename) => {
    const database = new DatabaseSync(filename)
    try {
      database.exec(clientsSchemaSql)
      database.prepare(`
        INSERT INTO clients (
          id, created_at, updated_at, name, phone, email, company, note, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'client-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        'Мадина', null, null, null, 'Legacy', 'active',
      )
    } finally {
      database.close()
    }

    initializeDatabase(filename)
    initializeDatabase(filename)

    const adopted = new DatabaseSync(filename)
    try {
      const client = adopted.prepare(`
        SELECT name, note FROM clients WHERE id = 'client-1'
      `).get() as { name: string; note: string }
      equal(client.name, 'Мадина')
      equal(client.note, 'Legacy')
    } finally {
      adopted.close()
    }

    const renamed = `${filename}.closed`
    renameSync(filename, renamed)
    equal(migrationIds(renamed).length, 15)
  })
})

test('initializeDatabase closes its connection when schema verification fails', () => {
  withDatabaseFile((filename) => {
    const database = new DatabaseSync(filename)
    try {
      database.exec('CREATE TABLE clients (id TEXT PRIMARY KEY)')
    } finally {
      database.close()
    }

    throws(
      () => initializeDatabase(filename),
      DomainSchemaVerificationError,
    )

    const renamed = `${filename}.failed`
    renameSync(filename, renamed)
    const verified = new DatabaseSync(renamed)
    verified.close()
  })
})
