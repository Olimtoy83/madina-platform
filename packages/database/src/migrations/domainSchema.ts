import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SqliteMigration } from './SqliteMigrationRunner.js'

interface ColumnDescriptor {
  name: string
  type: string
  notNull: boolean
  primaryKeyPosition: number
  defaultValue: string | null
}

interface IndexDescriptor {
  columns: readonly string[]
  unique: boolean
}

interface ForeignKeyDescriptor {
  from: string
  table: string
  to: string
  onDelete?: string
  onUpdate?: string
}

interface TableDescriptor {
  name: string
  columns: readonly ColumnDescriptor[]
  indexes: readonly IndexDescriptor[]
  foreignKeys: readonly ForeignKeyDescriptor[]
  checks: readonly string[]
}

interface TableInfoRow {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface IndexListRow {
  name: string
  unique: number
  origin: 'c' | 'pk' | 'u'
}

interface IndexInfoRow {
  name: string
}

interface ForeignKeyRow {
  table: string
  from: string
  to: string
  on_delete: string
  on_update: string
}

interface SchemaSqlRow {
  sql: string
}

export class DomainSchemaVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainSchemaVerificationError'
  }
}

const unitChecks = "unit in ('kg','piece','liter','box')"
const paymentMethodChecks = "payment_method in ('cash','card','bank-transfer','other')"

