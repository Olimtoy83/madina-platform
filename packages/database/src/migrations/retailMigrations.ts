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

const retailInventoryLedger = createSqlMigration('033_retail_inventory_ledger_v1', `
  CREATE TABLE retail_inventory_balances (
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    on_hand_quantity INTEGER NOT NULL CHECK (on_hand_quantity >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (product_id, location_id)
  );
  CREATE TABLE retail_inventory_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'goods_receipt', 'transfer', 'sale', 'return', 'reconciliation_adjustment')),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_line_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (source_type, source_id, source_line_id)
  );
  CREATE INDEX retail_inventory_movements_location_product_created_idx
    ON retail_inventory_movements (location_id, product_id, created_at, id);
  CREATE TRIGGER retail_inventory_movements_no_update
    BEFORE UPDATE ON retail_inventory_movements
    BEGIN SELECT RAISE(ABORT, 'Retail inventory movements are immutable.'); END;
  CREATE TRIGGER retail_inventory_movements_no_delete
    BEFORE DELETE ON retail_inventory_movements
    BEGIN SELECT RAISE(ABORT, 'Retail inventory movements are immutable.'); END;
`)

const retailInventoryReconciliation = createSqlMigration('034_retail_inventory_reconciliation_v1', `
  CREATE TABLE retail_inventory_reconciliations (id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT, purpose TEXT NOT NULL CHECK (purpose IN ('opening', 'daily')), status TEXT NOT NULL CHECK (status IN ('open', 'completed')), created_at TEXT NOT NULL, created_by TEXT NOT NULL, completed_at TEXT);
  CREATE TABLE retail_inventory_reconciliation_lines (session_id TEXT NOT NULL REFERENCES retail_inventory_reconciliations(id) ON DELETE RESTRICT, product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT, expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0), actual_quantity INTEGER NOT NULL CHECK (actual_quantity >= 0), variance INTEGER NOT NULL, recorded_at TEXT NOT NULL, recorded_by TEXT NOT NULL, PRIMARY KEY (session_id, product_id));
  CREATE INDEX retail_inventory_reconciliation_location_created_idx ON retail_inventory_reconciliations (location_id, created_at, id);
  CREATE TRIGGER retail_inventory_reconciliations_no_completed_update BEFORE UPDATE ON retail_inventory_reconciliations WHEN OLD.status = 'completed' BEGIN SELECT RAISE(ABORT, 'Completed Retail reconciliation is immutable.'); END;
  CREATE TRIGGER retail_inventory_reconciliation_lines_no_completed_change BEFORE UPDATE ON retail_inventory_reconciliation_lines WHEN (SELECT status FROM retail_inventory_reconciliations WHERE id = OLD.session_id) = 'completed' BEGIN SELECT RAISE(ABORT, 'Completed Retail reconciliation lines are immutable.'); END;
  CREATE TRIGGER retail_inventory_reconciliation_lines_no_delete BEFORE DELETE ON retail_inventory_reconciliation_lines BEGIN SELECT RAISE(ABORT, 'Retail reconciliation lines are immutable evidence.'); END;
`)

const retailGoodsReceipts = createSqlMigration('035_retail_goods_receipts_v1', `
  CREATE TABLE retail_goods_receipts (
    id TEXT PRIMARY KEY,
    receipt_reference TEXT NOT NULL,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    supplier_reference TEXT,
    shipment_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('draft', 'completed')),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (location_id, receipt_reference)
  );
  CREATE TABLE retail_goods_receipt_lines (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES retail_goods_receipts(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    UNIQUE (receipt_id, product_id)
  );
  CREATE INDEX retail_goods_receipts_location_created_idx ON retail_goods_receipts (location_id, created_at, id);
  CREATE TRIGGER retail_goods_receipts_no_completed_update BEFORE UPDATE ON retail_goods_receipts WHEN OLD.status = 'completed' BEGIN SELECT RAISE(ABORT, 'Completed Retail Goods Receipt is immutable.'); END;
  CREATE TRIGGER retail_goods_receipt_lines_no_completed_update BEFORE UPDATE ON retail_goods_receipt_lines WHEN (SELECT status FROM retail_goods_receipts WHERE id = OLD.receipt_id) = 'completed' BEGIN SELECT RAISE(ABORT, 'Completed Retail Goods Receipt lines are immutable.'); END;
  CREATE TRIGGER retail_goods_receipt_lines_no_completed_delete BEFORE DELETE ON retail_goods_receipt_lines WHEN (SELECT status FROM retail_goods_receipts WHERE id = OLD.receipt_id) = 'completed' BEGIN SELECT RAISE(ABORT, 'Completed Retail Goods Receipt lines are immutable.'); END;
`)

export const retailMigrations = [retailAccessLocations, retailProductsBarcodes, retailInventoryLedger, retailInventoryReconciliation, retailGoodsReceipts] as const
