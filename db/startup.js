'use strict';

function ensureCoreSchema(db) {
  // ── SCHEMA ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
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

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_num TEXT UNIQUE NOT NULL,
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
      shape_id TEXT,
      shape_name TEXT,
      diameter REAL,
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
      note TEXT,
      FOREIGN KEY (pallet_id) REFERENCES pallets(id)
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

    CREATE TABLE IF NOT EXISTS price_list (
      diameter    INTEGER PRIMARY KEY,
      price_list  REAL DEFAULT 0,     -- מחיר מחירון (מזדמן) לק"ג
      price_cust  REAL DEFAULT 0      -- מחיר לקוח קבוע לק"ג
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

}

function runCoreMigrations(db) {
  // ── MIGRATIONS (safe column additions) ────────────────────────────
  function addCol(table, col, def) {
    const cols = db.pragma(`table_info(${table})`).map(c => c.name);
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      console.log(`[DB] Migration: ${table}.${col} added`);
    }
  }
  addCol('customers',  'email',              'TEXT');
  addCol('customers',  'notes',              'TEXT');
  addCol('drivers',    'vehicle_desc',       'TEXT');       // e.g. "משאית מרצדס 2018"
  addCol('drivers',    'license_plate',      'TEXT');       // plate number
  addCol('drivers',    'license_expiry',     'TEXT');       // YYYY-MM-DD
  addCol('drivers',    'notes',              'TEXT');
  addCol('drivers',    'vehicle_make',       'TEXT');
  addCol('drivers',    'vehicle_model',      'TEXT');
  addCol('drivers',    'vehicle_year',       'INTEGER');
  addCol('drivers',    'test_expiry',        'TEXT');
  addCol('drivers',    'insurance_expiry',   'TEXT');
  addCol('drivers',    'next_service_date',  'TEXT');
  addCol('drivers',    'next_service_km',    'INTEGER');
  addCol('drivers',    'odometer_km',        'INTEGER DEFAULT 0');
  addCol('drivers',    'vehicle_status',     "TEXT DEFAULT 'active'");
  addCol('drivers',    'vehicle_id',         'INTEGER');
  addCol('vehicles',   'vehicle_desc',       'TEXT');
  addCol('vehicles',   'license_plate',      'TEXT');
  addCol('vehicles',   'vehicle_make',       'TEXT');
  addCol('vehicles',   'vehicle_model',      'TEXT');
  addCol('vehicles',   'vehicle_year',       'INTEGER');
  addCol('vehicles',   'test_expiry',        'TEXT');
  addCol('vehicles',   'insurance_expiry',   'TEXT');
  addCol('vehicles',   'next_service_date',  'TEXT');
  addCol('vehicles',   'next_service_km',    'INTEGER');
  addCol('vehicles',   'odometer_km',        'INTEGER DEFAULT 0');
  addCol('vehicles',   'vehicle_status',     "TEXT DEFAULT 'active'");
  addCol('vehicles',   'active',             'INTEGER DEFAULT 1');
  addCol('vehicles',   'notes',              'TEXT');
  addCol('vehicle_events', 'vehicle_id',      'INTEGER');
  addCol('orders',     'waste_pct_charged',  'REAL DEFAULT 3');
  addCol('orders',     'billing_weight',     'REAL DEFAULT 0');
  addCol('orders',     'priority_order_id',  'TEXT');
  addCol('orders',     'created_by',         'INTEGER');
  addCol('pallets',    'status',             "TEXT DEFAULT 'ממתין'");
  addCol('items',      'segments',           'JSON');
  addCol('items',      'total_length_mm',    'REAL DEFAULT 0');
  addCol('items',      'production_qty',     'INTEGER DEFAULT 0');
  addCol('items',      'weight_per_unit',    'REAL DEFAULT 0');
  addCol('items',      'actual_waste',       'INTEGER DEFAULT 0');
  addCol('items',      'worker_id',          'INTEGER');
  addCol('machines',   'label',              'TEXT');
  addCol('machines',   'slave_id',           'INTEGER DEFAULT 1');
  addCol('machines',   'min_diameter',       'REAL DEFAULT 8');
  addCol('machines',   'max_diameter',       'REAL DEFAULT 12');
  addCol('machines',   'single_min_diameter','REAL DEFAULT 8');
  addCol('machines',   'single_max_diameter','REAL DEFAULT 32');
  addCol('machines',   'double_min_diameter','REAL DEFAULT 8');
  addCol('machines',   'double_max_diameter','REAL DEFAULT 16');
  addCol('machines',   'conn_mode',          "TEXT DEFAULT 'tcp'");   // 'tcp' or 'rtu'
  addCol('machines',   'tcp_host',           'TEXT');                  // IP of USR-N510 / gateway
  addCol('machines',   'tcp_port',           'INTEGER DEFAULT 502');   // Modbus TCP port
  addCol('machines',   'rtu_port',           'TEXT');                  // COM3 / /dev/ttyUSB0
  addCol('machines',   'baud_rate',          'INTEGER DEFAULT 9600');  // baud rate for RTU
  addCol('machines',   'parity',             "TEXT DEFAULT 'none'");   // none / odd / even
  addCol('machines',   'stop_bits',          'INTEGER DEFAULT 1');      // 1 or 2
  addCol('customers',  'company_id',         'INTEGER DEFAULT 1');
  addCol('orders',     'company_id',         'INTEGER DEFAULT 1');
  addCol('customers',  'portal_token',       'TEXT');              // unique link token
  addCol('customers',  'portal_token_created_at',  'TEXT');
  addCol('customers',  'portal_token_expires_at',  'TEXT');
  addCol('customers',  'portal_token_revoked_at',  'TEXT');
  addCol('customers',  'price_tier',         "TEXT DEFAULT 'list'"); // 'list' | 'customer'
  addCol('customers',  'discount_pct',       'REAL DEFAULT 0');    // extra % off
  addCol('orders',     'portal_order',       'INTEGER DEFAULT 0'); // 1 = placed by customer portal
  addCol('orders',     'portal_price',       'REAL DEFAULT 0');   // calculated price in ILS
  addCol('orders',     'confirm_token',      'TEXT');             // one-time approval token
  addCol('customers',  'price_approved_at',  'TEXT');             // last time customer approved the price list
  addCol('orders',     'site_id',            'INTEGER');          // delivery site
  addCol('orders',     'project_id',         'INTEGER');          // project reference
  addCol('orders',     'locked',             'INTEGER DEFAULT 0'); // locked after shipment
  addCol('orders',     'locked_by',          'INTEGER');
  addCol('orders',     'locked_at',          'TEXT');
  addCol('items',      'qc_status',          "TEXT DEFAULT 'לא נבדק'"); // 'לא נבדק'|'עבר'|'נכשל'
  addCol('items',      'batch_id',           'INTEGER');          // raw material batch used
  addCol('items',      'total_weight',       'REAL DEFAULT 0');   // alias for weight column (compat)
  addCol('machines',   'oee_score',          'REAL DEFAULT 0');   // OEE %
  addCol('machines',   'tons_today',         'REAL DEFAULT 0');   // tons produced today
  addCol('orders',     'cost_material',      'REAL DEFAULT 0');   // cost of steel used
  addCol('orders',     'cost_labor',         'REAL DEFAULT 0');   // estimated labor cost
  addCol('orders',     'sale_price',         'REAL DEFAULT 0');   // actual sale price ILS
  addCol('intake_log', 'original_filename',  'TEXT');
  addCol('intake_log', 'original_mime',      'TEXT');
  addCol('intake_log', 'original_data_url',  'TEXT');
  addCol('items',      'package_id',         'INTEGER');          // package assignment
  addCol('items',      'zone',               'TEXT');             // warehouse zone
  addCol('items',      'machine_id',         'INTEGER');          // FK to machines table
  addCol('items',      'is_3d',              'INTEGER DEFAULT 0'); // 1 = true 3D product (out-of-plane bends)
  addCol('machines',   'can_3d',             'INTEGER DEFAULT 0'); // 1 = machine supports 3D bending
  addCol('raw_material','bending_shape_name','TEXT');
  addCol('raw_material','bending_shape_segments','TEXT');
  addCol('raw_material','bending_shape_source','TEXT');
  addCol('raw_material','bending_shape_confidence','REAL');

  function ensureVehicleEventsSchema() {
    const cols = db.pragma('table_info(vehicle_events)');
    const driverId = cols.find(c => c.name === 'driver_id');
    if (!driverId || !driverId.notnull) return;
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        CREATE TABLE vehicle_events_new (
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
        INSERT INTO vehicle_events_new
          (id,driver_id,vehicle_id,event_type,event_date,odometer_km,amount,vendor,reference,notes,created_at)
        SELECT id,driver_id,vehicle_id,event_type,event_date,odometer_km,amount,vendor,reference,notes,created_at
        FROM vehicle_events;
        DROP TABLE vehicle_events;
        ALTER TABLE vehicle_events_new RENAME TO vehicle_events;
        COMMIT;
      `);
      console.log('[DB] Migration: vehicle_events.driver_id made nullable for independent vehicles');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  function migrateDriverVehicleRows() {
    const rows = db.prepare(`
      SELECT *
      FROM drivers
      WHERE vehicle_id IS NULL
        AND (
          COALESCE(vehicle_desc,'') <> ''
          OR COALESCE(license_plate,'') <> ''
          OR COALESCE(vehicle_make,'') <> ''
          OR COALESCE(vehicle_model,'') <> ''
        )
    `).all();
    const insertVehicle = db.prepare(`
      INSERT INTO vehicles
        (vehicle_desc,license_plate,vehicle_make,vehicle_model,vehicle_year,test_expiry,insurance_expiry,next_service_date,next_service_km,odometer_km,vehicle_status,active,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const findByPlate = db.prepare('SELECT id FROM vehicles WHERE license_plate=?');
    const setDriverVehicle = db.prepare('UPDATE drivers SET vehicle_id=? WHERE id=?');
    const setEventVehicle = db.prepare('UPDATE vehicle_events SET vehicle_id=? WHERE driver_id=? AND vehicle_id IS NULL');
    const migrateOne = db.transaction((driver) => {
      let vehicleId = null;
      const plate = String(driver.license_plate || '').trim();
      if (plate) vehicleId = findByPlate.get(plate)?.id || null;
      if (!vehicleId) {
        const r = insertVehicle.run(
          driver.vehicle_desc || null,
          plate || null,
          driver.vehicle_make || null,
          driver.vehicle_model || null,
          driver.vehicle_year || null,
          driver.test_expiry || null,
          driver.insurance_expiry || null,
          driver.next_service_date || null,
          driver.next_service_km || null,
          driver.odometer_km || 0,
          driver.vehicle_status || 'active',
          driver.active ?? 1,
          driver.notes || null
        );
        vehicleId = r.lastInsertRowid;
      }
      setDriverVehicle.run(vehicleId, driver.id);
      setEventVehicle.run(vehicleId, driver.id);
    });
    rows.forEach(migrateOne);
  }

  ensureVehicleEventsSchema();
  migrateDriverVehicleRows();
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      preview_data JSON,
      status TEXT DEFAULT 'preview',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME
    );
  `);

}

function seedCoreData(db) {
  // ── SEED DOWNTIME REASONS ─────────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO downtime_reasons (code, label, color) VALUES
      ('SETUP',      'החלפת הגדרה / סט-אפ',  '#f39c12'),
      ('BREAKDOWN',  'תקלה מכונה',            '#e74c3c'),
      ('MATERIAL',   'המתנה לחומר גלם',       '#e67e22'),
      ('QUALITY',    'בדיקת איכות',           '#9b59b6'),
      ('BREAK',      'הפסקת עובד',            '#3498db'),
      ('OTHER',      'אחר',                   '#95a5a6');
  `);

  // ── SEED PRICE LIST ───────────────────────────────────────────────
  const plCount = db.prepare('SELECT COUNT(*) as c FROM price_list').get().c;
  if (plCount === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO price_list (diameter,price_list,price_cust) VALUES (?,?,?)');
    [[6,7.5,6.5],[8,7.5,6.5],[10,7.8,6.8],[12,8.0,7.0],[14,8.2,7.2],[16,8.5,7.3],
     [18,8.7,7.5],[20,9.0,7.8],[22,9.5,8.2],[25,9.8,8.5],[28,10.5,9.0],[32,11.0,9.5],
     [36,12.0,10.5],[40,13.0,11.5]].forEach(r => ins.run(...r));
    console.log('[DB] Price list seeded');
  }

  // ── SEED COMPANIES ────────────────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO companies (id, name, short_name, ownership_pct, erp_type, color) VALUES
      (1, 'IronBend כיפוף ברזל', 'IronBend', 100, 'priority', '#e07b39'),
      (2, 'הרי מדבר תשתיות ופיתוח', 'הרי מדבר', 50, 'maven', '#3498db');
  `);

  // ── SEED MACHINES (A/B/C/D) ───────────────────────────────────────
  db.exec(`
    INSERT OR IGNORE INTO machines (id, name, label, slave_id, min_diameter, max_diameter, port) VALUES
      (1, 'מכונה A – XINJE', 'A', 1,  8, 12, 'COM3'),
      (2, 'מכונה B – XINJE', 'B', 2, 14, 20, 'COM4'),
      (3, 'מכונה C – MEP',   'C', 3,  8, 20, 'COM5'),
      (4, 'מכונה D – עתידי', 'D', 4, 20, 40, 'COM6');
  `);
  // Update labels on existing rows
  db.exec(`
    UPDATE machines SET label='A', slave_id=1, min_diameter=8,  max_diameter=12 WHERE id=1 AND label IS NULL;
    UPDATE machines SET label='B', slave_id=2, min_diameter=14, max_diameter=20 WHERE id=2 AND label IS NULL;
  `);

  // ── SEED SHAPES ──────────────────────────────────────────────────
  const shapeCount = db.prepare('SELECT COUNT(*) as c FROM shapes').get().c;
  if (shapeCount === 0) {
    const insertShape = db.prepare(`INSERT OR IGNORE INTO shapes (id, name, bends, sides_default, angles_default, emoji, description) VALUES (?,?,?,?,?,?,?)`);
    const shapes = [
      ['s1',  'ישר',           0, '[1000]',                         '[]',                     '➖', 'ברזל ישר ללא כיפופים'],
      ['s2',  'L – זווית',     1, '[500,200]',                      '[90]',                   '⌐',  'כיפוף L בקצה'],
      ['s3',  'U – אנקר',      2, '[300,600,300]',                  '[90,90]',                '∪',  'צורת U – עוגן סרגל'],
      ['s4',  'Z – הזזה',      2, '[300,400,300]',                  '[135,135]',              'Z',  'כיפוף Z'],
      ['s5',  'S – כפול',      3, '[200,300,300,200]',              '[135,135,135]',          'S',  'כיפוף S כפול'],
      ['s6',  'אוברל – קרס',   3, '[200,400,400,200]',              '[90,180,90]',            '⎡',  'אוברל עם קרסים'],
      ['s7',  'אסדה פתוחה',    3, '[200,500,500,200]',              '[90,90,90]',             '⬓',  'צורת C פתוחה'],
      ['s8',  'מלבן – אצבה',   4, '[400,200,400,200]',              '[90,90,90,90]',          '□',  'כוש מלבני (Stirrup)'],
      ['s9',  'ריבוע – אצבה',  4, '[300,300,300,300]',              '[90,90,90,90]',          '◻',  'כוש מרובע (Stirrup)'],
      ['s10', 'חמישה כיפופים', 5, '[150,200,400,200,400,150]',      '[90,90,90,90,90]',       '⌂',  'צורה מורכבת 5 כיפופים'],
      ['s11', 'ששה כיפופים',   6, '[150,150,400,150,400,150,150]', '[90,90,90,90,90,90]',    '⬡',  'צורה מורכבת 6 כיפופים'],
      ['s12', 'מותאם אישית',   0, '[500]',                          '[]',                     '✏️', 'צורה מותאמת אישית'],
    ];
    for (const s of shapes) insertShape.run(...s);
    console.log('[DB] Shapes seeded');
  }

  // ── SEED WORKERS ──────────────────────────────────────────────────
  const workerCount = db.prepare('SELECT COUNT(*) as c FROM workers').get().c;
  if (workerCount === 0) {
    db.exec(`INSERT INTO workers (name, role, language) VALUES ('מנהל','מנהל','he'),('עובד 1','ייצור','he'),('עובד 2','ייצור','th')`);
  }

}

module.exports = {
  ensureCoreSchema,
  runCoreMigrations,
  seedCoreData,
};