const clientsDescriptor: TableDescriptor = {
  name: 'clients',
  columns: [
    { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
    { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'name', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'phone', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    { name: 'email', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    { name: 'company', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    { name: 'note', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
  ],
  indexes: [],
  foreignKeys: [],
  checks: ["status in ('active','inactive')"],
}

const tasksDescriptor: TableDescriptor = {
  name: 'tasks',
  columns: [
    { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
    { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'title', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'description', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'priority', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    { name: 'due_date', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
  ],
  indexes: [],
  foreignKeys: [],
  checks: [
    "status in ('todo','in-progress','completed','cancelled')",
    "priority in ('low','medium','high')",
  ],
}

const commerceDescriptors: readonly TableDescriptor[] = [
  {
    name: 'products',
    columns: [
      { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
      { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'name', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'category', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'quantity', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'cost_price', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'sale_price', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [],
    foreignKeys: [],
    checks: [
      "category in ('dry-fruits','dates','perfume','carpets')",
      unitChecks,
      "status in ('active','inactive')",
    ],
  },
  {
    name: 'purchases',
    columns: [
      { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
      { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'purchase_number', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'purchase_date', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'supplier_name', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'total_amount', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'payment_method', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'note', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [{ columns: ['purchase_number'], unique: true }],
    foreignKeys: [],
    checks: [paymentMethodChecks, "status in ('draft','completed','cancelled')"],
  },
  {
    name: 'purchase_items',
    columns: [
      { name: 'purchase_id', type: 'TEXT', notNull: true, primaryKeyPosition: 1, defaultValue: null },
      { name: 'product_id', type: 'TEXT', notNull: true, primaryKeyPosition: 2, defaultValue: null },
      { name: 'quantity', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit_cost', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'total_cost', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [],
    foreignKeys: [
      { from: 'purchase_id', table: 'purchases', to: 'id' },
      { from: 'product_id', table: 'products', to: 'id' },
    ],
    checks: [unitChecks],
  },
  {
    name: 'sales',
    columns: [
      { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
      { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'sale_number', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'sale_date', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'client_id', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
      { name: 'client_name', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'total_amount', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'payment_method', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'note', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [{ columns: ['sale_number'], unique: true }],
    foreignKeys: [],
    checks: [paymentMethodChecks, "status in ('draft','completed','cancelled')"],
  },
  {
    name: 'sale_items',
    columns: [
      { name: 'sale_id', type: 'TEXT', notNull: true, primaryKeyPosition: 1, defaultValue: null },
      { name: 'product_id', type: 'TEXT', notNull: true, primaryKeyPosition: 2, defaultValue: null },
      { name: 'quantity', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit_price', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'total_amount', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [],
    foreignKeys: [
      { from: 'sale_id', table: 'sales', to: 'id' },
      { from: 'product_id', table: 'products', to: 'id' },
    ],
    checks: [unitChecks],
  },
  {
    name: 'stock_movements',
    columns: [
      { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
      { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'product_id', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'type', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'quantity', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'unit', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'reference_id', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
      { name: 'note', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [{ columns: ['type', 'product_id', 'reference_id'], unique: true }],
    foreignKeys: [{ from: 'product_id', table: 'products', to: 'id' }],
    checks: ["type in ('purchase','sale','adjustment')", unitChecks],
  },
  {
    name: 'transactions',
    columns: [
      { name: 'id', type: 'TEXT', notNull: false, primaryKeyPosition: 1, defaultValue: null },
      { name: 'created_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'updated_at', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'type', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'category', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'amount', type: 'REAL', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'payment_method', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'transaction_date', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
      { name: 'reference_id', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
      { name: 'description', type: 'TEXT', notNull: false, primaryKeyPosition: 0, defaultValue: null },
      { name: 'status', type: 'TEXT', notNull: true, primaryKeyPosition: 0, defaultValue: null },
    ],
    indexes: [{ columns: ['category', 'reference_id'], unique: true }],
    foreignKeys: [],
    checks: [
      "type in ('income','expense')",
      "category in ('sale','purchase','other')",
      paymentMethodChecks,
      "status in ('pending','completed','cancelled')",
    ],
  },
]

export const clientsSchemaSql = `
  CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    company TEXT,
    note TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
  );
`

export const tasksSchemaSql = `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('todo', 'in-progress', 'completed', 'cancelled')
    ),
    priority TEXT NOT NULL CHECK (
      priority IN ('low', 'medium', 'high')
    ),
    due_date TEXT
  );
`

export const commerceLegacySchemaSql = `
  CREATE TABLE products (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('dry-fruits', 'dates', 'perfume', 'carpets')),
    quantity REAL NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
    cost_price REAL NOT NULL, sale_price REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive'))
  );
  CREATE TABLE purchases (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    purchase_number TEXT NOT NULL UNIQUE, purchase_date TEXT NOT NULL,
    supplier_name TEXT NOT NULL, total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'cancelled')),
    note TEXT
  );
  CREATE TABLE purchase_items (
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
    unit_cost REAL NOT NULL, total_cost REAL NOT NULL,
    PRIMARY KEY (purchase_id, product_id)
  );
  CREATE TABLE sales (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    sale_number TEXT NOT NULL UNIQUE, sale_date TEXT NOT NULL, client_id TEXT,
    client_name TEXT NOT NULL, total_amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
    status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'cancelled')),
    note TEXT
  );
  CREATE TABLE sale_items (
    sale_id TEXT NOT NULL REFERENCES sales(id),
    product_id TEXT NOT NULL REFERENCES products(id), quantity REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
    unit_price REAL NOT NULL, total_amount REAL NOT NULL,
    PRIMARY KEY (sale_id, product_id)
  );
  CREATE TABLE stock_movements (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'adjustment')),
    quantity REAL NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('kg', 'piece', 'liter', 'box')),
    reference_id TEXT, note TEXT,
    UNIQUE (type, product_id, reference_id)
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL CHECK (category IN ('sale', 'purchase', 'other')),
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank-transfer', 'other')),
    transaction_date TEXT NOT NULL, reference_id TEXT, description TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
    UNIQUE (category, reference_id)
  );
`

const stockMovementsReferenceIndexSql = `
  CREATE INDEX stock_movements_reference_id_idx
    ON stock_movements (reference_id);
`

function normalizeSql(value: string): string {
  return value
    .replaceAll(/\s+/g, '')
    .toLowerCase()
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) !== undefined
}

function verifyTable(
  database: DatabaseSync,
  descriptor: TableDescriptor,
): void {
  const columns = database.prepare(
    `PRAGMA table_info(${descriptor.name})`,
  ).all() as unknown as TableInfoRow[]

  const expectedColumns = descriptor.columns
  if (columns.length !== expectedColumns.length) {
    throw new DomainSchemaVerificationError(
      `${descriptor.name}: unexpected columns`,
    )
  }

  for (const [index, expected] of expectedColumns.entries()) {
    const actual = columns[index]
    if (
      actual.name !== expected.name ||
      actual.type.toUpperCase() !== expected.type ||
      Boolean(actual.notnull) !== expected.notNull ||
      actual.pk !== expected.primaryKeyPosition ||
      actual.dflt_value !== expected.defaultValue
    ) {
      throw new DomainSchemaVerificationError(
        `${descriptor.name}: column mismatch for ${expected.name}`,
      )
    }
  }

  const indexes = database.prepare(
    `PRAGMA index_list(${descriptor.name})`,
  ).all() as unknown as IndexListRow[]
  const actualIndexes = indexes.map((index) => ({
    columns: database.prepare(
      `PRAGMA index_info(${index.name})`,
    ).all() as unknown as IndexInfoRow[],
    unique: Boolean(index.unique),
    origin: index.origin,
  }))
  const nonPrimaryKeyIndexes = actualIndexes.filter((index) =>
    index.origin !== 'pk'
  )

  if (nonPrimaryKeyIndexes.length !== descriptor.indexes.length) {
    throw new DomainSchemaVerificationError(
      `${descriptor.name}: unexpected indexes`,
    )
  }

  for (const expected of descriptor.indexes) {
    const matchingIndex = nonPrimaryKeyIndexes.find((actual) =>
      actual.unique === expected.unique &&
      actual.columns.map((column) => column.name).join(',') ===
        expected.columns.join(',')
    )
    if (!matchingIndex) {
      throw new DomainSchemaVerificationError(
        `${descriptor.name}: missing expected index (${expected.columns.join(', ')})`,
      )
    }
  }

  const foreignKeys = database.prepare(
    `PRAGMA foreign_key_list(${descriptor.name})`,
  ).all() as unknown as ForeignKeyRow[]
  if (foreignKeys.length !== descriptor.foreignKeys.length) {
    throw new DomainSchemaVerificationError(
      `${descriptor.name}: unexpected foreign keys`,
    )
  }

  for (const expected of descriptor.foreignKeys) {
    const matchingForeignKey = foreignKeys.find((actual) =>
      actual.from === expected.from &&
      actual.table === expected.table &&
      actual.to === expected.to &&
      actual.on_delete === (expected.onDelete ?? 'NO ACTION') &&
      actual.on_update === (expected.onUpdate ?? 'NO ACTION')
    )
    if (!matchingForeignKey) {
      throw new DomainSchemaVerificationError(
        `${descriptor.name}: foreign key mismatch for ${expected.from}`,
      )
    }
  }

  const schema = database.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(descriptor.name) as SchemaSqlRow | undefined
  const normalizedSchema = normalizeSql(schema?.sql ?? '')
  for (const check of descriptor.checks) {
    if (!normalizedSchema.includes(normalizeSql(`check(${check})`))) {
      throw new DomainSchemaVerificationError(
        `${descriptor.name}: check constraint mismatch (${check})`,
      )
    }
  }
}

function verifyTables(
  database: DatabaseSync,
  descriptors: readonly TableDescriptor[],
): void {
  for (const descriptor of descriptors) {
    verifyTable(database, descriptor)
  }
}

function createVerifiedMigration(
  id: string,
  checksumSource: string,
  run: (database: DatabaseSync) => void,
): SqliteMigration {
  return {
    id,
    checksum: createHash('sha256')
      .update(`domain-schema-verifier-v1:${checksumSource}`)
      .digest('hex'),
    up: run,
  }
}

const clientsMigration = createVerifiedMigration(
  '010_domain_clients_v1',
  clientsSchemaSql,
  (database) => {
    if (tableExists(database, 'clients')) {
      verifyTable(database, clientsDescriptor)
      return
    }
    database.exec(clientsSchemaSql)
  },
)

const tasksMigration = createVerifiedMigration(
  '011_domain_tasks_v1',
  tasksSchemaSql,
  (database) => {
    if (tableExists(database, 'tasks')) {
      verifyTable(database, tasksDescriptor)
      return
    }
    database.exec(tasksSchemaSql)
  },
)

const commerceMigration = createVerifiedMigration(
  '012_domain_commerce_v1',
  `${commerceLegacySchemaSql}\n${stockMovementsReferenceIndexSql}`,
  (database) => {
    const existingTables = commerceDescriptors.filter((descriptor) =>
      tableExists(database, descriptor.name),
    )

    if (existingTables.length === 0) {
      database.exec(commerceLegacySchemaSql)
    } else if (existingTables.length !== commerceDescriptors.length) {
      throw new DomainSchemaVerificationError(
        'commerce: partial aggregate schema',
      )
    } else {
      verifyTables(database, commerceDescriptors)
    }

    database.exec(stockMovementsReferenceIndexSql)
  },
)

export const domainMigrations: readonly SqliteMigration[] = [
  clientsMigration,
  tasksMigration,
  commerceMigration,
]
