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
const retailTransfers = createSqlMigration('036_retail_transfers_v1', `
  CREATE TABLE retail_transfers (id TEXT PRIMARY KEY, source_location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT, destination_location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT, status TEXT NOT NULL CHECK (status IN ('draft','dispatched','received')), created_at TEXT NOT NULL, created_by TEXT NOT NULL, dispatched_at TEXT, received_at TEXT, CHECK (source_location_id <> destination_location_id));
  CREATE TABLE retail_transfer_lines (id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES retail_transfers(id) ON DELETE RESTRICT, product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT, quantity INTEGER NOT NULL CHECK (quantity > 0), UNIQUE (transfer_id,product_id));
  CREATE INDEX retail_transfers_source_created_idx ON retail_transfers (source_location_id,created_at,id);
  CREATE INDEX retail_transfers_destination_created_idx ON retail_transfers (destination_location_id,created_at,id);
  CREATE TRIGGER retail_transfers_no_received_update BEFORE UPDATE ON retail_transfers WHEN OLD.status='received' BEGIN SELECT RAISE(ABORT,'Received Retail Transfer is immutable.'); END;
  CREATE TRIGGER retail_transfer_lines_no_non_draft_change BEFORE UPDATE ON retail_transfer_lines WHEN (SELECT status FROM retail_transfers WHERE id=OLD.transfer_id)<>'draft' BEGIN SELECT RAISE(ABORT,'Non-draft Retail Transfer lines are immutable.'); END;
  CREATE TRIGGER retail_transfer_lines_no_non_draft_delete BEFORE DELETE ON retail_transfer_lines WHEN (SELECT status FROM retail_transfers WHERE id=OLD.transfer_id)<>'draft' BEGIN SELECT RAISE(ABORT,'Non-draft Retail Transfer lines are immutable.'); END;
`)
const retailSalesPaymentCompletion = createSqlMigration('037_retail_sales_payment_completion_v1', `
  ALTER TABLE retail_locations ADD COLUMN currency_code TEXT CHECK (currency_code IS NULL OR (typeof(currency_code)='text' AND length(currency_code)=3 AND currency_code GLOB '[A-Z][A-Z][A-Z]'));
  ALTER TABLE retail_locations ADD COLUMN currency_exponent INTEGER CHECK (currency_exponent IS NULL OR (typeof(currency_exponent)='integer' AND currency_exponent BETWEEN 0 AND 9));
  CREATE TABLE retail_product_prices (product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT, location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT, unit_price_minor INTEGER NOT NULL CHECK(typeof(unit_price_minor)='integer' AND unit_price_minor>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(product_id,location_id));
  CREATE INDEX retail_product_prices_location_product_idx ON retail_product_prices(location_id,product_id);
  CREATE TABLE retail_sales (id TEXT PRIMARY KEY, location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT, status TEXT NOT NULL CHECK(status='completed'), currency_code TEXT NOT NULL CHECK(typeof(currency_code)='text' AND length(currency_code)=3 AND currency_code GLOB '[A-Z][A-Z][A-Z]'), currency_exponent INTEGER NOT NULL CHECK(typeof(currency_exponent)='integer' AND currency_exponent BETWEEN 0 AND 9), subtotal_minor INTEGER NOT NULL CHECK(typeof(subtotal_minor)='integer' AND subtotal_minor>0), payable_total_minor INTEGER NOT NULL CHECK(typeof(payable_total_minor)='integer' AND payable_total_minor=subtotal_minor), created_at TEXT NOT NULL, completed_at TEXT NOT NULL);
  CREATE TABLE retail_sale_items (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT, product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT, quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0), unit_price_minor INTEGER NOT NULL CHECK(typeof(unit_price_minor)='integer' AND unit_price_minor>0), line_total_minor INTEGER NOT NULL CHECK(typeof(line_total_minor)='integer' AND line_total_minor>0), UNIQUE(sale_id,product_id));
  CREATE TABLE retail_payment_allocations (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT, method TEXT NOT NULL CHECK(method IN ('cash','card','transfer','other')), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0), ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0), UNIQUE(sale_id,ordinal));
  CREATE TABLE retail_operation_receipts (operation_kind TEXT NOT NULL, client_operation_id TEXT NOT NULL, schema_version INTEGER NOT NULL CHECK(typeof(schema_version)='integer' AND schema_version>0), payload_hash TEXT NOT NULL, sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT, accepted_at TEXT NOT NULL, PRIMARY KEY(operation_kind,client_operation_id));
  CREATE INDEX retail_sales_location_completed_idx ON retail_sales(location_id,completed_at,id);
  CREATE TRIGGER retail_sales_no_update BEFORE UPDATE ON retail_sales BEGIN SELECT RAISE(ABORT,'Completed Retail Sale is immutable.'); END;
  CREATE TRIGGER retail_sales_no_delete BEFORE DELETE ON retail_sales BEGIN SELECT RAISE(ABORT,'Completed Retail Sale is immutable.'); END;
  CREATE TRIGGER retail_sale_items_no_update BEFORE UPDATE ON retail_sale_items BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Items are immutable.'); END;
  CREATE TRIGGER retail_sale_items_no_delete BEFORE DELETE ON retail_sale_items BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Items are immutable.'); END;
  CREATE TRIGGER retail_payment_allocations_no_update BEFORE UPDATE ON retail_payment_allocations BEGIN SELECT RAISE(ABORT,'Completed Retail Payment Allocations are immutable.'); END;
  CREATE TRIGGER retail_payment_allocations_no_delete BEFORE DELETE ON retail_payment_allocations BEGIN SELECT RAISE(ABORT,'Completed Retail Payment Allocations are immutable.'); END;
`)

