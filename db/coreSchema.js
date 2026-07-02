'use strict';

const { ensureFinanceSchema } = require('./financeSchema');

function tableColumns(db, table) {
  return db.pragma(`table_info(${table})`).map(column => column.name);
}

function ensureColumn(db, table, column, definition) {
  if (tableColumns(db, table).includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[DB] Migration: ${table}.${column} added`);
}

function intakeSourceIdentityDuplicates(db) {
  return db.prepare(`
    SELECT source_system, external_id, COUNT(*) AS count
    FROM intake_log
    WHERE source_system IS NOT NULL AND source_system <> ''
      AND external_id IS NOT NULL AND external_id <> ''
    GROUP BY source_system, external_id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 5
  `).all();
}

function warnSkippedIntakeSourceIdentityIndex(reason, duplicates = []) {
  const sample = duplicates
    .map(row => `${row.source_system}/${row.external_id} (${row.count})`)
    .join(', ');
  console.warn(
    '[DB] Migration warning: intake_log source identity unique index was not created: ' +
    reason +
    (sample ? `. Duplicate sample: ${sample}` : '')
  );
}

function ensureIntakeSourceIdentityIndex(db) {
  ensureColumn(db, 'intake_log', 'source_system', 'TEXT');
  ensureColumn(db, 'intake_log', 'external_id', 'TEXT');
  const duplicates = intakeSourceIdentityDuplicates(db);
  if (duplicates.length) {
    warnSkippedIntakeSourceIdentityIndex('existing duplicate source_system/external_id values must be reviewed first', duplicates);
    return;
  }
  const sql = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_log_source_identity
      ON intake_log(source_system, external_id)
      WHERE source_system IS NOT NULL AND external_id IS NOT NULL;
  `;
  try {
    db.exec(sql);
  } catch (error) {
    const currentDuplicates = intakeSourceIdentityDuplicates(db);
    if (/UNIQUE constraint failed|constraint failed/i.test(String(error.message || '')) && currentDuplicates.length) {
      warnSkippedIntakeSourceIdentityIndex(error.message, currentDuplicates);
      return;
    }
    throw error;
  }
}
function ensureCoreSchema(db) {
  // ── SCHEMA ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      tax_id TEXT,
      payment_terms TEXT,
      portal_price_list_visibility TEXT DEFAULT 'none',
      portal_can_manage_users INTEGER DEFAULT 0,
      portal_can_create_sites INTEGER DEFAULT 0,
      portal_can_set_budgets INTEGER DEFAULT 0,
      portal_can_expose_prices INTEGER DEFAULT 0,
      contact_name TEXT,
      contact_phone TEXT,
      priority_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_portal_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS customer_guarantee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      portal_user_id INTEGER,
      original_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      data_url TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'uploaded_pending_review',
      notes TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS customer_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      status TEXT DEFAULT 'active',
      manager_name TEXT,
      manager_phone TEXT,
      budget_amount REAL DEFAULT 0,
      budget_kg REAL DEFAULT 0,
      alert_pct REAL DEFAULT 80,
      block_over_budget INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('orderer','approver','both','finance','field_manager','customer_admin')),
      active INTEGER NOT NULL DEFAULT 1,
      token TEXT,
      token_expires_at TEXT,
      password_hash TEXT,
      password_changed_at TEXT,
      can_manage_users INTEGER DEFAULT 0,
      can_create_sites INTEGER DEFAULT 0,
      can_assign_site_users INTEGER DEFAULT 0,
      can_create_orders INTEGER DEFAULT 1,
      can_approve_orders INTEGER DEFAULT 0,
      can_view_prices INTEGER DEFAULT 0,
      can_view_budget INTEGER DEFAULT 0,
      can_set_budget INTEGER DEFAULT 0,
      can_approve_budget_overrun INTEGER DEFAULT 0,
      can_view_invoices INTEGER DEFAULT 0,
      can_view_delivery_notes INTEGER DEFAULT 1,
      can_view_payment_alerts INTEGER DEFAULT 0,
      default_site_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (default_site_id) REFERENCES customer_sites(id)
    );

    CREATE TABLE IF NOT EXISTS customer_site_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      site_id INTEGER NOT NULL,
      portal_user_id INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(site_id, portal_user_id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (site_id) REFERENCES customer_sites(id),
      FOREIGN KEY (portal_user_id) REFERENCES portal_users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_portal_permission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      actor_portal_user_id INTEGER,
      target_portal_user_id INTEGER,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (actor_portal_user_id) REFERENCES portal_users(id),
      FOREIGN KEY (target_portal_user_id) REFERENCES portal_users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_num TEXT UNIQUE NOT NULL,
      stable_order_id TEXT,
      customer_id INTEGER,
      channel TEXT DEFAULT 'טלפון',
      delivery_date TEXT,
      delivery_time TEXT,
      delivery_address TEXT,
      priority TEXT DEFAULT 'רגיל',
      status TEXT DEFAULT 'ממתינה לאישור',
      total_weight REAL DEFAULT 0,
      waste_pct_charged REAL DEFAULT 3,
      billing_weight REAL DEFAULT 0,
      driver_notes TEXT,
      general_notes TEXT,
      priority_order_id TEXT,
      created_by INTEGER,
      approved_by INTEGER,
      approved_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_sequences (
      prefix TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      pallet_num INTEGER,
      max_weight REAL DEFAULT 500,
      total_weight REAL DEFAULT 0,
      status TEXT DEFAULT 'ממתין',
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pallet_id INTEGER,
      order_id INTEGER,
      item_uid TEXT,
      shape_snapshot_json TEXT,
      shape_id TEXT,
      shape_name TEXT,
      diameter REAL,
      spiral_diameter_mm REAL,
      spiral_turns REAL,
      segments JSON,
      total_length_mm REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      production_qty INTEGER DEFAULT 0,
      weight_per_unit REAL DEFAULT 0,
      total_weight REAL DEFAULT 0,
      struct_element TEXT,
      struct_floor TEXT,
      sheet_num TEXT,
      machine TEXT,
      status TEXT DEFAULT 'ממתין',
      started_at DATETIME,
      completed_at DATETIME,
      worker_id INTEGER,
      produced_qty INTEGER DEFAULT 0,
      actual_waste INTEGER DEFAULT 0,
      actual_weight_kg REAL,
      weight_deviation_pct REAL,
      review_status TEXT,
      review_notes TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      note TEXT,
      FOREIGN KEY (pallet_id) REFERENCES pallets(id)
    );

    CREATE TABLE IF NOT EXISTS production_card_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      card_index INTEGER NOT NULL,
      card_total INTEGER NOT NULL DEFAULT 1,
      card_qty INTEGER DEFAULT 0,
      target_weight_kg REAL DEFAULT 0,
      actual_weight_kg REAL NOT NULL,
      weight_deviation_pct REAL,
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, card_index, card_total),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT,
      port TEXT,
      slave_id INTEGER DEFAULT 1,
      min_diameter REAL DEFAULT 8,
      max_diameter REAL DEFAULT 12,
      single_min_diameter REAL DEFAULT 8,
      single_max_diameter REAL DEFAULT 32,
      double_min_diameter REAL DEFAULT 8,
      double_max_diameter REAL DEFAULT 16,
      status TEXT DEFAULT 'לא מחובר',
      current_order_num TEXT,
      current_item_id INTEGER,
      counter INTEGER DEFAULT 0,
      last_seen DATETIME
    );

    CREATE TABLE IF NOT EXISTS shapes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bends INTEGER DEFAULT 0,
      sides_default JSON,
      angles_default JSON,
      emoji TEXT DEFAULT '⬡',
      description TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'ייצור',
      language TEXT DEFAULT 'he',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER,
      worker_id INTEGER,
      item_id INTEGER,
      order_num TEXT,
      action TEXT,
      counter_at_scan INTEGER DEFAULT 0,
      waste_calculated INTEGER DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      active INTEGER DEFAULT 1,
      current_lat REAL,
      current_lng REAL,
      last_location_update DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_desc TEXT,
      license_plate TEXT UNIQUE,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_year INTEGER,
      test_expiry TEXT,
      insurance_expiry TEXT,
      next_service_date TEXT,
      next_service_km INTEGER,
      odometer_km INTEGER DEFAULT 0,
      vehicle_status TEXT DEFAULT 'active',
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER,
      vehicle_id INTEGER,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      odometer_km INTEGER,
      amount REAL DEFAULT 0,
      vendor TEXT,
      reference TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      title TEXT,
      file_name TEXT,
      mime_type TEXT,
      data_url TEXT,
      expiry_date TEXT,
      notes TEXT,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      driver_id INTEGER,
      scheduled_date TEXT,
      status TEXT DEFAULT 'ממתין',
      departed_at DATETIME,
      delivered_at DATETIME,
      signature_data TEXT,
      photo_url TEXT,
      notes TEXT,
      problem_type TEXT,
      problem_notes TEXT,
      delivery_lat REAL,
      delivery_lng REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      level TEXT DEFAULT 'warning',
      message TEXT,
      order_id INTEGER,
      machine_id INTEGER,
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intake_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      source_system TEXT,
      external_id TEXT,
      raw_content TEXT,
      parsed_data JSON,
      original_filename TEXT,
      original_mime TEXT,
      original_data_url TEXT,
      order_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intake_training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      document_type TEXT DEFAULT 'general',
      problem_text TEXT NOT NULL,
      correction_text TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_receipt_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT DEFAULT 'supplier_delivery_note',
      original_filename TEXT,
      original_mime TEXT,
      original_data_url TEXT,
      supplier_id INTEGER,
      supplier_name TEXT,
      delivery_note_num TEXT,
      parsed_data JSON,
      status TEXT DEFAULT 'pending_review',
      raw_material_ids TEXT,
      reviewed_by INTEGER,
      review_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS companies (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      ownership_pct REAL DEFAULT 100,
      erp_type TEXT DEFAULT 'none',
      color TEXT DEFAULT '#e07b39',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── RAW MATERIAL INVENTORY ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      phone       TEXT,
      contact     TEXT,
      email       TEXT,
      address     TEXT,
      payment_terms TEXT,
      notes       TEXT,
      active      INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS raw_material (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      material_type   TEXT DEFAULT 'coil',  -- 'coil' | 'straight' | 'bent'
      diameter        INTEGER NOT NULL,
      supplier_id     INTEGER,
      lot_number      TEXT,
      certificate_num TEXT,
      grade           TEXT DEFAULT 'B500B', -- steel grade
      received_date   TEXT,
      weight_received REAL DEFAULT 0,       -- kg received
      weight_used     REAL DEFAULT 0,       -- kg consumed so far
      weight_scrapped REAL DEFAULT 0,       -- kg scrapped/waste
      purchase_price  REAL DEFAULT 0,       -- ₪/ton
      warehouse_loc   TEXT,                 -- e.g. "מדף A3"
      bending_shape_name TEXT,
      bending_shape_segments TEXT,
      bending_shape_source TEXT,
      bending_shape_confidence REAL,
      notes           TEXT,
      active          INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS raw_material_usage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_material_id INTEGER,
      order_id        INTEGER,
      item_id         INTEGER,
      weight_used     REAL DEFAULT 0,
      allocation_policy TEXT,
      used_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (raw_material_id) REFERENCES raw_material(id)
    );

    -- ── AUDIT LOG ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,  -- 'order' | 'item' | 'customer' | 'delivery' etc.
      entity_id   INTEGER,
      entity_ref  TEXT,           -- e.g. order_num
      action      TEXT NOT NULL,  -- 'status_change' | 'create' | 'update' | 'delete'
      field_name  TEXT,           -- which field changed
      old_value   TEXT,
      new_value   TEXT,
      user_id     INTEGER,
      user_name   TEXT,
      notes       TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── USERS / ROLES ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role        TEXT DEFAULT 'operator',  -- 'admin' | 'manager' | 'operator' | 'driver' | 'quality'
      pin         TEXT,                     -- 4-digit PIN for tablet login
      phone       TEXT,
      active      INTEGER DEFAULT 1,
      last_login  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── QUALITY CONTROL ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS quality_checks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id       INTEGER,
      order_id      INTEGER,
      order_num     TEXT,
      inspector_id  INTEGER,
      check_type    TEXT DEFAULT 'length',  -- 'length' | 'angle' | 'visual' | 'full'
      sample_qty    INTEGER DEFAULT 1,
      pass_qty      INTEGER DEFAULT 0,
      fail_qty      INTEGER DEFAULT 0,
      deviation_mm  REAL DEFAULT 0,
      deviation_deg REAL DEFAULT 0,
      result        TEXT DEFAULT 'pass',    -- 'pass' | 'fail' | 'conditional'
      action_taken  TEXT,                   -- 'accepted' | 'rejected' | 'rework'
      photo_url     TEXT,
      notes         TEXT,
      checked_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    -- ── MAINTENANCE ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id    INTEGER,
      log_type      TEXT DEFAULT 'breakdown',  -- 'breakdown' | 'preventive' | 'repair' | 'inspection'
      description   TEXT,
      reported_by   INTEGER,
      assigned_to   INTEGER,
      status        TEXT DEFAULT 'פתוחה',  -- 'פתוחה' | 'בטיפול' | 'סגורה'
      priority      TEXT DEFAULT 'רגיל',   -- 'דחוף' | 'גבוה' | 'רגיל' | 'נמוך'
      downtime_min  INTEGER DEFAULT 0,      -- minutes machine was down
      root_cause    TEXT,
      fix_notes     TEXT,
      parts_used    TEXT,
      cost          REAL DEFAULT 0,
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at   DATETIME,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── PROJECTS & SITES ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER,
      name          TEXT NOT NULL,
      project_num   TEXT,           -- internal project number
      status        TEXT DEFAULT 'פעיל',   -- 'פעיל' | 'הושלם' | 'עצור' | 'ביטול'
      start_date    TEXT,
      end_date      TEXT,
      total_budget  REAL DEFAULT 0,
      contact_name  TEXT,
      contact_phone TEXT,
      notes         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER,
      customer_id   INTEGER,
      name          TEXT NOT NULL,
      address       TEXT,
      lat           REAL,
      lng           REAL,
      contact_name  TEXT,
      contact_phone TEXT,
      access_notes  TEXT,
      active        INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── CREDIT ACCOUNTS ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS credit_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER UNIQUE,
      credit_limit  REAL DEFAULT 0,         -- ₪ max outstanding
      current_debt  REAL DEFAULT 0,         -- ₪ current open balance
      payment_terms INTEGER DEFAULT 30,     -- days (net 30, net 60 etc)
      blocked       INTEGER DEFAULT 0,      -- 1 = blocked from new orders
      block_reason  TEXT,
      last_payment  TEXT,
      notes         TEXT,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER,
      order_id      INTEGER,
      type          TEXT,   -- 'charge' | 'payment' | 'credit_note'
      amount        REAL DEFAULT 0,
      description   TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── SHIFTS & OPERATORS ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS shifts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_type    TEXT DEFAULT 'morning',  -- 'morning'|'afternoon'|'night'
      date          TEXT NOT NULL,           -- YYYY-MM-DD
      operator_id   INTEGER,                 -- users.id
      machine_id    INTEGER,
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at      DATETIME,
      total_pieces  INTEGER DEFAULT 0,
      total_weight  REAL DEFAULT 0,
      notes         TEXT,
      FOREIGN KEY (operator_id) REFERENCES users(id),
      FOREIGN KEY (machine_id)  REFERENCES machines(id)
    );

    CREATE TABLE IF NOT EXISTS downtime_reasons (
      code  TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      color TEXT DEFAULT '#888'
    );

    CREATE TABLE IF NOT EXISTS machine_stops (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id    INTEGER,
      shift_id      INTEGER,
      reason_code   TEXT,   -- FK to downtime_reasons.code
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at      DATETIME,
      duration_min  INTEGER DEFAULT 0,
      notes         TEXT,
      reported_by   INTEGER,
      FOREIGN KEY (machine_id) REFERENCES machines(id),
      FOREIGN KEY (shift_id)   REFERENCES shifts(id)
    );

    -- ── STEEL PRICE HISTORY ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS steel_price_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      diameter      INTEGER NOT NULL,
      price_per_ton REAL NOT NULL,      -- ₪ per ton (purchase price)
      supplier_id   INTEGER,
      effective_date TEXT NOT NULL,     -- YYYY-MM-DD
      notes         TEXT,
      created_by    INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    -- ── PACKAGES (physical bundles with QR) ────────────────────────
    CREATE TABLE IF NOT EXISTS packages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      package_code  TEXT UNIQUE,        -- human-readable PKG-YYYYMMDD-NNN
      qr_data       TEXT,               -- JSON or URL for QR scan
      order_id      INTEGER,
      order_num     TEXT,
      item_ids      JSON,               -- array of item IDs in package
      quantity      INTEGER DEFAULT 0,
      weight        REAL DEFAULT 0,
      diameter      REAL,
      zone          TEXT,               -- warehouse zone e.g. "A3"
      status        TEXT DEFAULT 'packed', -- 'packed'|'staged'|'shipped'
      packed_by     INTEGER,
      packed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      shipped_at    DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- ── INVOICES (Israeli standard, כרך ט) ───────────────────────
    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_num      TEXT UNIQUE,      -- חשבונית מס' (sequential)
      invoice_type     TEXT DEFAULT 'tax_invoice', -- 'tax_invoice'|'receipt'|'credit_note'|'proforma'
      order_id         INTEGER,
      order_num        TEXT,
      customer_id      INTEGER,
      customer_name    TEXT,
      customer_vat_id  TEXT,             -- ח.פ / ע.מ
      issue_date       TEXT,             -- YYYY-MM-DD
      due_date         TEXT,
      items_json       JSON,             -- line items snapshot
      subtotal         REAL DEFAULT 0,   -- סכום לפני מע"מ
      vat_rate         REAL DEFAULT 0.18,-- 18%
      vat_amount       REAL DEFAULT 0,
      total            REAL DEFAULT 0,   -- סה"כ כולל מע"מ
      paid_amount      REAL DEFAULT 0,
      status           TEXT DEFAULT 'פתוחה', -- 'פתוחה'|'שולמה'|'חלקית'|'ביטול'
      payment_method   TEXT,             -- 'העברה'|'שיק'|'מזומן'|'אשראי'
      payment_ref      TEXT,
      notes            TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── DELIVERY NOTES ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS delivery_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      note_num      TEXT UNIQUE,        -- DN-YYYYMMDD-NNN
      order_id      INTEGER,
      order_num     TEXT,
      delivery_id   INTEGER,
      customer_id   INTEGER,
      packages_json JSON,               -- snapshot of packages
      items_json    JSON,               -- snapshot of items
      total_weight  REAL DEFAULT 0,
      driver_id     INTEGER,
      signed_by     TEXT,
      signature_data TEXT,
      issued_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at  DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- ── PRODUCTION EVENTS ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS production_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type    TEXT NOT NULL,  -- 'MachineStarted'|'MachineStopped'|'ItemComplete'|'ScrapExceeded'|'QualityFailed'|'InventoryLow'
      machine_id    INTEGER,
      item_id       INTEGER,
      order_num     TEXT,
      operator_id   INTEGER,
      shift_id      INTEGER,
      payload       JSON,           -- extra data specific to event type
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── MACHINE STATE LOG ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS machine_state_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id  INTEGER NOT NULL,
      from_state  TEXT,
      to_state    TEXT NOT NULL,
      reason      TEXT,
      operator_id INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── INCIDENTS / WAR ROOM ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS incidents (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      title            TEXT NOT NULL,
      machine_id       INTEGER,
      severity         TEXT DEFAULT 'בינוני',
      description      TEXT,
      assigned_to      TEXT,
      status           TEXT DEFAULT 'פתוח',
      financial_impact REAL DEFAULT 0,
      timeline         JSON DEFAULT '[]',
      opened_by        TEXT,
      resolved_at      DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── NCR – Non-Conformance Reports ─────────────────────────────
    CREATE TABLE IF NOT EXISTS ncr (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ncr_num           TEXT UNIQUE,
      order_id          INTEGER,
      order_num         TEXT,
      machine_id        INTEGER,
      description       TEXT NOT NULL,
      severity          TEXT DEFAULT 'בינוני',
      root_cause        TEXT,
      disposition       TEXT,
      quantity_affected INTEGER DEFAULT 0,
      diameter          REAL,
      assigned_to       TEXT,
      status            TEXT DEFAULT 'פתוח',
      closed_by         TEXT,
      closed_at         DATETIME,
      notes             TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── CAPA – Corrective & Preventive Actions ─────────────────────
    CREATE TABLE IF NOT EXISTS capa (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      capa_num            TEXT UNIQUE,
      ncr_id              INTEGER,
      title               TEXT NOT NULL,
      type                TEXT DEFAULT 'מתקן',
      problem_description TEXT,
      root_cause          TEXT,
      actions             JSON DEFAULT '[]',
      owner               TEXT,
      due_date            TEXT,
      verification_method TEXT,
      status              TEXT DEFAULT 'פתוח',
      completion_pct      INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ncr_id) REFERENCES ncr(id)
    );

    -- ── LOTO – Lockout / Tagout ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS loto (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id       INTEGER NOT NULL,
      locked_by        TEXT NOT NULL,
      reason           TEXT,
      reason_detail    TEXT,
      safety_notes     TEXT,
      status           TEXT DEFAULT 'פעיל',
      released_by      TEXT,
      release_confirmed INTEGER DEFAULT 0,
      release_notes    TEXT,
      released_at      DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── PREVENTIVE MAINTENANCE SCHEDULE ───────────────────────────
    CREATE TABLE IF NOT EXISTS pm_schedule (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id  INTEGER NOT NULL,
      pm_type     TEXT NOT NULL,
      frequency   TEXT DEFAULT 'חודשי',
      last_done   TEXT,
      next_due    TEXT,
      instructions TEXT,
      active      INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── PURCHASE ORDERS ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      po_num          TEXT UNIQUE,
      supplier_id     INTEGER,
      diameter        INTEGER,
      material_type   TEXT DEFAULT 'coil',
      quantity_ton    REAL,
      price_per_ton   REAL,
      total_amount    REAL,
      expected_date   TEXT,
      status          TEXT DEFAULT 'טיוטה',
      notes           TEXT,
      received_weight REAL,
      heat_number     TEXT,
      certificate_num TEXT,
      received_at     DATETIME,
      created_by      TEXT,
      approved_by     TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
  `);

  ensureIntakeSourceIdentityIndex(db);

  // price_category: how this item is billed in the price book
  // 'straight_standard' = bar at 6m/12m (material only)
  // 'straight_cut'      = straight bar cut to custom length (material + cutting)
  // 'bent'              = has bends (material + cutting + bending)
  // 'per_unit'          = stirrups, chairs, birds — charged per piece
  ensureColumn(db, 'items', 'price_category', "TEXT DEFAULT 'auto'");

  ensureFinanceSchema(db);
}

module.exports = {
  ensureCoreSchema,
};
