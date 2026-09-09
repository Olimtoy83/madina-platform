import {
  deepEqual,
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
      '036_retail_transfers_v1',
      '037_retail_sales_payment_completion_v1',
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
    equal(migrationIds(renamed).length, 17)
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

test('migration 037 registers its Sale completion schema, constraints, and triggers exactly once', () => {
  withDatabaseFile((filename) => {
    initializeDatabase(filename)
    initializeDatabase(filename)
    const ids=migrationIds(filename),migration='037_retail_sales_payment_completion_v1'
    equal(ids.filter((id)=>id===migration).length,1)
    equal(ids.indexOf(migration),ids.indexOf('036_retail_transfers_v1')+1)
    const database=new DatabaseSync(filename)
    try {
      const tableNames=(database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{name:string}>).map((row)=>row.name)
      for(const table of ['retail_product_prices','retail_sales','retail_sale_items','retail_payment_allocations','retail_operation_receipts'])equal(tableNames.includes(table),true)
      const locationColumns=(database.prepare('PRAGMA table_info(retail_locations)').all() as Array<{name:string}>).map((row)=>row.name)
      equal(locationColumns.includes('currency_code'),true);equal(locationColumns.includes('currency_exponent'),true)
      const indexColumns=(table:string)=>(database.prepare(`PRAGMA index_list(${table})`).all() as Array<{name:string;unique:number}>).filter((index)=>index.unique===1).map((index)=>(database.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{name:string}>).map((column)=>column.name).join(','))
      for(const [table,columns] of [['retail_product_prices','product_id,location_id'],['retail_sale_items','sale_id,product_id'],['retail_payment_allocations','sale_id,ordinal'],['retail_operation_receipts','operation_kind,client_operation_id']] as const)equal(indexColumns(table).includes(columns),true)
      const triggers=(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as Array<{name:string}>).map((row)=>row.name)
      for(const trigger of ['retail_sales_no_update','retail_sales_no_delete','retail_sale_items_no_update','retail_sale_items_no_delete','retail_payment_allocations_no_update','retail_payment_allocations_no_delete'])equal(triggers.includes(trigger),true)
      deepEqual((database.prepare('SELECT id FROM schema_migrations WHERE id=?').all(migration) as Array<{id:string}>).map((row)=>row.id),[migration])
    } finally { database.close() }
  })
})