const retailSaleDiscounts = createSqlMigration('038_retail_sale_discounts_v1', `
  PRAGMA defer_foreign_keys = ON;

  CREATE TABLE retail_sale_items_038_backup (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_minor INTEGER NOT NULL,
    line_total_minor INTEGER NOT NULL
  );

  INSERT INTO retail_sale_items_038_backup (
    id, sale_id, product_id, quantity, unit_price_minor, line_total_minor
  )
  SELECT
    id, sale_id, product_id, quantity, unit_price_minor, line_total_minor
  FROM retail_sale_items;

  CREATE TABLE retail_payment_allocations_038_backup (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    ordinal INTEGER NOT NULL
  );

  INSERT INTO retail_payment_allocations_038_backup (
    id, sale_id, method, amount_minor, ordinal
  )
  SELECT
    id, sale_id, method, amount_minor, ordinal
  FROM retail_payment_allocations;

  CREATE TABLE retail_operation_receipts_038_backup (
    operation_kind TEXT NOT NULL,
    client_operation_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    sale_id TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY(operation_kind, client_operation_id)
  );

  INSERT INTO retail_operation_receipts_038_backup (
    operation_kind,
    client_operation_id,
    schema_version,
    payload_hash,
    sale_id,
    accepted_at
  )
  SELECT
    operation_kind,
    client_operation_id,
    schema_version,
    payload_hash,
    sale_id,
    accepted_at
  FROM retail_operation_receipts;

  DROP TABLE retail_sale_items;
  DROP TABLE retail_payment_allocations;
  DROP TABLE retail_operation_receipts;

  CREATE TABLE retail_sales_038 (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK(status='completed'),
    currency_code TEXT NOT NULL CHECK(
      typeof(currency_code)='text'
      AND length(currency_code)=3
      AND currency_code GLOB '[A-Z][A-Z][A-Z]'
    ),
    currency_exponent INTEGER NOT NULL CHECK(
      typeof(currency_exponent)='integer'
      AND currency_exponent BETWEEN 0 AND 9
    ),
    subtotal_minor INTEGER NOT NULL CHECK(
      typeof(subtotal_minor)='integer'
      AND subtotal_minor>0
    ),
    payable_total_minor INTEGER NOT NULL CHECK(
      typeof(payable_total_minor)='integer'
      AND payable_total_minor>0
      AND payable_total_minor<=subtotal_minor
    ),
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );

  INSERT INTO retail_sales_038 (
    id,
    location_id,
    status,
    currency_code,
    currency_exponent,
    subtotal_minor,
    payable_total_minor,
    created_at,
    completed_at
  )
  SELECT
    id,
    location_id,
    status,
    currency_code,
    currency_exponent,
    subtotal_minor,
    payable_total_minor,
    created_at,
    completed_at
  FROM retail_sales;

  DROP TABLE retail_sales;
  ALTER TABLE retail_sales_038 RENAME TO retail_sales;

  CREATE TABLE retail_sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
    unit_price_minor INTEGER NOT NULL CHECK(
      typeof(unit_price_minor)='integer' AND unit_price_minor>0
    ),
    line_total_minor INTEGER NOT NULL CHECK(
      typeof(line_total_minor)='integer' AND line_total_minor>0
    ),
    UNIQUE(sale_id,product_id)
  );

  INSERT INTO retail_sale_items (
    id, sale_id, product_id, quantity, unit_price_minor, line_total_minor
  )
  SELECT
    id, sale_id, product_id, quantity, unit_price_minor, line_total_minor
  FROM retail_sale_items_038_backup;

  CREATE TABLE retail_payment_allocations (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT,
    method TEXT NOT NULL CHECK(method IN ('cash','card','transfer','other')),
    amount_minor INTEGER NOT NULL CHECK(
      typeof(amount_minor)='integer' AND amount_minor>0
    ),
    ordinal INTEGER NOT NULL CHECK(
      typeof(ordinal)='integer' AND ordinal>=0
    ),
    UNIQUE(sale_id,ordinal)
  );

  INSERT INTO retail_payment_allocations (
    id, sale_id, method, amount_minor, ordinal
  )
  SELECT
    id, sale_id, method, amount_minor, ordinal
  FROM retail_payment_allocations_038_backup;

  CREATE TABLE retail_operation_receipts (
    operation_kind TEXT NOT NULL,
    client_operation_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(
      typeof(schema_version)='integer' AND schema_version>0
    ),
    payload_hash TEXT NOT NULL,
    sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT,
    accepted_at TEXT NOT NULL,
    PRIMARY KEY(operation_kind,client_operation_id)
  );

  INSERT INTO retail_operation_receipts (
    operation_kind,
    client_operation_id,
    schema_version,
    payload_hash,
    sale_id,
    accepted_at
  )
  SELECT
    operation_kind,
    client_operation_id,
    schema_version,
    payload_hash,
    sale_id,
    accepted_at
  FROM retail_operation_receipts_038_backup;

  DROP TABLE retail_sale_items_038_backup;
  DROP TABLE retail_payment_allocations_038_backup;
  DROP TABLE retail_operation_receipts_038_backup;

  CREATE INDEX retail_sales_location_completed_idx
    ON retail_sales(location_id,completed_at,id);

  CREATE TRIGGER retail_sales_no_update
    BEFORE UPDATE ON retail_sales
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale is immutable.');
    END;

  CREATE TRIGGER retail_sales_no_delete
    BEFORE DELETE ON retail_sales
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale is immutable.');
    END;

  CREATE TRIGGER retail_sale_items_no_update
    BEFORE UPDATE ON retail_sale_items
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale Items are immutable.');
    END;

  CREATE TRIGGER retail_sale_items_no_delete
    BEFORE DELETE ON retail_sale_items
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale Items are immutable.');
    END;

  CREATE TRIGGER retail_payment_allocations_no_update
    BEFORE UPDATE ON retail_payment_allocations
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Payment Allocations are immutable.');
    END;

  CREATE TRIGGER retail_payment_allocations_no_delete
    BEFORE DELETE ON retail_payment_allocations
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Payment Allocations are immutable.');
    END;

  CREATE TABLE retail_sale_item_discounts (
    sale_item_id TEXT PRIMARY KEY
      REFERENCES retail_sale_items(id) ON DELETE RESTRICT,
    amount_minor INTEGER NOT NULL CHECK(
      typeof(amount_minor)='integer' AND amount_minor>0
    ),
    authorized_by TEXT NOT NULL
      REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
  );

  CREATE TRIGGER retail_sale_item_discounts_no_update
    BEFORE UPDATE ON retail_sale_item_discounts
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale Item Discounts are immutable.');
    END;

  CREATE TRIGGER retail_sale_item_discounts_no_delete
    BEFORE DELETE ON retail_sale_item_discounts
    BEGIN
      SELECT RAISE(ABORT,'Completed Retail Sale Item Discounts are immutable.');
    END;
`)
const retailSaleReturns = createSqlMigration('039_retail_sale_returns_v1', `
  CREATE TABLE retail_sale_returns (
    id TEXT PRIMARY KEY,
    original_sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    currency_code TEXT NOT NULL,
    currency_exponent INTEGER NOT NULL CHECK(typeof(currency_exponent)='integer' AND currency_exponent BETWEEN 0 AND 9),
    completed_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  );
  CREATE INDEX retail_sale_returns_sale_completed_idx ON retail_sale_returns(original_sale_id,completed_at,id);
  CREATE TABLE retail_sale_return_items (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES retail_sale_returns(id) ON DELETE RESTRICT,
    original_sale_item_id TEXT NOT NULL REFERENCES retail_sale_items(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
    refunded_amount_minor INTEGER NOT NULL CHECK(typeof(refunded_amount_minor)='integer' AND refunded_amount_minor>0),
    UNIQUE(return_id,original_sale_item_id)
  );
  CREATE TABLE retail_sale_return_refund_allocations (
    id TEXT PRIMARY KEY,
    return_id TEXT NOT NULL REFERENCES retail_sale_returns(id) ON DELETE RESTRICT,
    original_payment_allocation_id TEXT NOT NULL REFERENCES retail_payment_allocations(id) ON DELETE RESTRICT,
    amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
    UNIQUE(return_id,original_payment_allocation_id)
  );
  CREATE TABLE retail_sale_return_operation_receipts (
    client_operation_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK(typeof(schema_version)='integer' AND schema_version>0),
    payload_hash TEXT NOT NULL,
    return_id TEXT NOT NULL REFERENCES retail_sale_returns(id) ON DELETE RESTRICT,
    accepted_at TEXT NOT NULL
  );
  CREATE TRIGGER retail_sale_returns_no_update BEFORE UPDATE ON retail_sale_returns BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Returns are immutable.'); END;
  CREATE TRIGGER retail_sale_returns_no_delete BEFORE DELETE ON retail_sale_returns BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Returns are immutable.'); END;
  CREATE TRIGGER retail_sale_return_items_no_update BEFORE UPDATE ON retail_sale_return_items BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Return Items are immutable.'); END;
  CREATE TRIGGER retail_sale_return_items_no_delete BEFORE DELETE ON retail_sale_return_items BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Return Items are immutable.'); END;
  CREATE TRIGGER retail_sale_return_refund_allocations_no_update BEFORE UPDATE ON retail_sale_return_refund_allocations BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Return Refund Allocations are immutable.'); END;
  CREATE TRIGGER retail_sale_return_refund_allocations_no_delete BEFORE DELETE ON retail_sale_return_refund_allocations BEGIN SELECT RAISE(ABORT,'Completed Retail Sale Return Refund Allocations are immutable.'); END;
  CREATE TRIGGER retail_sale_return_operation_receipts_no_update BEFORE UPDATE ON retail_sale_return_operation_receipts BEGIN SELECT RAISE(ABORT,'Retail Sale Return operation receipts are immutable.'); END;
  CREATE TRIGGER retail_sale_return_operation_receipts_no_delete BEFORE DELETE ON retail_sale_return_operation_receipts BEGIN SELECT RAISE(ABORT,'Retail Sale Return operation receipts are immutable.'); END;
`)
const retailOfflineAuthorityFoundation = createSqlMigration('040_retail_offline_authority_foundation_v1', `
  CREATE TABLE retail_offline_terminals (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    current_key_version INTEGER NOT NULL CHECK(typeof(current_key_version)='integer' AND current_key_version>0),
    enrolled_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    enrolled_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE retail_offline_terminal_keys (
    terminal_id TEXT NOT NULL REFERENCES retail_offline_terminals(id) ON DELETE RESTRICT,
    key_version INTEGER NOT NULL CHECK(typeof(key_version)='integer' AND key_version>0),
    key_algorithm TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY(terminal_id,key_version),
    UNIQUE(terminal_id,public_key)
  );
  CREATE TABLE retail_offline_terminal_revocations (
    terminal_id TEXT PRIMARY KEY REFERENCES retail_offline_terminals(id) ON DELETE RESTRICT,
    revoked_at TEXT NOT NULL,
    revoked_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL
  );
  CREATE TABLE retail_offline_authorities (
    id TEXT PRIMARY KEY,
    authority_version INTEGER NOT NULL CHECK(typeof(authority_version)='integer' AND authority_version>0),
    terminal_id TEXT NOT NULL,
    terminal_key_version INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    currency_code TEXT NOT NULL CHECK(typeof(currency_code)='text' AND length(currency_code)=3 AND currency_code GLOB '[A-Z][A-Z][A-Z]'),
    currency_exponent INTEGER NOT NULL CHECK(typeof(currency_exponent)='integer' AND currency_exponent BETWEEN 0 AND 9),
    payment_method TEXT NOT NULL CHECK(payment_method='cash'),
    discounts_allowed INTEGER NOT NULL CHECK(discounts_allowed=0),
    permit_count INTEGER NOT NULL CHECK(typeof(permit_count)='integer' AND permit_count>0),
    issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY(terminal_id,terminal_key_version) REFERENCES retail_offline_terminal_keys(terminal_id,key_version),
    CHECK(expires_at > issued_at)
  );
  CREATE TABLE retail_offline_authority_product_prices (
    authority_id TEXT NOT NULL REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    unit_price_minor INTEGER NOT NULL CHECK(typeof(unit_price_minor)='integer' AND unit_price_minor>0),
    PRIMARY KEY(authority_id,product_id)
  );
  CREATE TABLE retail_offline_authority_permits (
    id TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence>=0),
    UNIQUE(authority_id,sequence)
  );
  CREATE TABLE retail_offline_authority_revocations (
    authority_id TEXT PRIMARY KEY REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    revoked_at TEXT NOT NULL,
    revoked_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL
  );
  CREATE TABLE retail_offline_sale_evidence (
    offline_operation_id TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    authority_version INTEGER NOT NULL,
    permit_id TEXT NOT NULL REFERENCES retail_offline_authority_permits(id) ON DELETE RESTRICT,
    terminal_id TEXT NOT NULL,
    terminal_key_version INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    proposed_sale_id TEXT NOT NULL,
    claimed_completed_at TEXT NOT NULL,
    canonical_payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE(authority_id,permit_id),
    FOREIGN KEY(terminal_id,terminal_key_version) REFERENCES retail_offline_terminal_keys(terminal_id,key_version)
  );
  CREATE TRIGGER retail_offline_terminal_keys_no_update BEFORE UPDATE ON retail_offline_terminal_keys BEGIN SELECT RAISE(ABORT,'Retail Offline Terminal keys are immutable.'); END;
  CREATE TRIGGER retail_offline_terminal_keys_no_delete BEFORE DELETE ON retail_offline_terminal_keys BEGIN SELECT RAISE(ABORT,'Retail Offline Terminal keys are immutable.'); END;
  CREATE TRIGGER retail_offline_terminal_revocations_no_update BEFORE UPDATE ON retail_offline_terminal_revocations BEGIN SELECT RAISE(ABORT,'Retail Offline Terminal revocations are immutable.'); END;
  CREATE TRIGGER retail_offline_terminal_revocations_no_delete BEFORE DELETE ON retail_offline_terminal_revocations BEGIN SELECT RAISE(ABORT,'Retail Offline Terminal revocations are immutable.'); END;
  CREATE TRIGGER retail_offline_authorities_no_update BEFORE UPDATE ON retail_offline_authorities BEGIN SELECT RAISE(ABORT,'Retail Offline Authorities are immutable.'); END;
  CREATE TRIGGER retail_offline_authorities_no_delete BEFORE DELETE ON retail_offline_authorities BEGIN SELECT RAISE(ABORT,'Retail Offline Authorities are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_product_prices_no_update BEFORE UPDATE ON retail_offline_authority_product_prices BEGIN SELECT RAISE(ABORT,'Retail Offline Authority Product prices are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_product_prices_no_delete BEFORE DELETE ON retail_offline_authority_product_prices BEGIN SELECT RAISE(ABORT,'Retail Offline Authority Product prices are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_permits_no_update BEFORE UPDATE ON retail_offline_authority_permits BEGIN SELECT RAISE(ABORT,'Retail Offline Authority permits are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_permits_no_delete BEFORE DELETE ON retail_offline_authority_permits BEGIN SELECT RAISE(ABORT,'Retail Offline Authority permits are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_revocations_no_update BEFORE UPDATE ON retail_offline_authority_revocations BEGIN SELECT RAISE(ABORT,'Retail Offline Authority revocations are immutable.'); END;
  CREATE TRIGGER retail_offline_authority_revocations_no_delete BEFORE DELETE ON retail_offline_authority_revocations BEGIN SELECT RAISE(ABORT,'Retail Offline Authority revocations are immutable.'); END;
  CREATE TRIGGER retail_offline_sale_evidence_no_update BEFORE UPDATE ON retail_offline_sale_evidence BEGIN SELECT RAISE(ABORT,'Retail Offline Sale evidence is immutable.'); END;
  CREATE TRIGGER retail_offline_sale_evidence_no_delete BEFORE DELETE ON retail_offline_sale_evidence BEGIN SELECT RAISE(ABORT,'Retail Offline Sale evidence is immutable.'); END;
`)
const retailOfflineSaleSync = createSqlMigration('041_retail_offline_sale_sync_v1', `
  CREATE TABLE retail_offline_sale_sync_receipts (
    offline_operation_id TEXT PRIMARY KEY REFERENCES retail_offline_sale_evidence(offline_operation_id) ON DELETE RESTRICT,
    payload_hash TEXT NOT NULL,
    sale_id TEXT NOT NULL UNIQUE REFERENCES retail_sales(id) ON DELETE RESTRICT,
    accepted_at TEXT NOT NULL
  );
  CREATE TRIGGER retail_offline_sale_sync_receipts_no_update BEFORE UPDATE ON retail_offline_sale_sync_receipts BEGIN SELECT RAISE(ABORT,'Retail Offline Sale sync receipts are immutable.'); END;
  CREATE TRIGGER retail_offline_sale_sync_receipts_no_delete BEFORE DELETE ON retail_offline_sale_sync_receipts BEGIN SELECT RAISE(ABORT,'Retail Offline Sale sync receipts are immutable.'); END;
`)
const retailOfflineStockConflictVerification = createSqlMigration('042_retail_offline_stock_conflict_verification_v1', `
  CREATE TABLE retail_offline_stock_conflict_verifications (
    offline_operation_id TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    authority_version INTEGER NOT NULL,
    permit_id TEXT NOT NULL REFERENCES retail_offline_authority_permits(id) ON DELETE RESTRICT,
    terminal_id TEXT NOT NULL,
    terminal_key_version INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    currency_code TEXT NOT NULL,
    currency_exponent INTEGER NOT NULL,
    proposed_sale_id TEXT NOT NULL UNIQUE,
    cash_allocation_id TEXT NOT NULL UNIQUE,
    claimed_completed_at TEXT NOT NULL,
    canonical_payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    first_received_at TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    verification_schema_version INTEGER NOT NULL CHECK(verification_schema_version=1),
    UNIQUE(authority_id, permit_id),
    FOREIGN KEY(terminal_id, terminal_key_version) REFERENCES retail_offline_terminal_keys(terminal_id, key_version)
  );
  CREATE TABLE retail_offline_stock_conflict_verification_lines (
    offline_operation_id TEXT NOT NULL REFERENCES retail_offline_stock_conflict_verifications(offline_operation_id) ON DELETE RESTRICT,
    sale_item_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity>0),
    authorized_unit_price_minor INTEGER NOT NULL CHECK(typeof(authorized_unit_price_minor)='integer' AND authorized_unit_price_minor>0),
    observed_on_hand_quantity INTEGER NOT NULL CHECK(typeof(observed_on_hand_quantity)='integer' AND observed_on_hand_quantity>=0),
    initial_deficit_quantity INTEGER NOT NULL CHECK(typeof(initial_deficit_quantity)='integer' AND initial_deficit_quantity>=0),
    PRIMARY KEY(offline_operation_id, sale_item_id),
    UNIQUE(offline_operation_id, product_id)
  );
  CREATE INDEX retail_offline_stock_conflict_verifications_location_received_idx ON retail_offline_stock_conflict_verifications(location_id, first_received_at, offline_operation_id);
  CREATE TRIGGER retail_offline_stock_conflict_verifications_no_update BEFORE UPDATE ON retail_offline_stock_conflict_verifications BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict verification is immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_verifications_no_delete BEFORE DELETE ON retail_offline_stock_conflict_verifications BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict verification is immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_verification_lines_no_update BEFORE UPDATE ON retail_offline_stock_conflict_verification_lines BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict verification lines are immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_verification_lines_no_delete BEFORE DELETE ON retail_offline_stock_conflict_verification_lines BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict verification lines are immutable.'); END;
`)
const retailOfflineStockConflictMaterialization = createSqlMigration('043_retail_offline_stock_conflict_materialization_v1', `
  CREATE TABLE retail_inventory_balances_v2 (
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    on_hand_quantity INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (product_id, location_id)
  );
  INSERT INTO retail_inventory_balances_v2(product_id,location_id,on_hand_quantity,updated_at) SELECT product_id,location_id,on_hand_quantity,updated_at FROM retail_inventory_balances;
  DROP TABLE retail_inventory_balances;
  ALTER TABLE retail_inventory_balances_v2 RENAME TO retail_inventory_balances;
  CREATE TABLE retail_offline_stock_conflict_materialization_receipts (
    command_id TEXT PRIMARY KEY,
    offline_operation_id TEXT NOT NULL UNIQUE REFERENCES retail_offline_stock_conflict_verifications(offline_operation_id) ON DELETE RESTRICT,
    payload_hash TEXT NOT NULL,
    sale_id TEXT NOT NULL UNIQUE REFERENCES retail_sales(id) ON DELETE RESTRICT,
    materialized_at TEXT NOT NULL,
    materialized_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  );
  CREATE TABLE retail_offline_stock_conflict_incidents (
    offline_operation_id TEXT NOT NULL REFERENCES retail_offline_stock_conflict_verifications(offline_operation_id) ON DELETE RESTRICT,
    sale_item_id TEXT NOT NULL REFERENCES retail_sale_items(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    sale_id TEXT NOT NULL REFERENCES retail_sales(id) ON DELETE RESTRICT,
    movement_id TEXT NOT NULL REFERENCES retail_inventory_movements(id) ON DELETE RESTRICT,
    authority_id TEXT NOT NULL REFERENCES retail_offline_authorities(id) ON DELETE RESTRICT,
    permit_id TEXT NOT NULL REFERENCES retail_offline_authority_permits(id) ON DELETE RESTRICT,
    terminal_id TEXT NOT NULL REFERENCES retail_offline_terminals(id) ON DELETE RESTRICT,
    terminal_key_version INTEGER NOT NULL,
    observed_on_hand_quantity INTEGER NOT NULL,
    sold_quantity INTEGER NOT NULL,
    resulting_on_hand_quantity INTEGER NOT NULL,
    initial_deficit_quantity INTEGER NOT NULL,
    materialization_deficit_quantity INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status='open'),
    policy_version INTEGER NOT NULL CHECK(policy_version=1),
    opened_at TEXT NOT NULL,
    PRIMARY KEY (offline_operation_id, sale_item_id)
  );
  CREATE INDEX retail_offline_stock_conflict_incidents_location_open_idx ON retail_offline_stock_conflict_incidents(location_id, status, opened_at);
  CREATE TRIGGER retail_inventory_balances_negative_insert_guard BEFORE INSERT ON retail_inventory_balances WHEN NEW.on_hand_quantity < 0 BEGIN
    SELECT RAISE(ABORT,'Retail Inventory negative balance requires verified Offline Stock Conflict materialization.') WHERE NOT EXISTS (
      SELECT 1 FROM retail_inventory_movements movement
      JOIN retail_offline_stock_conflict_materialization_receipts receipt ON receipt.offline_operation_id=movement.source_id
      JOIN retail_offline_stock_conflict_verification_lines line ON line.offline_operation_id=movement.source_id AND line.sale_item_id=movement.source_line_id
      WHERE movement.source_type='retail_offline_stock_conflict_materialization' AND movement.movement_type='sale'
        AND movement.product_id=NEW.product_id AND movement.location_id=NEW.location_id AND movement.created_at=NEW.updated_at
    );
  END;
  CREATE TRIGGER retail_inventory_balances_negative_update_guard BEFORE UPDATE OF on_hand_quantity,updated_at ON retail_inventory_balances WHEN NEW.on_hand_quantity < 0 BEGIN
    SELECT RAISE(ABORT,'Retail Inventory negative balance requires verified Offline Stock Conflict materialization.') WHERE NOT EXISTS (
      SELECT 1 FROM retail_inventory_movements movement
      JOIN retail_offline_stock_conflict_materialization_receipts receipt ON receipt.offline_operation_id=movement.source_id
      JOIN retail_offline_stock_conflict_verification_lines line ON line.offline_operation_id=movement.source_id AND line.sale_item_id=movement.source_line_id
      WHERE movement.source_type='retail_offline_stock_conflict_materialization' AND movement.movement_type='sale'
        AND movement.product_id=NEW.product_id AND movement.location_id=NEW.location_id AND movement.created_at=NEW.updated_at
    );
  END;
  CREATE TRIGGER retail_offline_stock_conflict_materialization_receipts_no_update BEFORE UPDATE ON retail_offline_stock_conflict_materialization_receipts BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict materialization receipts are immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_materialization_receipts_no_delete BEFORE DELETE ON retail_offline_stock_conflict_materialization_receipts BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict materialization receipts are immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_incidents_no_update BEFORE UPDATE ON retail_offline_stock_conflict_incidents BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict incidents are immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_incidents_no_delete BEFORE DELETE ON retail_offline_stock_conflict_incidents BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict incidents are immutable.'); END;
`)

const retailOfflineStockConflictLifecycle = createSqlMigration('044_retail_offline_stock_conflict_lifecycle_v1', `
  CREATE TABLE retail_offline_stock_conflict_incident_lifecycle (
    offline_operation_id TEXT NOT NULL,
    sale_item_id TEXT NOT NULL,
    location_id TEXT NOT NULL REFERENCES retail_locations(id) ON DELETE RESTRICT,
    product_id TEXT NOT NULL REFERENCES retail_products(id) ON DELETE RESTRICT,
    current_state TEXT NOT NULL CHECK(current_state IN ('open','under_review')),
    version INTEGER NOT NULL CHECK(version >= 1),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY(offline_operation_id,sale_item_id),
    FOREIGN KEY(offline_operation_id,sale_item_id) REFERENCES retail_offline_stock_conflict_incidents(offline_operation_id,sale_item_id) ON DELETE RESTRICT
  );
  INSERT INTO retail_offline_stock_conflict_incident_lifecycle(offline_operation_id,sale_item_id,location_id,product_id,current_state,version,updated_at,updated_by)
  SELECT offline_operation_id,sale_item_id,location_id,product_id,'open',1,opened_at,(SELECT materialized_by FROM retail_offline_stock_conflict_materialization_receipts r WHERE r.offline_operation_id=i.offline_operation_id)
  FROM retail_offline_stock_conflict_incidents i;
  CREATE TABLE retail_offline_stock_conflict_incident_events (
    event_id TEXT PRIMARY KEY,
    offline_operation_id TEXT NOT NULL,
    sale_item_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type='review_started'),
    previous_state TEXT NOT NULL CHECK(previous_state='open'),
    resulting_state TEXT NOT NULL CHECK(resulting_state='under_review'),
    command_id TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY(offline_operation_id,sale_item_id) REFERENCES retail_offline_stock_conflict_incidents(offline_operation_id,sale_item_id) ON DELETE RESTRICT
  );
  CREATE INDEX retail_offline_stock_conflict_lifecycle_pair_idx ON retail_offline_stock_conflict_incident_lifecycle(offline_operation_id,sale_item_id);
  CREATE INDEX retail_offline_stock_conflict_lifecycle_block_idx ON retail_offline_stock_conflict_incident_lifecycle(product_id,location_id,current_state);
  CREATE INDEX retail_offline_stock_conflict_events_history_idx ON retail_offline_stock_conflict_incident_events(offline_operation_id,sale_item_id,occurred_at,event_id);
  CREATE TRIGGER retail_offline_stock_conflict_lifecycle_no_delete BEFORE DELETE ON retail_offline_stock_conflict_incident_lifecycle BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict lifecycle projection cannot be deleted.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_lifecycle_transition_guard BEFORE UPDATE ON retail_offline_stock_conflict_incident_lifecycle WHEN NOT(OLD.current_state='open' AND NEW.current_state='under_review' AND NEW.version=OLD.version+1) BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict lifecycle transition is invalid.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_events_no_update BEFORE UPDATE ON retail_offline_stock_conflict_incident_events BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict lifecycle events are immutable.'); END;
  CREATE TRIGGER retail_offline_stock_conflict_events_no_delete BEFORE DELETE ON retail_offline_stock_conflict_incident_events BEGIN SELECT RAISE(ABORT,'Retail Offline Stock Conflict lifecycle events are immutable.'); END;
`)
export const retailMigrations = [retailAccessLocations, retailProductsBarcodes, retailInventoryLedger, retailInventoryReconciliation, retailGoodsReceipts, retailTransfers, retailSalesPaymentCompletion, retailSaleDiscounts, retailSaleReturns, retailOfflineAuthorityFoundation, retailOfflineSaleSync, retailOfflineStockConflictVerification, retailOfflineStockConflictMaterialization, retailOfflineStockConflictLifecycle] as const
