require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const path     = require('path');
const http     = require('http');
const multer   = require('multer');
const cron     = require('node-cron');
const crypto   = require('crypto');
const { WebSocketServer } = require('ws');
const modbus   = require('./modbus');
const priority = require('./priority');
const intake   = require('./intake');
const ai       = require('./ai');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// HTML pages: never cache — always serve fresh
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = process.env.DB_PATH || './ironbend.db';
let db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
modbus.init(db); // pass db so modbus reads machine config live

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
    order_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    material_type   TEXT DEFAULT 'coil',  -- 'coil' | 'straight'
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
addCol('items',      'package_id',         'INTEGER');          // package assignment
addCol('items',      'zone',               'TEXT');             // warehouse zone
addCol('items',      'machine_id',         'INTEGER');          // FK to machines table
addCol('items',      'is_3d',              'INTEGER DEFAULT 0'); // 1 = true 3D product (out-of-plane bends)
addCol('machines',   'can_3d',             'INTEGER DEFAULT 0'); // 1 = machine supports 3D bending

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

// ── WEBSOCKET ─────────────────────────────────────────────────────
function wsBroadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'machines_state', data: modbus.getAllState() }));
});

modbus.onUpdate((machineId, state) => {
  db.prepare(`UPDATE machines SET status=?, counter=?, last_seen=? WHERE id=?`)
    .run(state.status, state.counter, state.lastSeen, machineId);
  const machine = db.prepare('SELECT current_item_id FROM machines WHERE id=?').get(machineId);
  if (machine?.current_item_id) {
    db.prepare('UPDATE items SET produced_qty=? WHERE id=?').run(state.counter, machine.current_item_id);
  }
  wsBroadcast('machine_update', state);
});

// modbus.startPolling(5000); // uncomment when hardware connected

// ── PERMISSION ENGINE (כרך ט) ─────────────────────────────────
const ROLE_PERMISSIONS = {
  admin:      { level: 10, canApprove: true,  canDelete: true,  finance: true,  config: true  },
  manager:    { level:  7, canApprove: true,  canDelete: false, finance: true,  config: false },
  production: { level:  5, canApprove: true,  canDelete: false, finance: false, config: false },
  operator:   { level:  3, canApprove: false, canDelete: false, finance: false, config: false },
  quality:    { level:  4, canApprove: true,  canDelete: false, finance: false, config: false },
  warehouse:  { level:  4, canApprove: false, canDelete: false, finance: false, config: false },
  driver:     { level:  2, canApprove: false, canDelete: false, finance: false, config: false },
  finance:    { level:  6, canApprove: true,  canDelete: false, finance: true,  config: false },
  maintenance:{ level:  4, canApprove: false, canDelete: false, finance: false, config: false },
  customer:   { level:  1, canApprove: false, canDelete: false, finance: false, config: false },
  supplier:   { level:  1, canApprove: false, canDelete: false, finance: false, config: false },
};

function requireRole(minRole) {
  return (req, res, next) => {
    const role = req.headers['x-user-role'] || req.query._role || 'operator';
    const userId = req.headers['x-user-id'] || null;
    const perm = ROLE_PERMISSIONS[role];
    if (!perm) return res.status(403).json({ error: 'תפקיד לא מוכר', role });
    const minPerm = typeof minRole === 'string' ? ROLE_PERMISSIONS[minRole] : null;
    if (minPerm && perm.level < minPerm.level) {
      return res.status(403).json({
        error: 'אין הרשאה לביצוע פעולה זו',
        required_role: minRole,
        your_role: role,
        appeal: 'פנה למנהל המערכת לקבלת הרשאה'
      });
    }
    req.userRole = role;
    req.userId = userId;
    req.userPerm = perm;
    next();
  };
}

function logAudit(entityType, entityId, entityRef, action, oldVal, newVal, req) {
  try {
    db.prepare(`INSERT INTO audit_log (entity_type,entity_id,entity_ref,action,old_value,new_value,user_id,user_name,notes)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(entityType, entityId || null, entityRef || null, action,
        oldVal != null ? JSON.stringify(oldVal) : null,
        newVal != null ? JSON.stringify(newVal) : null,
        req?.userId || null, req?.userRole || null, req?.headers?.['x-device'] || null);
  } catch(e) { /* audit log never breaks main flow */ }
}

// ── HELPERS ──────────────────────────────────────────────────────
function calcWeightPerUnit(diameter, totalLengthMm) {
  const WEIGHTS = { 6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86 };
  const kgPerM = WEIGHTS[diameter] ?? (diameter * diameter * 0.00617);
  return (totalLengthMm / 1000) * kgPerM;
}

function generateOrderNum() {
  const year  = new Date().getFullYear();
  const count = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  return `HZ-${year}-${String(count + 1).padStart(3, '0')}`;
}

function checkOrderComplete(orderId) {
  const pending = db.prepare(`
    SELECT COUNT(*) as c FROM items i
    JOIN pallets p ON i.pallet_id = p.id
    WHERE p.order_id = ? AND i.status != 'הושלם'
  `).get(orderId);
  if (pending.c === 0) {
    db.prepare("UPDATE orders SET status='הושלם – ממתין לאיסוף' WHERE id=?").run(orderId);
    const o = db.prepare('SELECT order_num FROM orders WHERE id=?').get(orderId);
    wsBroadcast('order_complete', { orderId, orderNum: o?.order_num });
  }
}

// ── ROUTES ────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── CUSTOMERS ─────────────────────────────────────────────────────
app.get('/api/customers', (req, res) => {
  const q = req.query.q || '';
  res.json(db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR priority_id LIKE ? ORDER BY name LIMIT 20`)
    .all(`%${q}%`, `%${q}%`, `%${q}%`));
});

app.get('/api/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.orders = db.prepare('SELECT id,order_num,status,created_at,total_weight FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 10').all(c.id);
  res.json(c);
});

app.post('/api/customers', (req, res) => {
  const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'שם חובה' });
  const r = db.prepare(`INSERT INTO customers (name,phone,email,address,contact_name,contact_phone,priority_id,notes) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, phone, email, address, contactName, contactPhone, priorityId, notes);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/customers/:id', (req, res) => {
  const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
  db.prepare(`UPDATE customers SET name=?,phone=?,email=?,address=?,contact_name=?,contact_phone=?,priority_id=?,notes=? WHERE id=?`)
    .run(name, phone, email, address, contactName, contactPhone, priorityId, notes, req.params.id);
  res.json({ success: true });
});

// ── ORDERS ────────────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const { status, date, priority } = req.query;
  let sql = `SELECT o.*, c.name as customer_name, c.phone as customer_phone
             FROM orders o LEFT JOIN customers c ON o.customer_id = c.id`;
  const params = [], where = [];
  if (status)   { where.push('o.status = ?');          params.push(status); }
  if (date)     { where.push('DATE(o.delivery_date)=?'); params.push(date); }
  if (priority) { where.push('o.priority = ?');         params.push(priority); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
  order.pallets = pallets;
  res.json(order);
});

// ── MANUAL WORK (from machine station, no order needed) ───────────
app.post('/api/orders/manual', (req, res) => {
  const { machineId, diameter, qty, totalLengthMm, shape, note } = req.body;
  if (!machineId || !diameter || !qty || !totalLengthMm) {
    return res.status(400).json({ error: 'חסרים פרמטרים' });
  }
  const orderNum = 'MAN-' + Date.now().toString(36).toUpperCase();
  const weightKgPerM = { 6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31 };
  const kgPerM = weightKgPerM[diameter] ?? (diameter*diameter*0.00617);
  const totalWeight = (totalLengthMm / 1000) * kgPerM * qty;

  const orderRow = db.prepare(
    `INSERT INTO orders (order_num,channel,delivery_date,delivery_address,priority,general_notes,total_weight,waste_pct_charged,billing_weight,created_by)
     VALUES (?,?,date('now'),?,?,?,?,3,?,?)`
  ).run(orderNum,'ידני','מפעל',note||'עבודה ידנית','רגיל',totalWeight,totalWeight*1.03,null);

  const orderId = orderRow.lastInsertRowid;
  const palletRow = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,1,9999,?)').run(orderId, totalWeight);
  const palletId = palletRow.lastInsertRowid;

  const segments = JSON.stringify([{ length_mm: totalLengthMm, angle_deg: 0 }]);
  const itemRow = db.prepare(
    `INSERT INTO items (pallet_id,order_id,shape_id,shape_name,diameter,quantity,production_qty,segments,total_length_mm,weight_per_unit,status,machine_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(palletId, orderId, shape||'straight', shape||'ישר', diameter, qty, qty, segments, totalLengthMm, totalWeight/qty, 'בייצור', machineId);

  const itemId = itemRow.lastInsertRowid;
  db.prepare('UPDATE machines SET current_item_id=?,current_order_num=?,status=? WHERE id=?')
    .run(itemId, orderNum, 'בייצור', machineId);
  db.prepare('UPDATE items SET started_at=? WHERE id=?').run(new Date().toISOString(), itemId);

  const machineState = modbus.getState(machineId);
  if (machineState) {
    modbus.writeParams(machineId, { diameter, totalLengthMm, productionQty: qty, angles: [] }).catch(()=>{});
  }
  wsBroadcast('machine_assign', { machineId: Number(machineId), itemId, orderNum });
  res.json({ success: true, orderNum, itemId });
});

app.post('/api/orders', (req, res) => {
  const { customer, order, pallets } = req.body;

  let customerId;
  const existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(customer.phone);
  if (existing) {
    customerId = existing.id;
    db.prepare('UPDATE customers SET name=?,address=?,contact_name=?,contact_phone=? WHERE id=?')
      .run(customer.name, customer.address, customer.contactName, customer.contactPhone, customerId);
  } else {
    const r = db.prepare('INSERT INTO customers (name,phone,address,contact_name,contact_phone) VALUES (?,?,?,?,?)')
      .run(customer.name, customer.phone, customer.address, customer.contactName, customer.contactPhone);
    customerId = r.lastInsertRowid;
  }

  const orderNum = generateOrderNum();
  const wastePct = order.wastePctCharged ?? 3;
  const totalWeight = order.totalWeight ?? 0;
  const billingWeight = totalWeight * (1 + wastePct / 100);

  const orderResult = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_time,delivery_address,priority,driver_notes,general_notes,total_weight,waste_pct_charged,billing_weight,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderNum, customerId, order.channel, order.deliveryDate, order.deliveryTime,
         order.deliveryAddress, order.priority, order.driverNotes, order.generalNotes,
         totalWeight, wastePct, billingWeight, order.createdBy || null);

  const orderId = orderResult.lastInsertRowid;

  (pallets || []).forEach((pallet, idx) => {
    const pr = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,?,?,?)')
      .run(orderId, idx + 1, pallet.maxWeight || 500, pallet.totalWeight || 0);

    (pallet.items || []).forEach(item => {
      const sides = item.sides || [];
      const totalLengthMm = sides.reduce((s, v) => s + v, 0);
      const segments = JSON.stringify(
        sides.map((len, i) => ({ length_mm: len, angle_deg: (item.angles || [])[i] ?? 0 }))
      );
      const weightPerUnit = calcWeightPerUnit(item.diameter, totalLengthMm);
      const productionQty = Math.ceil((item.qty || 1) * (1 + wastePct / 100));

      // Auto-assign machine by diameter
      let machine = 'A';
      if (item.diameter >= 14 && item.diameter <= 20) machine = 'B';
      else if (item.diameter > 20) machine = 'D';

      db.prepare(`INSERT INTO items (pallet_id,shape_id,shape_name,diameter,segments,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,note,struct_element,struct_floor,sheet_num,machine,is_3d)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pr.lastInsertRowid, item.shapeId, item.shapeName, item.diameter,
             segments, totalLengthMm, item.qty || 1, productionQty,
             weightPerUnit, weightPerUnit * (item.qty || 1),
             item.note, item.structElement, item.structFloor, item.sheetNum, machine,
             item.is_3d ? 1 : 0);
    });
  });

  wsBroadcast('new_order', { orderNum, orderId });
  res.json({ success: true, orderNum, orderId });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  wsBroadcast('order_status', { id: Number(req.params.id), status });
  res.json({ success: true });
});

// ── PRINT CARDS ───────────────────────────────────────────────────
app.get('/api/orders/:id/print-cards', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => {
    p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
    p.items.forEach(item => { item._palletNum = p.pallet_num; });
  });
  order.pallets = pallets;

  const allItems = pallets.flatMap(p => p.items);

  // Format date dd-mm-yyyy
  const today = new Date();
  const fmtDate = d => {
    const dt = d ? new Date(d) : today;
    return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const printDate = fmtDate(order.created_at);
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '';

  // All item data for client-side rendering.
  // Use base64 encoding so no JSON content can ever break the <script> tag.
  const REBAR_KG_PC = {6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,
                       20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86};
  let allItemsB64 = 'W10='; // base64 of '[]'
  try {
    const mapped = allItems.map(it => {
      const kgm = REBAR_KG_PC[Math.round(it.diameter)];
      const calcW = (it.total_weight && it.total_weight > 0)
        ? it.total_weight
        : (kgm ? Math.round((it.total_length_mm/1000) * kgm * (it.quantity||1) * 10)/10 : 0);
      return {
        id:             it.id,
        segments:       tryParseJSON(it.segments, []),
        diameter:       it.diameter || '',
        shape_name:     it.shape_name || '',
        quantity:       it.quantity || 1,
        total_length_mm:it.total_length_mm || 0,
        total_weight:   calcW,
        material_grade: it.material_grade || 'B500B',
        struct_element: it.struct_element || '',
        note:           it.note || '',
        pallet_num:     it._palletNum || 1,
      };
    });
    allItemsB64 = Buffer.from(JSON.stringify(mapped)).toString('base64');
    console.log('[print-cards] order', req.params.id, '→', mapped.length, 'items, b64 len', allItemsB64.length);
  } catch(e) {
    console.error('[print-cards] allItems encode error:', e);
  }

  const safeCustomer = (order.customer_name || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const safeAddress  = (order.delivery_address || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>כרטיסיות ייצור – ${order.order_num}</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#e8e8e8;padding:16px;direction:rtl;}

/* ── Screen-only UI ── */
.screen-only{margin-bottom:14px;}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}
.print-btn{padding:9px 22px;background:#1a2332;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;}
.print-btn:hover{background:#c9621a;}
.gen-btn{padding:9px 22px;background:#1a7a3c;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;}
.gen-btn:hover{background:#0f5a2a;}

/* Setup panel */
.setup-panel{background:#fff;border-radius:10px;padding:14px 18px;
  box-shadow:0 2px 8px rgba(0,0,0,0.12);margin-bottom:16px;}
.setup-title{font-size:15px;font-weight:900;color:#1a2332;margin-bottom:12px;}
.setup-tbl{width:100%;border-collapse:collapse;font-size:12px;}
.setup-tbl th{background:#f0f4f8;padding:7px 10px;border:1px solid #dce3ea;
  font-weight:700;color:#1a2332;text-align:right;}
.setup-tbl td{padding:6px 10px;border:1px solid #dce3ea;color:#333;vertical-align:middle;}
.setup-tbl tr:hover td{background:#f8fbff;}
.split-inp{width:52px;text-align:center;border:1px solid #bbc;border-radius:5px;
  padding:4px 6px;font-size:13px;font-family:inherit;}
.split-detail{font-size:11px;color:#666;margin-top:3px;}

/* ── Cards ── */
.cards-grid{display:flex;flex-wrap:wrap;gap:8px;}
.prod-card{width:148mm;background:#fff;border:1.5px solid #bbb;border-radius:4px;
  overflow:hidden;page-break-inside:avoid;display:flex;flex-direction:column;
  font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.12);}
.pc-head{display:flex;justify-content:space-between;align-items:flex-start;
  padding:7px 10px 5px;border-bottom:2px solid #1a2332;background:#fff;}
.pc-title{font-size:13px;font-weight:900;color:#1a2332;line-height:1.2;}
.pc-date{font-size:10px;color:#666;margin-top:2px;}
.pc-top-barcode{text-align:center;}
.bc-svg{height:42px;width:80px;display:block;}
.bc-svg-wide{height:32px;width:110px;display:block;}
.bc-label{font-size:8px;color:#333;margin-top:1px;text-align:center;font-family:monospace;}
.split-badge{display:inline-block;background:#e07b39;color:#fff;border-radius:4px;
  font-size:11px;font-weight:900;padding:1px 6px;margin-left:5px;white-space:nowrap;}
.pc-order-row{display:flex;align-items:center;gap:8px;padding:4px 10px;
  border-bottom:1px solid #eee;background:#fafafa;}
.pc-order-label{font-size:10px;color:#555;white-space:nowrap;}
.pc-order-barcode{flex:1;}
.bc-ord-text{font-size:9px;color:#333;font-family:monospace;text-align:center;}
.pc-pallet{font-size:11px;color:#333;white-space:nowrap;border-right:1px solid #ddd;padding-right:8px;}
.pc-wq-row{display:flex;align-items:center;padding:5px 10px;gap:4px;
  border-bottom:1px solid #eee;background:#fff;}
.pc-wq-cell{display:flex;align-items:baseline;gap:3px;flex:1;}
.wq-lbl{font-size:10px;color:#666;}
.wq-val{font-size:15px;font-weight:900;color:#1a2332;}
.wq-cust{font-size:10px;font-weight:700;color:#333;}
.pc-wq-sep{width:1px;height:18px;background:#ddd;}
.pc-shape-area{flex:1;min-height:105px;display:flex;align-items:center;
  justify-content:center;padding:6px 8px;background:#fafbfc;border-bottom:1px solid #eee;}
.pc-shape-svg{width:100%;max-height:120px;}
.pc-dims{display:flex;flex-wrap:wrap;gap:4px;padding:4px 10px;
  border-bottom:1px solid #eee;background:#f5f8fb;}
.dim-seg{font-size:10px;background:#e8f0fb;border-radius:3px;padding:2px 5px;color:#1a2332;}
.dim-ang{font-size:10px;background:#fff3e0;border-radius:3px;padding:2px 5px;color:#c9621a;font-weight:700;}
.pc-spec-row{display:flex;align-items:center;gap:0;padding:5px 10px;
  border-bottom:1px solid #eee;background:#fff;}
.pc-spec-cell{font-size:11px;color:#1a2332;flex:1;}
.spec-lbl{color:#666;font-size:10px;}
.pc-spec-sep{width:1px;height:16px;background:#ddd;margin:0 6px;}
.pc-note{padding:3px 10px;background:#fff3cd;font-size:10px;color:#856404;border-bottom:1px solid #f0d060;}
.pc-footer{display:flex;align-items:center;justify-content:space-between;
  padding:5px 10px;background:#1a2332;}
.pc-brand{color:#e07b39;font-weight:900;font-size:12px;line-height:1.1;text-align:center;}
.pc-brand-num{font-size:18px;font-weight:900;color:#fff;}
.master-card{min-height:auto;}
.master-table{width:100%;border-collapse:collapse;font-size:10px;}
.master-table th,.master-table td{border:1px solid #ddd;padding:3px 5px;text-align:center;}
.master-table th{background:#f0f0f0;font-weight:700;}
.check-cell{font-size:14px;color:#aaa;}
.master-totals{padding:5px 10px;font-size:11px;color:#333;background:#f5f5f5;border-top:1px solid #ddd;}
.qr-box-center{display:flex;justify-content:center;padding:8px;}
.qr-box-center canvas,.qr-box-center img{width:72px!important;height:72px!important;}

@media print{
  body{background:#fff;padding:0;}
  .screen-only{display:none!important;}
  .cards-grid{gap:0;}
  .prod-card{margin:2mm;box-shadow:none;}
  @page{margin:8mm;}
}
</style>
</head>
<body>

<!-- ── Screen toolbar ── -->
<div class="screen-only">
  <div class="toolbar">
    <button class="print-btn" onclick="window.print()">🖨️ הדפס כרטיסיות</button>
    <span style="font-size:13px;color:#555;">הזמנה ${order.order_num} · ${order.customer_name || ''} · ${allItems.length} פריטים</span>
  </div>

  <!-- Setup / split panel -->
  <div class="setup-panel">
    <div class="setup-title">✂️ הגדר חלוקת כרטיסיות לפני הדפסה</div>
    <table class="setup-tbl">
      <thead><tr>
        <th>#</th><th>צורה</th><th>⌀</th><th>כמות</th><th>מס' כרטיסיות</th><th>חלוקה</th>
      </tr></thead>
      <tbody id="setupBody"></tbody>
    </table>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;">
      <button class="gen-btn" onclick="generateCards()">✅ עדכן כרטיסיות</button>
      <span style="font-size:12px;color:#888;">שנה כמות כרטיסיות ולחץ לעדכון</span>
    </div>
  </div>
</div>

<!-- ── Card grid (rendered by JS) ── -->
<div class="cards-grid" id="cardsGrid"></div>

<script>
// ── Server data ───────────────────────────────────────────────────
var ORDER_NUM     = '${order.order_num}';
var PRINT_DATE    = '${printDate}';
var DELIV_DATE    = '${delivDate}';
var CUSTOMER      = '${safeCustomer}';
var TOTAL_WEIGHT  = ${(order.total_weight||0).toFixed(1)};
var TOTAL_PALLETS = ${pallets.length};
var allItems      = JSON.parse(atob('${allItemsB64}'));

// ── Split config: item id -> number of sub-cards ──────────────────
var splitCfg = {};

// ── Setup panel ───────────────────────────────────────────────────
function initSetup() {
  var tbody = document.getElementById('setupBody');
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    splitCfg[item.id] = 1;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i+1) + '</td>' +
      '<td>' + (item.shape_name || '–') + '</td>' +
      '<td><b>Ø' + item.diameter + '</b></td>' +
      '<td><b>' + item.quantity + '</b></td>' +
      '<td><input class="split-inp" type="number" min="1" max="' + item.quantity + '" value="1"' +
        ' id="sp-' + item.id + '" oninput="onSplitChange(' + item.id + ',' + item.quantity + ')"></td>' +
      '<td><div class="split-detail" id="sd-' + item.id + '">כרטיסייה אחת – כל הכמות</div></td>';
    tbody.appendChild(tr);
  }
}

function onSplitChange(itemId, qty) {
  var inp = document.getElementById('sp-' + itemId);
  var n = Math.max(1, Math.min(qty, parseInt(inp.value) || 1));
  inp.value = n;
  splitCfg[itemId] = n;
  var el = document.getElementById('sd-' + itemId);
  if (n === 1) {
    el.textContent = 'כרטיסייה אחת – כל הכמות';
  } else {
    var subs = splitQty(qty, n);
    el.textContent = subs.join(' + ') + ' יח\'';
  }
}

function splitQty(total, n) {
  var base = Math.floor(total / n);
  var rem  = total % n;
  var arr  = [];
  for (var i = 0; i < n; i++) arr.push(base + (i < rem ? 1 : 0));
  return arr;
}

// ── Shape drawing ─────────────────────────────────────────────────
function drawShape(svgEl, segments) {
  if (!segments || !segments.length) return;
  var sides  = segments.map(function(s){ return s.length_mm; });
  var angles = segments.map(function(s){ return s.angle_deg; }).slice(0, -1);
  var pts = [[0,0]];
  var dir = 0;
  for (var i = 0; i < sides.length; i++) {
    var rad = dir * Math.PI / 180;
    var p = pts[pts.length-1];
    pts.push([p[0] + sides[i]*Math.cos(rad), p[1] + sides[i]*Math.sin(rad)]);
    if (i < angles.length) dir -= (180 - angles[i]);
  }
  var PAD=28, W=220, H=130;
  var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var rX=maxX-minX||1, rY=maxY-minY||1;
  var sc=Math.min((W-PAD*2)/rX,(H-PAD*2)/rY);
  var oX=PAD+((W-PAD*2)-rX*sc)/2, oY=PAD+((H-PAD*2)-rY*sc)/2;
  var mp=function(p){return [oX+(p[0]-minX)*sc, oY+(p[1]-minY)*sc];};
  var mapped=pts.map(mp);
  var pd='M '+mapped.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L ');
  var svg='<path d="'+pd+'" fill="none" stroke="#1a2332" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  svg+='<path d="'+pd+'" fill="none" stroke="#3a5070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  for (var i=0; i<mapped.length-1; i++) {
    var x1=mapped[i][0],y1=mapped[i][1],x2=mapped[i+1][0],y2=mapped[i+1][1];
    var mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
    var nx=-dy/len*10,ny=dx/len*10,lx=mx+nx,ly=my+ny;
    svg+='<rect x="'+(lx-14).toFixed(1)+'" y="'+(ly-7).toFixed(1)+'" width="28" height="12" rx="2" fill="white" fill-opacity="0.85"/>';
    svg+='<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">'+sides[i]+'</text>';
  }
  for (var i=1; i<mapped.length-1; i++) {
    var x=mapped[i][0],y=mapped[i][1];
    if (angles[i-1] !== undefined && angles[i-1] !== 180) {
      svg+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="8" fill="white" stroke="#c9621a" stroke-width="1.2"/>';
      svg+='<text x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="7" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">'+angles[i-1]+'&deg;</text>';
    }
  }
  var ep=mapped[mapped.length-1];
  svg+='<circle cx="'+mapped[0][0].toFixed(1)+'" cy="'+mapped[0][1].toFixed(1)+'" r="3" fill="#1a2332"/>';
  svg+='<circle cx="'+ep[0].toFixed(1)+'" cy="'+ep[1].toFixed(1)+'" r="3" fill="#1a2332"/>';
  svgEl.innerHTML = svg;
}

// ── Build one item card ───────────────────────────────────────────
function buildCard(item, subQty, totalCards, cardIdx) {
  var cardNum = totalCards > 1 ? (cardIdx+1) + '/' + totalCards : '';
  var uid     = 'i' + item.id + (totalCards > 1 ? 'c' + (cardIdx+1) : '');
  var barData = ORDER_NUM + '-' + String(item.id).padStart(6,'0');
  var segs    = item.segments || [];
  var wProp   = item.quantity > 0 ? (item.total_weight * subQty / item.quantity).toFixed(2) : '0.00';
  var title   = item.shape_name ? ('כרטיס כיפוף – ' + item.shape_name) : 'כרטיס כיפוף';
  var mat     = item.material_grade || 'B500B';

  var dimHtml = '';
  for (var i=0; i<segs.length; i++) {
    var lbl = String.fromCharCode(0x05D0+i);
    dimHtml += '<span class="dim-seg">'+lbl+': <b>'+segs[i].length_mm+'</b></span>';
    if (i < segs.length-1 && segs[i].angle_deg)
      dimHtml += '<span class="dim-ang">'+segs[i].angle_deg+'&deg;</span>';
  }

  var badge = cardNum ? '<span class="split-badge">'+cardNum+'</span>' : '';

  var h = '<div class="prod-card" data-uid="'+uid+'">';

  // Header
  h += '<div class="pc-head">';
  h += '<div><div class="pc-title">'+badge+title+'</div><div class="pc-date">'+PRINT_DATE+'</div></div>';
  h += '<div class="pc-top-barcode"><svg class="bc-svg" id="bt-'+uid+'"></svg><div class="bc-label">'+barData+'</div></div>';
  h += '</div>';

  // Order row
  h += '<div class="pc-order-row">';
  h += '<div class="pc-order-label">הזמנה מס\' :</div>';
  h += '<div class="pc-order-barcode"><svg class="bc-svg-wide" id="bo-'+uid+'"></svg><div class="bc-ord-text">'+ORDER_NUM+'</div></div>';
  h += '<div class="pc-pallet">משטח: <b>'+item.pallet_num+'</b></div>';
  h += '</div>';

  // Weight / qty row
  h += '<div class="pc-wq-row">';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">ק"ג:</span> <span class="wq-val">'+wProp+'</span></div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">כמות:</span> <span class="wq-val">'+subQty+'</span> יח\'</div>';
  h += '<div class="pc-wq-sep"></div>';
  h += '<div class="pc-wq-cell"><span class="wq-lbl">לקוח:</span> <span class="wq-cust">'+CUSTOMER+'</span></div>';
  h += '</div>';

  // Shape SVG
  h += '<div class="pc-shape-area"><svg id="sv-'+uid+'" class="pc-shape-svg" viewBox="0 0 220 130" preserveAspectRatio="xMidYMid meet"></svg></div>';

  // Dimensions
  if (dimHtml) h += '<div class="pc-dims">'+dimHtml+'</div>';

  // Spec row
  h += '<div class="pc-spec-row">';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">נ\':</span> <b>Ø'+item.diameter+'</b></div>';
  h += '<div class="pc-spec-sep"></div>';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">כיתה:</span> <b>'+mat+'</b></div>';
  h += '<div class="pc-spec-sep"></div>';
  h += '<div class="pc-spec-cell"><span class="spec-lbl">אורך פיתוח:</span> <b>'+item.total_length_mm+'</b> מ"מ</div>';
  if (item.struct_element) h += '<div class="pc-spec-sep"></div><div class="pc-spec-cell"><span class="spec-lbl">איבר:</span> '+item.struct_element+'</div>';
  h += '</div>';

  if (item.note) h += '<div class="pc-note">⚠ '+item.note+'</div>';

  // Footer
  h += '<div class="pc-footer"><svg class="bc-svg-wide" id="bb-'+uid+'"></svg>';
  h += '<div class="pc-brand">SYNTA<br><span class="pc-brand-num">'+item.pallet_num+'</span></div></div>';

  h += '</div>';
  return { html: h, uid: uid, barData: barData, segments: segs };
}

// ── Build master card ─────────────────────────────────────────────
function buildMaster() {
  var rows = '';
  for (var i=0; i<allItems.length; i++) {
    var it = allItems[i];
    rows += '<tr><td>'+(i+1)+'</td><td><b>'+it.diameter+'</b></td><td>'+(it.shape_name||'–')+'</td>' +
      '<td>'+Math.round((it.total_length_mm||0)/10)+'</td><td><b>'+it.quantity+'</b></td>' +
      '<td>'+(it.total_weight||0).toFixed(1)+'</td><td class="check-cell">◯</td></tr>';
  }
  var h = '<div class="prod-card master-card">';
  h += '<div class="pc-head" style="background:#1a2332;color:#fff;padding:8px 12px;">';
  h += '<div><div class="pc-title" style="color:#e07b39;font-size:14px;">★ כרטיסיית מאסטר</div>';
  h += '<div class="pc-date" style="color:#8aa;">'+PRINT_DATE+'</div></div>';
  h += '<div style="text-align:left"><div style="font-size:16px;font-weight:900;">'+ORDER_NUM+'</div>';
  h += '<div style="font-size:10px;color:#8aa;">'+(DELIV_DATE?'מסירה: '+DELIV_DATE:'')+'</div></div></div>';
  h += '<div style="padding:6px 10px;font-size:12px;font-weight:700;border-bottom:1px solid #eee;">'+CUSTOMER+'</div>';
  h += '<table class="master-table"><thead><tr><th>#</th><th>Ø</th><th>צורה</th><th>אורך</th><th>כמות</th><th>ק"ג</th><th>✓</th></tr></thead>';
  h += '<tbody>'+rows+'</tbody></table>';
  h += '<div class="master-totals">סה"כ: <b>'+TOTAL_WEIGHT+' ק"ג</b> · '+TOTAL_PALLETS+' משטחים · '+allItems.length+' פריטים</div>';
  h += '<div id="qr-master" class="qr-box-center"></div>';
  h += '<div class="pc-footer" style="background:#1a2332;color:#8aa;font-size:9px;text-align:center;padding:4px;">★ כרטיסיית מאסטר – לא לאיבוד! · '+ORDER_NUM+'</div>';
  h += '</div>';
  return h;
}

// ── Generate & render all cards ───────────────────────────────────
function generateCards() {
  var grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';

  // Master card
  var mDiv = document.createElement('div');
  mDiv.innerHTML = buildMaster();
  grid.appendChild(mDiv.firstElementChild);

  // Item cards
  var cardDefs = [];
  for (var i=0; i<allItems.length; i++) {
    var item = allItems[i];
    var n    = splitCfg[item.id] || 1;
    var subs = splitQty(item.quantity, n);
    for (var ci=0; ci<n; ci++) {
      var def = buildCard(item, subs[ci], n, ci);
      var div = document.createElement('div');
      div.innerHTML = def.html;
      grid.appendChild(div.firstElementChild);
      cardDefs.push(def);
    }
  }

  // Barcodes + shapes (after DOM is updated)
  for (var k=0; k<cardDefs.length; k++) {
    var d = cardDefs[k];
    // Shape
    var svgEl = document.getElementById('sv-'+d.uid);
    if (svgEl) drawShape(svgEl, d.segments);
    // Barcodes
    var bcOpts = { format:'CODE128', displayValue:false };
    try { JsBarcode(document.getElementById('bt-'+d.uid), d.barData, Object.assign({},bcOpts,{width:1.4,height:38,margin:2})); } catch(e){}
    try { JsBarcode(document.getElementById('bo-'+d.uid), ORDER_NUM,  Object.assign({},bcOpts,{width:1.2,height:28,margin:2})); } catch(e){}
    try { JsBarcode(document.getElementById('bb-'+d.uid), d.barData, Object.assign({},bcOpts,{width:1.2,height:28,margin:2})); } catch(e){}
  }

  // Master QR
  var qrEl = document.getElementById('qr-master');
  if (qrEl) {
    qrEl.innerHTML = '';
    try { new QRCode(qrEl, { text:ORDER_NUM+'|master', width:72, height:72, correctLevel:QRCode.CorrectLevel.M }); } catch(e){}
  }
}

// ── Init ──────────────────────────────────────────────────────────
initSetup();
generateCards();
</script>
</body>
</html>`);
});

// ── DELIVERY CERTIFICATE ─────────────────────────────────────────
app.get('/api/orders/:id/delivery-certificate', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
  const allItems = pallets.flatMap(p => p.items);

  const fmtDate = d => {
    const dt = d ? new Date(d) : new Date();
    return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const today = fmtDate();
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '—';

  // Classify each item: מכופף or ישר
  const parseSegs = raw => { try { return JSON.parse(raw) || []; } catch { return []; } };
  const isBent = item => {
    const segs = parseSegs(item.segments);
    const angles = segs.map(s => s.angle_deg).filter(a => a !== undefined);
    return angles.some(a => a < 175);
  };

  // Server-side weight table (kg/m) — mirrors client REBAR_WEIGHTS
  const REBAR_KG = {6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,
                    20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86};
  const calcItemWeight = it => {
    if (it.total_weight && it.total_weight > 0) return it.total_weight;
    const kgm = REBAR_KG[Math.round(it.diameter)];
    if (!kgm) return 0;
    return Math.round((it.total_length_mm / 1000) * kgm * (it.quantity || 1) * 10) / 10;
  };

  // Weight totals
  let wBent = 0, wStraight = 0;
  allItems.forEach(item => {
    const w = calcItemWeight(item);
    if (isBent(item)) wBent += w; else wStraight += w;
  });
  const wTotal = wBent + wStraight;
  const fmt1 = v => v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtTon = v => (v / 1000).toFixed(2);

  // Position range label
  const bentCount = allItems.filter(isBent).length;
  const posLabel = allItems.length > 0
    ? `ריכוז קומפלט: ברזל מכופף (פוז' 1-${bentCount}) ותוספות מוטות ישרים`
    : 'ריכוז קומפלט';

  // Build table rows
  let rows = '';
  allItems.forEach((item, idx) => {
    const segs   = parseSegs(item.segments);
    const bent   = isBent(item);
    const posNum = idx + 1;
    const diam   = item.diameter || '–';
    const type   = bent ? "מכופף (ח')" : 'ישר';
    const lenCm  = item.total_length_mm ? Math.round(item.total_length_mm / 10) : '–';
    const qty    = item.quantity || 1;
    const wt     = fmt1(calcItemWeight(item));
    const notes  = [item.struct_element, item.struct_floor, item.sheet_num, item.note].filter(Boolean).join(' · ') || '–';

    // Inline SVG shape (80×52)
    const svgShape = (() => {
      if (!segs.length) {
        // Straight bar — show a simple horizontal line with length label
        const lenLabel = item.total_length_mm ? Math.round(item.total_length_mm) + '' : '–';
        return `<line x1="8" y1="26" x2="72" y2="26" stroke="#1a2332" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="8" cy="26" r="2.5" fill="#1a2332"/>
                <circle cx="72" cy="26" r="2.5" fill="#1a2332"/>
                <rect x="25" y="16" width="30" height="9" rx="1.5" fill="white" fill-opacity="0.9"/>
                <text x="40" y="23" text-anchor="middle" dominant-baseline="middle" font-size="6.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">${lenLabel}</text>`;
      }
      const sides  = segs.map(s => s.length_mm);
      const angles = segs.map(s => s.angle_deg).slice(0, -1);
      const pts    = [[0, 0]];
      let dir = 0;
      for (let i = 0; i < sides.length; i++) {
        const rad = dir * Math.PI / 180;
        const p   = pts[pts.length - 1];
        pts.push([p[0] + sides[i] * Math.cos(rad), p[1] + sides[i] * Math.sin(rad)]);
        if (i < angles.length) dir -= (180 - angles[i]);
      }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const W = 80, H = 52, PAD = 10;
      const rX = maxX - minX || 1, rY = maxY - minY || 1;
      const sc = Math.min((W - PAD * 2) / rX, (H - PAD * 2) / rY);
      const oX = PAD + ((W - PAD * 2) - rX * sc) / 2;
      const oY = PAD + ((H - PAD * 2) - rY * sc) / 2;
      const mp = p => [oX + (p[0] - minX) * sc, oY + (p[1] - minY) * sc];
      const mapped = pts.map(mp);
      const pd = 'M ' + mapped.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ');
      let svg = `<path d="${pd}" fill="none" stroke="#1a2332" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      // Segment length labels
      for (let i = 0; i < mapped.length - 1; i++) {
        const [x1,y1] = mapped[i], [x2,y2] = mapped[i+1];
        const mx=(x1+x2)/2, my=(y1+y2)/2;
        const len=Math.sqrt((x2-x1)**2+(y2-y1)**2)||1;
        const nx=-(y2-y1)/len*8, ny=(x2-x1)/len*8;
        svg += `<rect x="${(mx+nx-11).toFixed(1)}" y="${(my+ny-4.5).toFixed(1)}" width="22" height="9" rx="1.5" fill="white" fill-opacity="0.9"/>`;
        svg += `<text x="${(mx+nx).toFixed(1)}" y="${(my+ny+0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="6.5" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">${sides[i]}</text>`;
      }
      // Angle labels
      for (let i = 1; i < mapped.length - 1; i++) {
        const [x,y] = mapped[i];
        const a = angles[i-1];
        if (a !== undefined && a < 175) {
          svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="white" stroke="#c9621a" stroke-width="1"/>`;
          svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="5.5" font-family="Heebo,Arial" font-weight="700" fill="#c9621a">${a}°</text>`;
        }
      }
      return svg;
    })();

    rows += `
      <tr>
        <td class="c">${posNum}</td>
        <td class="c"><b>Ø${diam}</b></td>
        <td class="c">${type}</td>
        <td class="c">${lenCm}</td>
        <td class="c">${qty}</td>
        <td class="c"><b>${wt}</b></td>
        <td class="shape-cell">
          <svg viewBox="0 0 80 52" width="80" height="52" xmlns="http://www.w3.org/2000/svg">${svgShape}</svg>
        </td>
        <td>${notes}</td>
      </tr>`;
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>ריכוז תעודת משלוח – ${order.order_num}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;direction:rtl;background:#f0f2f5;padding:18px;color:#1a2332;}

/* ── Screen toolbar ── */
.toolbar{margin-bottom:14px;display:flex;gap:10px;align-items:center;}
.btn-print{padding:9px 22px;background:#1a2332;color:#fff;border:none;border-radius:6px;
  cursor:pointer;font-size:14px;font-family:inherit;font-weight:700;}
.btn-print:hover{background:#c9621a;}
.btn-back{padding:9px 16px;background:#eee;color:#1a2332;border:1px solid #ccc;
  border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;text-decoration:none;display:inline-block;}

/* ── A4 page ── */
.page{background:#fff;width:210mm;min-height:297mm;margin:0 auto;padding:14mm 12mm;
  box-shadow:0 4px 20px rgba(0,0,0,0.15);}

/* ── Header ── */
.doc-title{text-align:center;font-size:22px;font-weight:900;color:#1a2332;letter-spacing:0.5px;margin-bottom:4px;}
.doc-subtitle{text-align:center;font-size:12px;color:#555;font-style:italic;margin-bottom:14px;}
.meta-row{display:flex;justify-content:space-between;font-size:11px;color:#444;
  border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:6px 4px;margin-bottom:14px;}
.meta-item{display:flex;gap:5px;}
.meta-lbl{color:#888;}
.meta-val{font-weight:700;}

/* ── Summary box ── */
.summary-box{background:#f0f4f8;border:1.5px solid #1a2332;border-radius:6px;
  padding:10px 16px;margin-bottom:16px;display:inline-block;float:left;}
.summary-title{font-size:11px;font-weight:900;color:#1a2332;margin-bottom:7px;text-align:center;}
.sum-row{display:flex;justify-content:space-between;gap:24px;font-size:11.5px;margin-bottom:4px;}
.sum-lbl{color:#444;}
.sum-val{font-weight:700;color:#1a2332;}
.sum-total{border-top:1.5px solid #1a2332;margin-top:6px;padding-top:6px;}
.sum-total .sum-val{font-size:14px;color:#c9621a;}
.clearfix::after{content:'';display:table;clear:both;}

/* ── Table ── */
.section-title{font-size:13px;font-weight:900;color:#1a2332;margin-bottom:8px;
  border-bottom:2px solid #1a2332;padding-bottom:4px;}
table{width:100%;border-collapse:collapse;font-size:10.5px;}
thead th{background:#1a2332;color:#fff;padding:7px 5px;text-align:center;font-weight:700;
  border:1px solid #1a2332;}
tbody tr:nth-child(even){background:#f7f9fc;}
tbody tr:hover{background:#eaf2ff;}
tbody td{padding:5px 5px;border:1px solid #d0d8e4;vertical-align:middle;}
td.c{text-align:center;}
.shape-cell{text-align:center;padding:2px 4px;}
tfoot td{background:#1a2332;color:#fff;font-weight:900;padding:8px 6px;
  border:1px solid #1a2332;text-align:center;}
tfoot .total-val{font-size:14px;color:#f0a060;}

/* ── Footer ── */
.doc-footer{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;
  display:flex;justify-content:space-between;font-size:10px;color:#888;}
.company-name{font-weight:900;color:#1a2332;font-size:12px;}

@media print{
  body{background:#fff;padding:0;}
  .toolbar{display:none!important;}
  .page{box-shadow:none;padding:10mm 10mm;width:100%;}
  @page{size:A4 portrait;margin:8mm;}
}
</style>
</head>
<body>

<div class="toolbar">
  <a href="/orders.html" class="btn-back">← חזור להזמנות</a>
  <button class="btn-print" onclick="window.print()">🖨️ הדפס / שמור PDF</button>
  <span style="font-size:13px;color:#666;">הזמנה ${order.order_num} · ${order.customer_name || ''}</span>
</div>

<div class="page">

  <!-- Header -->
  <div class="doc-title">ריכוז תעודת משלוח וסיכום משקלים סופי</div>
  <div class="doc-subtitle">${posLabel}</div>

  <div class="meta-row">
    <div class="meta-item"><span class="meta-lbl">לקוח:</span><span class="meta-val">${order.customer_name || '—'}</span></div>
    <div class="meta-item"><span class="meta-lbl">הזמנה מס':</span><span class="meta-val">${order.order_num}</span></div>
    <div class="meta-item"><span class="meta-lbl">תאריך אספקה:</span><span class="meta-val">${delivDate}</span></div>
    <div class="meta-item"><span class="meta-lbl">תאריך הפקה:</span><span class="meta-val">${today}</span></div>
  </div>

  <!-- Summary box -->
  <div class="clearfix">
    <div class="summary-box">
      <div class="summary-title">סיכום משקלי משלוח קומפלט</div>
      <div class="sum-row">
        <span class="sum-lbl">סה"כ משקל ברזל מכופף:</span>
        <span class="sum-val">${fmt1(wBent)} ק"ג (${fmtTon(wBent)} טון)</span>
      </div>
      <div class="sum-row">
        <span class="sum-lbl">סה"כ משקל ברזל ישר:</span>
        <span class="sum-val">${fmt1(wStraight)} ק"ג (${fmtTon(wStraight)} טון)</span>
      </div>
      <div class="sum-row sum-total">
        <span class="sum-lbl"><b>סך הכל משקל כללי:</b></span>
        <span class="sum-val"><b>${fmt1(wTotal)} ק"ג (כ-${fmtTon(wTotal)} טון)</b></span>
      </div>
    </div>
  </div>

  <!-- Detail table -->
  <div class="section-title">טבלת פירוט אלמנטים מלאה ומאוחדת</div>
  <table>
    <thead>
      <tr>
        <th>פוזיציה</th>
        <th>קוטר<br>(מ"מ)</th>
        <th>סוג ברזל</th>
        <th>אורך<br>(ס"מ)</th>
        <th>כמות<br>(יח')</th>
        <th>משקל<br>(ק"ג)</th>
        <th>צורה</th>
        <th>מקור המידע / הערות</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right;">משקל כולל סופי ומאושר לעסקה</td>
        <td class="total-val">${fmt1(wTotal)}</td>
        <td></td>
        <td>סה"כ כללי קומפלט · ${allItems.length} פריטים</td>
      </tr>
    </tfoot>
  </table>

  <!-- Footer -->
  <div class="doc-footer">
    <div>
      <div class="company-name">טנא תעשיות ברזל בע"מ</div>
      <div>תעודה זו מהווה אישור לפרטי המשלוח המפורטים לעיל</div>
    </div>
    <div style="text-align:left;">
      <div>חתימה ואישור: _______________</div>
      <div style="margin-top:4px;">תאריך קבלה: _______________</div>
    </div>
  </div>

</div><!-- /page -->
</body>
</html>`);
});

// ── PRINT A4 ──────────────────────────────────────────────────────
app.get('/api/orders/:id/print-a4', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => {
    p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
    p.items.forEach(item => { item._palletNum = p.pallet_num; });
  });
  const allItems = pallets.flatMap(p => p.items);

  const fmtDate = d => {
    const dt = d ? new Date(d) : new Date();
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  };
  const printDate = fmtDate(order.created_at);
  const delivDate = order.delivery_date ? fmtDate(order.delivery_date) : '—';

  const allItemsJson = JSON.stringify(allItems.map((it, idx) => ({
    rowNum:         idx + 1,
    segments:       tryParseJSON(it.segments, []),
    diameter:       it.diameter || '',
    shape_name:     it.shape_name || '',
    quantity:       it.quantity || 1,
    total_length_mm:it.total_length_mm || 0,
    total_length_cm:(Math.round((it.total_length_mm||0)/10)),
    total_weight:   it.total_weight || 0,
    material_grade: it.material_grade || 'B500B',
    struct_element: it.struct_element || '',
    note:           it.note || '',
    pallet_num:     it._palletNum || 1,
  })));

  const safeCustomer = (order.customer_name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const totalWeight  = (order.total_weight || 0).toFixed(1);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>הדפסת A4 – ${order.order_num}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#f5f5f5;color:#1a2332;direction:rtl;padding:14px;}

/* Screen toolbar */
.no-print{margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.btn-print{padding:9px 24px;background:#1a2332;color:#fff;border:none;border-radius:7px;
  cursor:pointer;font-size:14px;font-family:inherit;font-weight:700;}
.btn-print:hover{background:#c9621a;}

/* Page wrapper */
.page{background:#fff;max-width:210mm;margin:0 auto;padding:14mm 12mm 12mm;
  box-shadow:0 2px 12px rgba(0,0,0,0.12);}

/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:3px solid #1a2332;padding-bottom:10px;margin-bottom:12px;}
.hdr-title{font-size:22px;font-weight:900;color:#1a2332;}
.hdr-sub{font-size:13px;color:#555;margin-top:3px;}
.hdr-right{text-align:left;}
.order-num{font-size:28px;font-weight:900;color:#c9621a;line-height:1;}
.hdr-meta{font-size:11px;color:#666;margin-top:4px;line-height:1.6;}

/* Summary row */
.summary{display:flex;gap:0;margin-bottom:12px;border:1px solid #ddd;border-radius:6px;overflow:hidden;}
.sum-cell{flex:1;padding:8px 12px;border-left:1px solid #ddd;text-align:center;}
.sum-cell:last-child{border-left:none;}
.sum-label{font-size:10px;color:#888;margin-bottom:2px;}
.sum-val{font-size:16px;font-weight:900;color:#1a2332;}

/* Table */
.items-table{width:100%;border-collapse:collapse;font-size:11px;}
.items-table th{background:#1a2332;color:#fff;padding:7px 6px;text-align:center;
  font-size:11px;font-weight:700;border:1px solid #1a2332;}
.items-table td{padding:5px 5px;border:1px solid #d0d7e0;vertical-align:middle;text-align:center;}
.items-table tr:nth-child(even) td{background:#f7f9fc;}
.items-table tr:hover td{background:#eef3fb;}
.row-num{font-weight:900;font-size:13px;color:#1a2332;min-width:20px;}
.diam{font-weight:900;font-size:13px;color:#c9621a;}
.shape-td{min-width:120px;max-width:180px;padding:3px!important;}
.shape-svg{display:block;margin:0 auto;}
.dims-td{text-align:right;font-size:10px;line-height:1.7;min-width:90px;}
.seg-dim{white-space:nowrap;}
.seg-lbl{font-weight:700;color:#1a2332;}
.seg-ang{color:#c9621a;font-size:9px;}
.len-val{font-size:13px;font-weight:900;}
.qty-val{font-size:15px;font-weight:900;color:#1a2332;}
.wt-val{font-size:12px;font-weight:700;}
.note-row td{background:#fff8e1!important;color:#856404;font-size:10px;padding:3px 8px!important;text-align:right!important;}
.check-box{width:18px;height:18px;border:1.5px solid #aaa;border-radius:3px;display:inline-block;}

/* Totals */
.totals-row{background:#1a2332!important;}
.totals-row td{color:#fff!important;font-weight:900;font-size:12px;padding:7px 6px!important;
  border-color:#1a2332!important;}

/* Footer */
.footer{margin-top:14px;display:flex;justify-content:space-between;align-items:center;
  border-top:2px solid #1a2332;padding-top:8px;font-size:10px;color:#888;}
.footer-brand{font-weight:900;color:#c9621a;font-size:13px;}

@media print{
  body{background:#fff;padding:0;}
  .no-print{display:none!important;}
  .page{box-shadow:none;padding:8mm 8mm 8mm;max-width:100%;}
  @page{size:A4 portrait;margin:0;}
}
</style>
</head>
<body>

<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨️ הדפס A4</button>
  <span style="font-size:13px;color:#555;">הזמנה ${order.order_num} · ${safeCustomer} · ${allItems.length} פריטים</span>
</div>

<div class="page">
  <!-- Header -->
  <div class="hdr">
    <div>
      <div class="hdr-title">טופס ייצור – כיפוף ברזל</div>
      <div class="hdr-sub">IronBend Production Sheet</div>
    </div>
    <div class="hdr-right">
      <div class="order-num">${order.order_num}</div>
      <div class="hdr-meta">
        לקוח: <b>${safeCustomer}</b><br>
        תאריך הזמנה: <b>${printDate}</b><br>
        תאריך מסירה: <b>${delivDate}</b>
      </div>
    </div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <div class="sum-cell"><div class="sum-label">סה"כ פריטים</div><div class="sum-val">${allItems.length}</div></div>
    <div class="sum-cell"><div class="sum-label">סה"כ ק"ג</div><div class="sum-val">${totalWeight}</div></div>
    <div class="sum-cell"><div class="sum-label">משטחים</div><div class="sum-val">${pallets.length}</div></div>
    <div class="sum-cell"><div class="sum-label">הזמנה</div><div class="sum-val">${order.order_num}</div></div>
  </div>

  <!-- Items table -->
  <table class="items-table" id="itemsTable">
    <thead>
      <tr>
        <th>#</th>
        <th>⌀ נ'</th>
        <th>צורה</th>
        <th>מידות (מ"מ)</th>
        <th>L סה"כ<br>(ס"מ)</th>
        <th>כמות</th>
        <th>ק"ג</th>
        <th>✓</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>

  <!-- Footer -->
  <div class="footer">
    <div>הודפס: ${printDate} · IronBend</div>
    <div class="footer-brand">הזמנה ${order.order_num}</div>
    <div>חתימה: _______________</div>
  </div>
</div>

<script>
var allItems = ${allItemsJson};

function drawShape2D(svgEl, segments, W, H) {
  if (!segments || !segments.length) {
    svgEl.innerHTML = '<text x="'+W/2+'" y="'+H/2+'" text-anchor="middle" font-size="10" fill="#aaa">ישר</text>';
    return;
  }
  var sides  = segments.map(function(s){ return s.length_mm || 0; });
  // angle_deg in DB = bend angle (e.g. 90° = right-angle bend), stored per-segment but used between segments
  var bendAngs = segments.map(function(s){ return s.angle_deg != null ? s.angle_deg : 180; });
  var pts = [[0,0]];
  var dir = 0; // current direction in degrees (0=right, positive=clockwise on screen)
  for (var i = 0; i < sides.length; i++) {
    var rad = dir * Math.PI / 180;
    var p = pts[pts.length-1];
    pts.push([p[0] + sides[i]*Math.cos(rad), p[1] + sides[i]*Math.sin(rad)]);
    // Apply turn: bend angle 90° = turn 90° (dir decreases by 180-angle)
    if (i < bendAngs.length - 1) dir -= (180 - bendAngs[i+1]);
  }
  var PAD=16;
  var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var rX=maxX-minX||1, rY=maxY-minY||1;
  var sc=Math.min((W-PAD*2)/rX,(H-PAD*2)/rY);
  var oX=PAD+((W-PAD*2)-rX*sc)/2, oY=PAD+((H-PAD*2)-rY*sc)/2;
  var mp=function(p){return [(oX+(p[0]-minX)*sc).toFixed(1),(oY+(p[1]-minY)*sc).toFixed(1)];};
  var mapped=pts.map(mp);
  var pd='M '+mapped.map(function(p){return p[0]+','+p[1];}).join(' L ');
  var svg='<path d="'+pd+'" fill="none" stroke="#1a2332" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
  // Segment length labels
  for (var i=0; i<mapped.length-1; i++) {
    var x1=parseFloat(mapped[i][0]),y1=parseFloat(mapped[i][1]);
    var x2=parseFloat(mapped[i+1][0]),y2=parseFloat(mapped[i+1][1]);
    var mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
    if (len < 6) continue;
    var nx=(-dy/len)*9, ny=(dx/len)*9;
    svg+='<rect x="'+(mx+nx-14).toFixed(1)+'" y="'+(my+ny-6).toFixed(1)+'" width="28" height="11" rx="2" fill="white" fill-opacity="0.9"/>';
    svg+='<text x="'+(mx+nx).toFixed(1)+'" y="'+(my+ny).toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="8" font-family="Heebo,Arial" font-weight="700" fill="#1a2332">'+sides[i]+'</text>';
  }
  svgEl.setAttribute('viewBox','0 0 '+W+' '+H);
  svgEl.innerHTML = svg;
}

function buildDimsHtml(segments) {
  if (!segments || !segments.length) return '<span style="color:#aaa;font-size:10px;">—</span>';
  var html = '';
  for (var i=0; i<segments.length; i++) {
    var lbl = String.fromCharCode(0x05D0+i); // א,ב,ג...
    html += '<div class="seg-dim"><span class="seg-lbl">'+lbl+':</span> '+segments[i].length_mm+'</div>';
    if (i < segments.length-1 && segments[i].angle_deg != null && segments[i].angle_deg !== 180) {
      html += '<div class="seg-ang">∠ '+segments[i].angle_deg+'°</div>';
    }
  }
  return html;
}

function buildTable() {
  var tbody = document.getElementById('tableBody');
  var totalQty = 0, totalWt = 0;
  for (var i=0; i<allItems.length; i++) {
    var it = allItems[i];
    totalQty += it.quantity;
    totalWt  += it.total_weight;
    var SVG_W = 130, SVG_H = 55;
    var uid = 'sv'+i;
    var row = document.createElement('tr');
    row.innerHTML =
      '<td class="row-num">'+it.rowNum+'</td>'+
      '<td class="diam">Ø'+it.diameter+'</td>'+
      '<td class="shape-td"><svg id="'+uid+'" class="shape-svg" width="'+SVG_W+'" height="'+SVG_H+'" viewBox="0 0 '+SVG_W+' '+SVG_H+'"></svg></td>'+
      '<td class="dims-td">'+buildDimsHtml(it.segments)+'</td>'+
      '<td><span class="len-val">'+it.total_length_cm+'</span></td>'+
      '<td><span class="qty-val">'+it.quantity+'</span></td>'+
      '<td><span class="wt-val">'+(it.total_weight||0).toFixed(1)+'</span></td>'+
      '<td><span class="check-box"></span></td>';
    tbody.appendChild(row);
    if (it.note) {
      var noteRow = document.createElement('tr');
      noteRow.className = 'note-row';
      noteRow.innerHTML = '<td colspan="8">⚠ '+it.note+'</td>';
      tbody.appendChild(noteRow);
    }
  }
  // Totals row
  var totRow = document.createElement('tr');
  totRow.className = 'totals-row';
  totRow.innerHTML =
    '<td colspan="5" style="text-align:right;padding-right:10px!important;">סה"כ</td>'+
    '<td>'+totalQty+'</td>'+
    '<td>'+totalWt.toFixed(1)+'</td>'+
    '<td></td>';
  tbody.appendChild(totRow);

  // Draw shapes
  for (var j=0; j<allItems.length; j++) {
    var svgEl = document.getElementById('sv'+j);
    if (svgEl) drawShape2D(svgEl, allItems[j].segments, 130, 55);
  }
}

buildTable();
</script>
</body>
</html>`);
});

// ── ANALYZE IMAGE (Gemini Vision) ─────────────────────────────────
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY לא מוגדר ב-.env' });
  if (!req.file)   return res.status(400).json({ error: 'לא התקבלה תמונה' });

  const base64 = req.file.buffer.toString('base64');
  const mime   = req.file.mimetype || 'image/jpeg';

  const prompt = `אתה מנתח טפסי הזמנות ברזל כפוף של מפעל ישראלי.
בתמונה זו יש טופס הזמנה של ברזל לכיפוף. נתח אותו והחזר JSON בלבד (ללא טקסט נוסף).

החזר מערך של פריטים בפורמט הבא:
[
  {
    "diameter": 12,
    "shape_name": "L – זווית 90°",
    "quantity": 50,
    "segments": [
      {"length_mm": 500, "angle_deg": 90},
      {"length_mm": 200, "angle_deg": 0}
    ],
    "total_length_mm": 700,
    "material_grade": "B500B",
    "note": ""
  }
]

חוקים:
- diameter: קוטר הברזל במ"מ (מספר שלם: 8,10,12,14,16,20,25,32)
- segments: רשימת צלעות, כל צלע כוללת length_mm (אורך במ"מ) ו-angle_deg (זווית הכיפוף אחריה, 180=ישר/ללא כיפוף, 90=זווית ישרה)
- total_length_mm: סכום כל הצלעות
- quantity: כמות יחידות
- shape_name: שם הצורה בעברית
- material_grade: B500B אם לא מצוין אחרת
- note: הערות מיוחדות אם יש
- אם יש מספרים שנראים כאורכים ב-ס"מ, המר ל-מ"מ (×10)
- אם אין מספר מסוים — השתמש בברירת מחדל הגיונית`;

  try {
    const resp = await require('axios').post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    let text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip markdown code blocks if present
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const items = JSON.parse(text);
    res.json({ success: true, items });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: 'שגיאה בניתוח התמונה: ' + msg });
  }
});

// ── SHAPES ────────────────────────────────────────────────────────
app.get('/api/shapes', (req, res) => {
  const { bends } = req.query;
  let sql = 'SELECT * FROM shapes WHERE active=1';
  const params = [];
  if (bends !== undefined) { sql += ' AND bends=?'; params.push(Number(bends)); }
  sql += ' ORDER BY sort_order, bends, name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/shapes', (req, res) => {
  const { id, name, bends, sidesDefault, anglesDefault, emoji, description } = req.body;
  db.prepare(`INSERT OR REPLACE INTO shapes (id,name,bends,sides_default,angles_default,emoji,description) VALUES (?,?,?,?,?,?,?)`)
    .run(id, name, bends || 0, JSON.stringify(sidesDefault || []), JSON.stringify(anglesDefault || []), emoji || '⬡', description || '');
  res.json({ success: true });
});

// ── SHAPE SEED (standard Israeli rebar catalog) ──────────────────
app.post('/api/shapes/seed', (req, res) => {
  // Standard Israeli rebar shapes (based on IS/BS 8666 catalog)
  // Dimensions in mm, angles in degrees
  const CATALOG = [
    // ── 0 Bends ──────────────────────────────────────────────────
    { id:'s00', name:'ישר',               bends:0, sides:[3000],                          angles:[],                  emoji:'➖', sort:1,  desc:'מוט ישר ללא כיפופים' },
    // ── 1 Bend ───────────────────────────────────────────────────
    { id:'s01', name:'L – זווית 90°',     bends:1, sides:[500,200],                        angles:[90],                emoji:'⌐', sort:2,  desc:'כיפוף L בזווית ישרה' },
    { id:'s02', name:'L – זווית 45°',     bends:1, sides:[500,200],                        angles:[45],                emoji:'⌐', sort:3,  desc:'כיפוף L בזווית 45°' },
    { id:'s03', name:'L – זווית 135°',    bends:1, sides:[500,200],                        angles:[135],               emoji:'⌐', sort:4,  desc:'כיפוף L בזווית 135°' },
    // ── 2 Bends ──────────────────────────────────────────────────
    { id:'s10', name:'U – אנקר 90°',      bends:2, sides:[150,1250,150],                   angles:[90,90],             emoji:'∪', sort:5,  desc:'אנקר U כיפוף 90°' },
    { id:'s11', name:'U – אנקר רחב',      bends:2, sides:[150,6000,150],                   angles:[90,90],             emoji:'∪', sort:6,  desc:'אנקר U רחב' },
    { id:'s12', name:'Z – הזזה',           bends:2, sides:[300,400,300],                    angles:[135,135],           emoji:'Z', sort:7,  desc:'הזזה Z' },
    { id:'s13', name:'S – כפול',           bends:2, sides:[300,400,300],                    angles:[45,45],             emoji:'S', sort:8,  desc:'כיפוף S כפול' },
    { id:'s14', name:'שלב פתוח',           bends:2, sides:[600,200,600],                    angles:[45,135],            emoji:'⊂', sort:9,  desc:'שלב פתוח עם זוויות' },
    // ── 3 Bends ──────────────────────────────────────────────────
    { id:'s20', name:'קרס – אוברל',        bends:3, sides:[200,400,400,200],                angles:[90,180,90],         emoji:'⎡', sort:10, desc:'קרס overlap עם כיפוף 180°' },
    { id:'s21', name:'אסדה פתוחה',         bends:3, sides:[200,500,500,200],                angles:[90,90,90],          emoji:'⬓', sort:11, desc:'אסדה פתוחה 3 כיפופים' },
    { id:'s22', name:'T – רגל',            bends:3, sides:[250,600,250,100],                angles:[90,90,90],          emoji:'⊤', sort:12, desc:'צורת T עם רגל' },
    // ── 4 Bends ──────────────────────────────────────────────────
    { id:'s30', name:'מסגרת מלבנית',       bends:4, sides:[400,200,400,200,100],            angles:[90,90,90,90],       emoji:'▭', sort:13, desc:'אצבה מלבנית – stirrup' },
    { id:'s31', name:'מסגרת ריבועית',      bends:4, sides:[300,300,300,300,100],            angles:[90,90,90,90],       emoji:'□', sort:14, desc:'אצבה ריבועית' },
    { id:'s32', name:'מסגרת גדולה',        bends:4, sides:[600,400,600,400,100],            angles:[90,90,90,90],       emoji:'▬', sort:15, desc:'מסגרת גדולה' },
    { id:'s33', name:'מסגרת עם אלכסון',    bends:4, sides:[300,300,300,300,100],            angles:[45,135,45,135],     emoji:'◇', sort:16, desc:'מסגרת עם כיפופים אלכסוניים' },
    // ── 5 Bends ──────────────────────────────────────────────────
    { id:'s40', name:'חמישה כיפופים',      bends:5, sides:[150,200,400,200,400,150],        angles:[90,90,90,90,90],    emoji:'⌂', sort:17, desc:'מוט עם 5 כיפופים' },
    { id:'s41', name:'W – גלי',            bends:5, sides:[200,300,200,300,200,200],        angles:[45,135,45,135,45],  emoji:'〜', sort:18, desc:'מוט גלי W' },
    // ── 6 Bends ──────────────────────────────────────────────────
    { id:'s50', name:'ששה כיפופים',        bends:6, sides:[150,150,400,150,400,150,150],    angles:[90,90,90,90,90,90], emoji:'⬡', sort:19, desc:'מוט עם 6 כיפופים' },
    { id:'s51', name:'ספירלה מלבנית',      bends:6, sides:[300,200,300,200,300,200,300],    angles:[90,90,90,90,90,90], emoji:'🌀', sort:20, desc:'ספירלה עם 6+ כיפופים' },
    // ── Special ──────────────────────────────────────────────────
    { id:'s60', name:'אנקר U – קצר',       bends:2, sides:[100,800,100],                    angles:[90,90],             emoji:'∪', sort:21, desc:'אנקר U קצר' },
    { id:'s61', name:'אנקר U – ארוך',      bends:2, sides:[200,2000,200],                   angles:[90,90],             emoji:'∪', sort:22, desc:'אנקר U ארוך' },
    { id:'s62', name:'ראש עוגן',           bends:2, sides:[300,1500,300],                    angles:[90,90],             emoji:'⚓', sort:23, desc:'ראש עוגן – U רחב' },
    { id:'s63', name:'U – עם זוויות 45°',  bends:2, sides:[200,800,200],                    angles:[45,45],             emoji:'∪', sort:24, desc:'U כיפוף בזוויות 45°' },
    { id:'s70', name:'מסגרת 6 צלעות',      bends:5, sides:[200,400,200,400,200,400],        angles:[60,120,60,120,60],  emoji:'⬡', sort:25, desc:'מסגרת משושה' },
    { id:'s80', name:'רשת – mesh',          bends:0, sides:[6000],                            angles:[],                  emoji:'⊞', sort:26, desc:'רשת ברזל – mesh' },
    { id:'s90', name:'מותאם אישית',        bends:0, sides:[1000],                            angles:[],                  emoji:'✏️', sort:99, desc:'כיפוף חופשי', custom:true },
  ];

  // Ensure sort_order column exists (add if missing)
  try {
    db.prepare('ALTER TABLE shapes ADD COLUMN sort_order INTEGER DEFAULT 99').run();
  } catch(e) { /* column already exists */ }

  const insert = db.prepare(`INSERT OR REPLACE INTO shapes
    (id,name,bends,sides_default,angles_default,emoji,description,sort_order,active)
    VALUES (?,?,?,?,?,?,?,?,1)`);

  const runAll = db.transaction(() => {
    CATALOG.forEach(s => {
      insert.run(
        s.id, s.name, s.bends,
        JSON.stringify(s.sides),
        JSON.stringify(s.angles),
        s.emoji, s.desc || '', s.sort || 99
      );
    });
  });
  runAll();

  res.json({ success: true, count: CATALOG.length, shapes: CATALOG.map(s => s.id) });
});

// ── WORKERS ───────────────────────────────────────────────────────
app.get('/api/workers', (req, res) => {
  res.json(db.prepare('SELECT * FROM workers WHERE active=1 ORDER BY name').all());
});

app.post('/api/workers', (req, res) => {
  const { name, role, language } = req.body;
  const r = db.prepare('INSERT INTO workers (name,role,language) VALUES (?,?,?)').run(name, role || 'ייצור', language || 'he');
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/workers/:id', (req, res) => {
  const { name, role, language, active } = req.body;
  db.prepare('UPDATE workers SET name=?,role=?,language=?,active=? WHERE id=?').run(name, role, language, active ?? 1, req.params.id);
  res.json({ success: true });
});

// ── MACHINES ──────────────────────────────────────────────────────
app.get('/api/machines', (req, res) => {
  const machines = db.prepare('SELECT * FROM machines ORDER BY id').all();
  const live = modbus.getAllState();
  const merged = machines.map(m => {
    const ls = live.find(l => l.id === m.id);
    return ls ? { ...m, ...ls } : m;
  });
  res.json(merged);
});

// Create new machine
app.post('/api/machines', (req, res) => {
  const { name, label, conn_mode, tcp_host, tcp_port, rtu_port, baud_rate, parity, stop_bits, slave_id, min_diameter, max_diameter } = req.body;
  if (!name) return res.status(400).json({ error: 'שם מכונה נדרש' });
  const result = db.prepare(`INSERT INTO machines (name,label,conn_mode,tcp_host,tcp_port,rtu_port,baud_rate,parity,stop_bits,slave_id,min_diameter,max_diameter)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(name.trim(), label||name.substring(0,1).toUpperCase(), conn_mode||'tcp',
         tcp_host||null, tcp_port||502, rtu_port||null, baud_rate||9600,
         parity||'none', stop_bits||1,
         slave_id||1, min_diameter||8, max_diameter||32);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Delete machine
app.delete('/api/machines/:id', (req, res) => {
  db.prepare('DELETE FROM machines WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/machines/:id/send-params', async (req, res) => {
  const machineId = Number(req.params.id);
  const { diameter, totalLengthMm, productionQty, angles } = req.body;
  try {
    await modbus.writeParams(machineId, { diameter, totalLengthMm, productionQty, angles: angles || [] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/machines/:id/assign', (req, res) => {
  const { itemId, orderNum } = req.body;
  db.prepare('UPDATE machines SET current_item_id=?,current_order_num=? WHERE id=?')
    .run(itemId, orderNum, req.params.id);
  db.prepare('UPDATE items SET status=?,started_at=?,machine_id=? WHERE id=?')
    .run('בייצור', new Date().toISOString(), req.params.id, itemId);
  wsBroadcast('machine_assign', { machineId: Number(req.params.id), itemId, orderNum });
  res.json({ success: true });
});

// ── MACHINE CONNECTION CONFIG ─────────────────────────────────────
app.patch('/api/machines/:id/config', (req, res) => {
  const { conn_mode, tcp_host, tcp_port, rtu_port, baud_rate, parity, stop_bits, slave_id, min_diameter, max_diameter, name, label, can_3d } = req.body;
  const mode = conn_mode || 'tcp';
  db.prepare(`UPDATE machines SET
    conn_mode=?,
    tcp_host=?,
    tcp_port=?,
    rtu_port=?,
    baud_rate=COALESCE(?,baud_rate),
    parity=COALESCE(?,parity),
    stop_bits=COALESCE(?,stop_bits),
    slave_id=COALESCE(?,slave_id),
    min_diameter=COALESCE(?,min_diameter),
    max_diameter=COALESCE(?,max_diameter),
    name=COALESCE(?,name),
    label=COALESCE(?,label),
    can_3d=COALESCE(?,can_3d)
    WHERE id=?`)
    .run(
      mode,
      mode === 'tcp' ? (tcp_host || null) : null,
      mode === 'tcp' ? (tcp_port || 502)  : null,
      mode === 'rtu' ? (rtu_port || null) : null,
      baud_rate || null, parity || null, stop_bits || null, slave_id || null,
      min_diameter || null, max_diameter || null,
      name || null, label || null,
      can_3d != null ? (can_3d ? 1 : 0) : null,
      req.params.id
    );
  if (modbus) modbus.reconfigMachine(req.params.id).catch(()=>{});
  res.json({ success: true });
});

app.post('/api/machines/:id/complete', (req, res) => {
  const machineId = Number(req.params.id);
  const { producedQty } = req.body;
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
  if (!machine?.current_item_id) return res.status(400).json({ error: 'אין פריט פעיל' });

  const item       = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
  const actualWaste = Math.max(0, (producedQty || 0) - (item?.quantity || 0));

  db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
    .run('הושלם', new Date().toISOString(), producedQty, actualWaste, machine.current_item_id);
  db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineId);

  const pallet = item ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(item.pallet_id) : null;
  if (pallet) checkOrderComplete(pallet.order_id);

  wsBroadcast('machine_complete', { machineId });
  res.json({ success: true, actualWaste });
});

// ── MACHINE STATE MACHINE ────────────────────────────────────────
const MACHINE_STATES = ['ריצה', 'סרק', 'הכנה', 'תקלה', 'תחזוקה', 'ידני', 'לא מחובר'];
const STATE_TRANSITIONS = {
  'לא מחובר': ['סרק'],
  'סרק':     ['ריצה', 'הכנה', 'ידני', 'לא מחובר'],
  'ריצה':    ['סרק', 'תקלה'],
  'הכנה':    ['סרק', 'ריצה'],
  'תקלה':    ['תחזוקה', 'סרק'],
  'תחזוקה':  ['סרק'],
  'ידני':    ['סרק'],
};

app.patch('/api/machines/:id/state', (req, res) => {
  const machineId = Number(req.params.id);
  const { state, reason, operator_id } = req.body;
  if (!MACHINE_STATES.includes(state)) {
    return res.status(400).json({ error: `מצב לא תקין: ${state}. מצבים אפשריים: ${MACHINE_STATES.join(', ')}` });
  }
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
  if (!machine) return res.status(404).json({ error: 'מכונה לא נמצאה' });

  const currentState = machine.status || 'לא מחובר';
  const allowed = STATE_TRANSITIONS[currentState] || [];
  if (!allowed.includes(state)) {
    return res.status(409).json({
      error: `מעבר לא חוקי: ${currentState} → ${state}`,
      current: currentState,
      allowed
    });
  }

  // Block transition to ריצה if machine has active LOTO lock
  if (state === 'ריצה') {
    const activeLock = db.prepare("SELECT id FROM loto WHERE machine_id=? AND status='פעיל'").get(machineId);
    if (activeLock) {
      return res.status(409).json({ error: 'לא ניתן להפעיל מכונה עם נעילת LOTO פעילה', loto_id: activeLock.id });
    }
  }

  // Update machine status
  db.prepare('UPDATE machines SET status=? WHERE id=?').run(state, machineId);

  // Log the transition
  db.prepare('INSERT INTO machine_state_log (machine_id,from_state,to_state,reason,operator_id) VALUES (?,?,?,?,?)')
    .run(machineId, currentState, state, reason || null, operator_id || null);

  // Insert production event
  const eventMap = {
    'ריצה':   'MachineStarted',
    'תקלה':   'MachineStopped',
    'תחזוקה': 'MachineStopped',
    'לא מחובר': 'MachineStopped',
  };
  if (eventMap[state]) {
    db.prepare('INSERT INTO production_events (event_type,machine_id,payload) VALUES (?,?,?)')
      .run(eventMap[state], machineId, JSON.stringify({ from: currentState, to: state, reason }));
  }

  // If fault or maintenance, create alert
  if (state === 'תקלה') {
    db.prepare("INSERT INTO alerts (type,level,message,machine_id) VALUES (?,?,?,?)")
      .run('machine_fault', 'critical', `מכונה ${machine.name} עברה לתקלה${reason ? ': ' + reason : ''}`, machineId);
  }

  wsBroadcast('machine_state', { machineId, from: currentState, to: state, reason });
  res.json({ ok: true, from: currentState, to: state });
});

app.get('/api/machines/:id/state-log', (req, res) => {
  const rows = db.prepare(`
    SELECT sl.*, u.display_name as operator_name
    FROM machine_state_log sl
    LEFT JOIN users u ON sl.operator_id = u.id
    WHERE sl.machine_id = ?
    ORDER BY sl.created_at DESC
    LIMIT 100
  `).all(req.params.id);
  res.json(rows);
});

// ── SCAN (QR) ─────────────────────────────────────────────────────
app.post('/api/scan', (req, res) => {
  const { qrData, machineId, workerId } = req.body;
  if (!qrData || !machineId) return res.status(400).json({ error: 'חסרים פרמטרים' });

  const [orderNum, itemId] = qrData.split('|');
  const itemIdNum = Number(itemId);
  const machineIdNum = Number(machineId);

  if (isNaN(itemIdNum)) return res.status(400).json({ error: 'QR לא תקין' });

  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
  if (!machine) return res.status(404).json({ error: 'מכונה לא נמצאה' });

  const item = db.prepare(`
    SELECT i.*, p.order_id FROM items i JOIN pallets p ON i.pallet_id=p.id WHERE i.id=?
  `).get(itemIdNum);
  if (!item) return res.status(404).json({ error: 'פריט לא נמצא' });

  const now = new Date().toISOString();

  // Close previous item on this machine
  if (machine.current_item_id && machine.current_item_id !== itemIdNum) {
    const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
    const prevItem = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
    const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

    db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
      .run('הושלם', now, liveCounter, actualWaste, machine.current_item_id);

    db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
      .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'close_prev', liveCounter, actualWaste);

    const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
    if (prevPallet) checkOrderComplete(prevPallet.order_id);
  }

  // Start new item
  db.prepare('UPDATE items SET status=?,started_at=?,worker_id=? WHERE id=?')
    .run('בייצור', now, workerId, itemIdNum);
  db.prepare('UPDATE machines SET current_item_id=?,current_order_num=?,counter=0 WHERE id=?')
    .run(itemIdNum, orderNum, machineIdNum);

  // Auto-update order status to 'בייצור'
  db.prepare("UPDATE orders SET status='בייצור' WHERE id=? AND status IN ('בתור ייצור','ממתינה לאישור')")
    .run(item.order_id);

  // Send params to machine via Modbus
  const segments = tryParseJSON(item.segments, []);
  const angles   = segments.slice(1).map(s => s.angle_deg || 0);
  modbus.writeParams(machineIdNum, {
    diameter:       item.diameter,
    totalLengthMm:  item.total_length_mm,
    productionQty:  item.production_qty || item.quantity,
    angles,
  }).catch(() => {}); // non-blocking

  db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan) VALUES (?,?,?,?,?,?)')
    .run(machineIdNum, workerId, itemIdNum, orderNum, 'start', 0);

  wsBroadcast('machine_assign', { machineId: machineIdNum, itemId: itemIdNum, orderNum, workerId });

  res.json({ success: true, item, orderNum, machineLabel: machine.label });
});

// End-of-day: close last item on machine
app.post('/api/machines/:id/end-of-day', (req, res) => {
  const machineIdNum = Number(req.params.id);
  const { workerId } = req.body;
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
  if (!machine?.current_item_id) return res.json({ success: true, message: 'אין פריט פעיל' });

  const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
  const prevItem    = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
  const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

  db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
    .run('הושלם', new Date().toISOString(), liveCounter, actualWaste, machine.current_item_id);
  db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineIdNum);

  db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
    .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'end_of_day', liveCounter, actualWaste);

  const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
  if (prevPallet) checkOrderComplete(prevPallet.order_id);

  wsBroadcast('end_of_day', { machineId: machineIdNum });
  res.json({ success: true, producedQty: liveCounter, actualWaste });
});

// ── DASHBOARD ─────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const wasteData = db.prepare(`
    SELECT SUM(actual_waste) as totalWaste, SUM(quantity) as totalQty,
           COUNT(*) as completedItems
    FROM items WHERE DATE(completed_at)=? AND status='הושלם'
  `).get(today);

  const wasteByMachine = db.prepare(`
    SELECT i.machine, SUM(i.actual_waste) as waste, SUM(i.quantity) as qty
    FROM items i WHERE DATE(i.completed_at)=? AND i.status='הושלם'
    GROUP BY i.machine
  `).all(today);

  res.json({
    ordersToday:      db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=?").get(today).c,
    completedToday:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status='הושלם – ממתין לאיסוף'").get(today).c,
    inProduction:     db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='בייצור'").get().c,
    pending:          db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ממתינה לאישור'").get().c,
    urgentOpen:       db.prepare("SELECT COUNT(*) as c FROM orders WHERE priority='דחוף' AND status NOT IN ('סופק – אושר','בוטל')").get().c,
    totalWeightToday: db.prepare("SELECT SUM(total_weight) as w FROM orders WHERE DATE(created_at)=?").get(today).w || 0,
    itemsInProduction:db.prepare("SELECT COUNT(*) as c FROM items WHERE status='בייצור'").get().c,
    itemsDone:        db.prepare("SELECT COUNT(*) as c FROM items WHERE DATE(completed_at)=? AND status='הושלם'").get(today).c,
    wasteAvgPct:      wasteData.totalQty > 0 ? ((wasteData.totalWaste / wasteData.totalQty) * 100).toFixed(1) : '0',
    wasteByMachine,
    recentOrders:     db.prepare(`SELECT o.*,c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id ORDER BY o.created_at DESC LIMIT 10`).all(),
    machines:         db.prepare('SELECT * FROM machines ORDER BY id').all(),
  });
});

// ── REPORTS ───────────────────────────────────────────────────────
app.get('/api/reports/waste', (req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT i.machine, i.diameter, i.shape_name,
           SUM(i.actual_waste) as total_waste, SUM(i.quantity) as total_ordered,
           ROUND(100.0 * SUM(i.actual_waste) / MAX(SUM(i.quantity),1), 1) as waste_pct,
           COUNT(*) as item_count
    FROM items i
    WHERE i.status='הושלם'
      ${from ? "AND DATE(i.completed_at) >= '" + from + "'" : ''}
      ${to   ? "AND DATE(i.completed_at) <= '" + to + "'"   : ''}
    GROUP BY i.machine, i.diameter, i.shape_name
    ORDER BY waste_pct DESC
  `).all();
  res.json(rows);
});

// ── UTILS ─────────────────────────────────────────────────────────
function tryParseJSON(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── ALERTS ────────────────────────────────────────────────────────
function createAlert(type, level, message, { orderId, machineId } = {}) {
  db.prepare('INSERT INTO alerts (type,level,message,order_id,machine_id) VALUES (?,?,?,?,?)')
    .run(type, level, message, orderId || null, machineId || null);
  wsBroadcast('alert', { type, level, message, orderId, machineId });
}

app.get('/api/alerts', (req, res) => {
  res.json(db.prepare('SELECT * FROM alerts WHERE resolved=0 ORDER BY created_at DESC LIMIT 50').all());
});

app.post('/api/alerts', (req, res) => {
  const { message, level = 'warning', entity_type, entity_id } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const r = db.prepare(`INSERT INTO alerts (type,level,message,resolved) VALUES (?,?,?,0)`)
    .run(entity_type || 'system', level, message);
  wsBroadcast('alert', { id: r.lastInsertRowid, level, message });
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/alerts/:id/resolve', (req, res) => {
  db.prepare('UPDATE alerts SET resolved=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── SETTINGS ─────────────────────────────────────────────
// Helper: get setting from DB (falls back to process.env)
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row?.value ?? process.env[key] ?? null;
}

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  // Merge with env defaults (don't expose actual secrets, just whether they're set)
  const keys = [
    'WHATSAPP_TOKEN','WHATSAPP_PHONE_ID','WHATSAPP_VERIFY_TOKEN','WHATSAPP_NOTIFY_PHONE',
    'EMAIL_IMAP_HOST','EMAIL_IMAP_PORT','EMAIL_IMAP_USER','EMAIL_IMAP_PASS',
    'PRIORITY_BASE_URL','PRIORITY_USER','PRIORITY_PASS','PRIORITY_COMPANY',
    'MAVEN_API_URL','MAVEN_API_TOKEN',
    'GOOGLE_VISION_API_KEY',
    'MODULE_MACHINES','MODULE_WHATSAPP','MODULE_EMAIL','MODULE_OCR',
    'MODULE_PRIORITY','MODULE_MAVEN','MODULE_AI','MODULE_ALERTS',
  ];
  const result = {};
  keys.forEach(k => {
    result[k] = map[k] ?? process.env[k] ?? '';
  });
  res.json(result);
});

app.post('/api/settings', (req, res) => {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  );
  const save = db.transaction(entries => {
    for (const [k, v] of Object.entries(entries)) {
      upsert.run(k, v ?? '');
    }
  });
  save(req.body);
  res.json({ success: true, saved: Object.keys(req.body).length });
});

app.post('/api/settings/test/:service', async (req, res) => {
  const svc = req.params.service;
  try {
    if (svc === 'whatsapp') {
      const token   = getSetting('WHATSAPP_TOKEN');
      const phoneId = getSetting('WHATSAPP_PHONE_ID');
      if (!token || !phoneId) return res.json({ ok: false, msg: 'Token ו-Phone ID חסרים' });
      const axios = require('axios');
      const r = await axios.get(
        `https://graph.facebook.com/v18.0/${phoneId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
      );
      return res.json({ ok: true, msg: `מחובר: ${r.data?.display_phone_number || r.data?.id}` });
    }
    if (svc === 'email') {
      const host = getSetting('EMAIL_IMAP_HOST');
      const user = getSetting('EMAIL_IMAP_USER');
      const pass = getSetting('EMAIL_IMAP_PASS');
      if (!host || !user || !pass) return res.json({ ok: false, msg: 'Host/User/Pass חסרים' });
      let ImapFlow;
      try { ImapFlow = require('imapflow'); } catch { return res.json({ ok: false, msg: 'imapflow לא מותקן (npm install imapflow)' }); }
      const client = new ImapFlow.ImapFlow({
        host, port: Number(getSetting('EMAIL_IMAP_PORT') || 993),
        secure: true, auth: { user, pass }, logger: false,
      });
      await client.connect();
      await client.logout();
      return res.json({ ok: true, msg: `מחובר לתיבה: ${user}` });
    }
    if (svc === 'priority') {
      const base = getSetting('PRIORITY_BASE_URL');
      const user = getSetting('PRIORITY_USER');
      const pass = getSetting('PRIORITY_PASS');
      if (!base) return res.json({ ok: false, msg: 'Base URL חסר' });
      const axios = require('axios');
      const r = await axios.get(`${base}/CUSTOMERS?$top=1`, {
        auth: { username: user, password: pass }, timeout: 8000,
      });
      return res.json({ ok: true, msg: `Priority מגיב (${r.status})` });
    }
    if (svc === 'vision') {
      const key = getSetting('GOOGLE_VISION_API_KEY');
      if (!key) return res.json({ ok: false, msg: 'API Key חסר' });
      return res.json({ ok: true, msg: 'API Key הוגדר ✓ (בדיקה אמיתית דורשת תמונה)' });
    }
    res.json({ ok: false, msg: 'שירות לא מוכר' });
  } catch (err) {
    res.json({ ok: false, msg: err.message });
  }
});

// ── COMPANIES ─────────────────────────────────────────────────────
app.get('/api/companies', (req, res) => {
  res.json(db.prepare('SELECT * FROM companies WHERE active=1 ORDER BY id').all());
});

app.post('/api/companies', (req, res) => {
  const { name, short_name, ownership_pct, erp_type, color } = req.body;
  const r = db.prepare(
    'INSERT INTO companies (name, short_name, ownership_pct, erp_type, color) VALUES (?,?,?,?,?)'
  ).run(name, short_name || name, ownership_pct ?? 100, erp_type || 'none', color || '#e07b39');
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/companies/:id', (req, res) => {
  const { name, short_name, ownership_pct, erp_type, color } = req.body;
  db.prepare(
    'UPDATE companies SET name=COALESCE(?,name), short_name=COALESCE(?,short_name), ownership_pct=COALESCE(?,ownership_pct), erp_type=COALESCE(?,erp_type), color=COALESCE(?,color) WHERE id=?'
  ).run(name, short_name, ownership_pct, erp_type, color, req.params.id);
  res.json({ success: true });
});

// ── HOLDINGS DASHBOARD ───────────────────────────────────────────
app.get('/api/holdings', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const companies = db.prepare('SELECT * FROM companies WHERE active=1').all();

  const rows = companies.map(co => {
    const pct = co.ownership_pct / 100;
    const ordersToday    = db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND company_id=?").get(today, co.id).c;
    const weightToday    = db.prepare("SELECT COALESCE(SUM(total_weight),0) as w FROM orders WHERE DATE(created_at)=? AND company_id=?").get(today, co.id).w;
    const inProduction   = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='בייצור' AND company_id=?").get(co.id).c;
    const completedToday = db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status='הושלם – ממתין לאיסוף' AND company_id=?").get(today, co.id).c;
    const pending        = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ממתינה לאישור' AND company_id=?").get(co.id).c;
    const urgentOpen     = db.prepare("SELECT COUNT(*) as c FROM orders WHERE priority='דחוף' AND status NOT IN ('סופק – אושר','בוטל') AND company_id=?").get(co.id).c;

    // Last 30 days revenue estimate (billing_weight as proxy)
    const revenueProxy = db.prepare(
      "SELECT COALESCE(SUM(billing_weight),0) as r FROM orders WHERE DATE(created_at) >= date('now','-30 days') AND company_id=?"
    ).get(co.id).r;

    return {
      ...co,
      ordersToday,
      weightToday,
      inProduction,
      completedToday,
      pending,
      urgentOpen,
      revenueProxy,
      // Weighted values (ownership %)
      weighted: {
        ordersToday:    ordersToday * pct,
        weightToday:    weightToday * pct,
        inProduction:   inProduction * pct,
        completedToday: completedToday * pct,
        urgentOpen:     urgentOpen * pct,
        revenueProxy:   revenueProxy * pct,
      }
    };
  });

  // Consolidated totals
  const consolidated = {
    ordersToday:    rows.reduce((s,r) => s + r.weighted.ordersToday, 0),
    weightToday:    rows.reduce((s,r) => s + r.weighted.weightToday, 0),
    inProduction:   rows.reduce((s,r) => s + r.weighted.inProduction, 0),
    completedToday: rows.reduce((s,r) => s + r.weighted.completedToday, 0),
    urgentOpen:     rows.reduce((s,r) => s + r.weighted.urgentOpen, 0),
    revenueProxy:   rows.reduce((s,r) => s + r.weighted.revenueProxy, 0),
  };

  res.json({ companies: rows, consolidated });
});

// ── DRIVERS ───────────────────────────────────────────────────────
app.get('/api/drivers', (req, res) => {
  const all = req.query.all === '1';
  const rows = all
    ? db.prepare('SELECT * FROM drivers ORDER BY name').all()
    : db.prepare('SELECT * FROM drivers WHERE active=1 ORDER BY name').all();
  res.json(rows);
});

app.post('/api/drivers', (req, res) => {
  const { name, phone, vehicle_desc, license_plate, license_expiry, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'שם נהג חסר' });
  const r = db.prepare(
    'INSERT INTO drivers (name,phone,vehicle_desc,license_plate,license_expiry,notes) VALUES (?,?,?,?,?,?)'
  ).run(name, phone||null, vehicle_desc||null, license_plate||null, license_expiry||null, notes||null);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.patch('/api/drivers/:id', (req, res) => {
  const { name, phone, vehicle_desc, license_plate, license_expiry, notes, active } = req.body;
  db.prepare(`UPDATE drivers SET
    name=COALESCE(?,name), phone=COALESCE(?,phone),
    vehicle_desc=COALESCE(?,vehicle_desc), license_plate=COALESCE(?,license_plate),
    license_expiry=COALESCE(?,license_expiry), notes=COALESCE(?,notes),
    active=COALESCE(?,active)
    WHERE id=?`)
    .run(name||null, phone||null, vehicle_desc||null, license_plate||null,
         license_expiry||null, notes||null, active??null, req.params.id);
  res.json({ success: true });
});

app.delete('/api/drivers/:id', (req, res) => {
  db.prepare('UPDATE drivers SET active=0 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.patch('/api/drivers/:id/location', (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE drivers SET current_lat=?,current_lng=?,last_location_update=? WHERE id=?')
    .run(lat, lng, new Date().toISOString(), req.params.id);
  wsBroadcast('driver_location', { driverId: Number(req.params.id), lat, lng });
  res.json({ success: true });
});

// ── DELIVERIES ────────────────────────────────────────────────────
app.get('/api/deliveries', (req, res) => {
  const { driverId, date, status } = req.query;
  let sql = `SELECT d.*, o.order_num, o.delivery_address, o.total_weight, o.billing_weight,
               c.name as customer_name, c.phone as customer_phone,
               dr.name as driver_name
             FROM deliveries d
             JOIN orders o ON d.order_id = o.id
             LEFT JOIN customers c ON o.customer_id = c.id
             LEFT JOIN drivers dr ON d.driver_id = dr.id`;
  const where = [], params = [];
  if (driverId) { where.push('d.driver_id=?'); params.push(driverId); }
  if (date)     { where.push('d.scheduled_date=?'); params.push(date); }
  if (status)   { where.push('d.status=?'); params.push(status); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY d.scheduled_date, d.id';
  const deliveries = db.prepare(sql).all(...params);
  // Attach pallets count
  deliveries.forEach(d => {
    d.pallets_count = db.prepare('SELECT COUNT(*) as c FROM pallets WHERE order_id=?').get(d.order_id)?.c || 0;
  });
  res.json(deliveries);
});

app.post('/api/deliveries', (req, res) => {
  const { orderId, driverId, scheduledDate } = req.body;
  const r = db.prepare('INSERT INTO deliveries (order_id,driver_id,scheduled_date) VALUES (?,?,?)')
    .run(orderId, driverId, scheduledDate);
  // Update order status
  db.prepare("UPDATE orders SET status='בתור ייצור' WHERE id=? AND status='ממתינה לאישור'").run(orderId);
  res.json({ id: r.lastInsertRowid });
});

// Driver departs
app.post('/api/deliveries/:id/depart', (req, res) => {
  db.prepare("UPDATE deliveries SET status='יצא',departed_at=? WHERE id=?")
    .run(new Date().toISOString(), req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    db.prepare("UPDATE orders SET status='בדרך ללקוח' WHERE id=?").run(del.order_id);
    const o = db.prepare('SELECT o.*,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?').get(del.order_id);
    if (o?.phone) intake.notifyOrderStatus(o.phone, o.order_num, 'בדרך ללקוח').catch(() => {});
    wsBroadcast('delivery_depart', { deliveryId: Number(req.params.id), orderId: del.order_id });
  }
  res.json({ success: true });
});

// Driver confirms delivery
app.post('/api/deliveries/:id/confirm', (req, res) => {
  const { signatureData, photoUrl, notes, lat, lng } = req.body;
  db.prepare(`UPDATE deliveries SET status='סופק',delivered_at=?,signature_data=?,photo_url=?,notes=?,delivery_lat=?,delivery_lng=? WHERE id=?`)
    .run(new Date().toISOString(), signatureData, photoUrl, notes, lat, lng, req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    db.prepare("UPDATE orders SET status='סופק – אושר' WHERE id=?").run(del.order_id);
    const o = db.prepare('SELECT o.*,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?').get(del.order_id);
    if (o?.phone) intake.notifyOrderStatus(o.phone, o.order_num, 'סופק – אושר').catch(() => {});
    // Sync to Priority
    if (o?.priority_order_id) {
      priority.updateOrderStatus(o.priority_order_id, 'סופק – אושר').catch(() => {});
    }
    wsBroadcast('delivery_confirm', { deliveryId: Number(req.params.id), orderId: del.order_id });
  }
  res.json({ success: true });
});

// Driver reports problem
app.post('/api/deliveries/:id/problem', (req, res) => {
  const { problemType, problemNotes } = req.body;
  db.prepare("UPDATE deliveries SET status='בעיה',problem_type=?,problem_notes=? WHERE id=?")
    .run(problemType, problemNotes, req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    const o = db.prepare('SELECT order_num FROM orders WHERE id=?').get(del.order_id);
    createAlert('delivery_problem', 'danger', `בעיה באספקה ${o?.order_num}: ${problemType}`, { orderId: del.order_id });
  }
  res.json({ success: true });
});

// ── PRIORITY SYNC ─────────────────────────────────────────────────
app.post('/api/priority/sync/:orderId', async (req, res) => {
  try {
    const order = db.prepare(`SELECT o.*,c.* FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });

    const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
    const items   = pallets.flatMap(p => db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id));

    const customer = { name: order.name, phone: order.phone, address: order.address, contactName: order.contact_name, contactPhone: order.contact_phone };
    const result   = await priority.createOrder(order, customer, items);

    if (result.ORDNAME) {
      db.prepare('UPDATE orders SET priority_order_id=? WHERE id=?').run(result.ORDNAME, order.id);
    }
    res.json({ success: true, priorityOrderId: result.ORDNAME, mocked: result.mocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/priority/status', (req, res) => {
  res.json({ configured: priority.isConfigured() });
});

// ── INTAKE – OCR ─────────────────────────────────────────────────
app.post('/api/intake/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא צורפה תמונה' });
  try {
    const ocrResult = await intake.runOCR(req.file.buffer);
    const parsed    = intake.parseOCRText(ocrResult.fullText);
    db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
      .run('ocr', ocrResult.fullText.slice(0, 2000), JSON.stringify(parsed), 'pending');
    res.json({ success: true, parsed, fullText: ocrResult.fullText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INTAKE – WhatsApp webhook ─────────────────────────────────────
app.get('/api/intake/whatsapp', (req, res) => {
  // Meta webhook verification
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/api/intake/whatsapp', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately (Meta requires fast response)
  try {
    const body = req.body;
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;

    for (const msg of entry.messages) {
      const fromPhone = msg.from;
      let parsed = null;

      if (msg.type === 'text') {
        parsed = intake.parseWhatsAppMessage(msg.text.body);
        parsed.source = 'whatsapp';
        parsed.customerPhone = fromPhone;
      } else if (msg.type === 'image' || msg.type === 'document') {
        // Image/PDF - would need to download via WhatsApp API then OCR
        // Mark for manual review
        db.prepare('INSERT INTO intake_log (source,raw_content,status) VALUES (?,?,?)')
          .run('whatsapp_media', `media:${msg.type} from:${fromPhone}`, 'pending_review');
        await intake.sendWhatsApp(fromPhone, 'קיבלנו את התמונה, ניצור קשר בהקדם!');
        continue;
      }

      if (parsed) {
        db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
          .run('whatsapp', msg.text?.body || '', JSON.stringify(parsed), 'pending');
        wsBroadcast('new_intake', { source: 'whatsapp', phone: fromPhone, parsed });
      }
    }
  } catch (err) {
    console.error('[WhatsApp webhook]', err.message);
  }
});

// ── INTAKE – Email manual trigger ─────────────────────────────────
app.post('/api/intake/email/poll', async (req, res) => {
  try {
    const results = await intake.pollEmail(db);
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intake/log', (req, res) => {
  const status = req.query.status; // optional filter: pending_review / approved / rejected
  const sql = status
    ? 'SELECT * FROM intake_log WHERE status=? ORDER BY created_at DESC LIMIT 100'
    : 'SELECT * FROM intake_log ORDER BY created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...(status ? [status] : [])));
});

// ── INTAKE – Approve: create order from email ─────────────────────
app.post('/api/intake/:id/approve', (req, res) => {
  const row = db.prepare('SELECT * FROM intake_log WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'לא נמצא' });

  let parsed = {};
  try { parsed = JSON.parse(row.parsed_data || '{}'); } catch {}

  const { customer_name, customer_phone, delivery_date, delivery_address, notes, items = [] } = parsed;

  // Find or create customer
  let customerId = null;
  if (customer_name) {
    let cust = db.prepare('SELECT id FROM customers WHERE name=?').get(customer_name);
    if (!cust) {
      const r = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run(customer_name, customer_phone || null);
      customerId = r.lastInsertRowid;
    } else {
      customerId = cust.id;
    }
  }

  const WEIGHTS = {6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86};
  const orderNum = generateOrderNum();

  // Calculate total weight
  let totalWeight = 0;
  items.forEach(it => {
    const kgm = WEIGHTS[it.diameter] ?? (it.diameter * it.diameter * 0.00617);
    totalWeight += (it.length / 1000) * kgm * (it.qty || 1);
  });
  const wastePct = 3;
  const billingWeight = totalWeight * (1 + wastePct / 100);

  // Create order
  const orderId = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_address,
      priority,general_notes,total_weight,waste_pct_charged,billing_weight,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderNum, customerId, 'מייל', delivery_date || null, delivery_address || '',
         'רגיל', notes || '', totalWeight, wastePct, billingWeight,
         'ממתינה לאישור').lastInsertRowid;

  // Create pallet + items
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,1,?)').run(orderId, totalWeight).lastInsertRowid;

  items.forEach(it => {
    const kgm = WEIGHTS[it.diameter] ?? (it.diameter * it.diameter * 0.00617);
    const w   = (it.length / 1000) * kgm * (it.qty || 1);
    db.prepare(`INSERT INTO items (pallet_id,order_id,diameter,qty,total_length_mm,weight_kg,notes,status,is_3d)
      VALUES (?,?,?,?,?,?,?,?,0)`)
      .run(palletId, orderId, it.diameter, it.qty || 1, it.length * (it.qty || 1), w, it.notes || '', 'ממתין');
  });

  // Mark intake as approved
  db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('approved', row.id);

  res.json({ success: true, orderId, orderNum });
});

// ── INTAKE – Reject: mark as not an order ────────────────────────
app.post('/api/intake/:id/reject', (req, res) => {
  const r = db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('rejected', req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'לא נמצא' });
  res.json({ success: true });
});

// ── INTAKE – Parse text manually (WhatsApp / Email paste) ──────────
app.post('/api/intake/parse-text', (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const parsed = source === 'whatsapp'
    ? intake.parseWhatsAppMessage(text)
    : intake.parseOCRText(text);
  parsed.source = source || 'manual';
  db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
    .run(source || 'manual', text.slice(0, 2000), JSON.stringify(parsed), 'pending');
  res.json({ success: true, parsed });
});

// ── PRICE LIST (admin) ────────────────────────────────────────────
app.get('/api/price-list', (req, res) => {
  res.json(db.prepare('SELECT * FROM price_list ORDER BY diameter').all());
});

app.patch('/api/price-list', async (req, res) => {
  const rows = req.body; // [{diameter, price_list, price_cust}, ...]
  const upsert = db.prepare('INSERT OR REPLACE INTO price_list (diameter,price_list,price_cust) VALUES (?,?,?)');
  const tx = db.transaction(() => rows.forEach(r => upsert.run(r.diameter, r.price_list, r.price_cust)));
  tx();
  res.json({ success: true });

  // Notify portal customers about updated price list (async, don't block response)
  notifyPriceListUpdate(rows).catch(e => console.warn('[PriceList notify]', e));
});

async function notifyPriceListUpdate(rows) {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  // key diameters to show in message
  const keyDiams = [8, 10, 12, 14, 16, 20];
  const priceLines = rows
    .filter(r => keyDiams.includes(r.diameter))
    .map(r => `• Ø${r.diameter}: מחירון ₪${r.price_list}/ק"ג | לקוח קבוע ₪${r.price_cust}/ק"ג`)
    .join('\n');

  // Get all customers with portal tokens and phone numbers
  const customers = db.prepare(
    `SELECT id, name, phone, portal_token FROM customers WHERE portal_token IS NOT NULL AND phone IS NOT NULL`
  ).all();

  for (const c of customers) {
    const link = `${baseUrl}/customer.html?token=${c.portal_token}`;
    const msg = `🔔 *עדכון מחירון IronBend*\n\nשלום ${c.name},\nהמחירון עודכן:\n\n${priceLines}\n\nלצפייה בכל המחירים ולהזמנה:\n${link}`;
    try { await intake.sendWhatsApp(c.phone, msg); } catch {}
    // small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }
}

// Generate / fetch portal token for a customer
app.get('/api/customers/:id/token', (req, res) => {
  let c = db.prepare('SELECT id,name,portal_token FROM customers WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  if (!c.portal_token) {
    const token = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE customers SET portal_token=? WHERE id=?').run(token, c.id);
    c.portal_token = token;
  }
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json({ token: c.portal_token, link: `${baseUrl}/customer.html?token=${c.portal_token}` });
});

app.patch('/api/customers/:id/pricing', (req, res) => {
  const { price_tier, discount_pct } = req.body;
  db.prepare('UPDATE customers SET price_tier=?,discount_pct=? WHERE id=?')
    .run(price_tier, discount_pct ?? 0, req.params.id);
  res.json({ success: true });
});

// ── CUSTOMER PORTAL API ───────────────────────────────────────────
function resolveCustomer(token, phone) {
  if (token) return db.prepare('SELECT * FROM customers WHERE portal_token=?').get(token);
  if (phone) return db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
  return null;
}

// Auth: get/create customer by phone (walk-in) or by token
app.post('/api/c/auth', (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'טלפון חובה' });
  let c = db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
  if (!c) {
    if (!name) return res.json({ needName: true }); // ask for name first
    const r = db.prepare('INSERT INTO customers (name,phone,price_tier) VALUES (?,?,?)').run(name, phone, 'list');
    c = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
  }
  if (!c.portal_token) {
    const token = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE customers SET portal_token=? WHERE id=?').run(token, c.id);
    c = db.prepare('SELECT * FROM customers WHERE id=?').get(c.id);
  }
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json({
    token: c.portal_token,
    link: `${baseUrl}/customer.html?token=${c.portal_token}`,
    customer: { id: c.id, name: c.name, phone: c.phone, price_tier: c.price_tier }
  });
});

// Get customer info + recent orders
app.get('/api/c/me', (req, res) => {
  const { token } = req.query;
  const c = resolveCustomer(token);
  if (!c) return res.status(401).json({ error: 'לא מורשה' });
  const orders = db.prepare(`
    SELECT id, order_num, status, created_at, total_weight, billing_weight, delivery_date, portal_price
    FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 20
  `).all(c.id);
  res.json({ customer: { id: c.id, name: c.name, phone: c.phone, price_tier: c.price_tier, discount_pct: c.discount_pct }, orders });
});

// Shapes (public)
app.get('/api/c/shapes', (req, res) => {
  res.json(db.prepare('SELECT * FROM shapes WHERE active=1 ORDER BY id').all());
});

// Price list for this customer
app.get('/api/c/price-list', (req, res) => {
  const { token } = req.query;
  const c = resolveCustomer(token);
  const tier = c?.price_tier || 'list';
  const discount = c?.discount_pct || 0;
  const pl = db.prepare('SELECT * FROM price_list ORDER BY diameter').all();
  const result = pl.map(row => ({
    diameter: row.diameter,
    price_per_kg: ((tier === 'customer' ? row.price_cust : row.price_list) * (1 - discount / 100)).toFixed(2)
  }));
  res.json(result);
});

// Quote — calculate price for items before ordering
app.post('/api/c/quote', (req, res) => {
  const { token, items } = req.body; // items: [{diameter, sides[], qty}]
  const c = resolveCustomer(token);
  const tier = c?.price_tier || 'list';
  const discount = c?.discount_pct || 0;
  const pl = db.prepare('SELECT * FROM price_list ORDER BY diameter').all();
  const priceMap = {};
  pl.forEach(r => {
    priceMap[r.diameter] = (tier === 'customer' ? r.price_cust : r.price_list) * (1 - discount / 100);
  });
  const WEIGHTS = {6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86};
  let totalWeight = 0, totalPrice = 0;
  const breakdown = (items || []).map(item => {
    const totalLengthMm = (item.sides || []).reduce((s,v) => s+v, 0);
    const kgPerM = WEIGHTS[item.diameter] ?? (item.diameter*item.diameter*0.00617);
    const weight = (totalLengthMm / 1000) * kgPerM * (item.qty || 1);
    const ppu = priceMap[item.diameter] || 0;
    const price = weight * ppu;
    totalWeight += weight;
    totalPrice += price;
    return { diameter: item.diameter, weight: +weight.toFixed(3), price_per_kg: +ppu.toFixed(2), price: +price.toFixed(2) };
  });
  // Add 3% waste
  const waste = 0.03;
  const billingWeight = totalWeight * (1 + waste);
  const billingPrice  = totalPrice  * (1 + waste);
  res.json({ breakdown, totalWeight: +totalWeight.toFixed(2), billingWeight: +billingWeight.toFixed(2), totalPrice: +totalPrice.toFixed(2), billingPrice: +billingPrice.toFixed(2), currency: '₪' });
});

// Submit order from portal
app.post('/api/c/order', async (req, res) => {
  const { token, phone, name, items, deliveryDate, deliveryTime, deliveryAddress, notes } = req.body;
  let c = resolveCustomer(token, phone);
  if (!c && name && phone) {
    const r = db.prepare('INSERT INTO customers (name,phone,price_tier) VALUES (?,?,?)').run(name, phone, 'list');
    const tok = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE customers SET portal_token=? WHERE id=?').run(tok, r.lastInsertRowid);
    c = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
  }
  if (!c) return res.status(401).json({ error: 'נדרש זיהוי' });
  if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });

  // Calculate price
  const tier = c.price_tier || 'list';
  const discount = c.discount_pct || 0;
  const pl = db.prepare('SELECT * FROM price_list ORDER BY diameter').all();
  const priceMap = {};
  pl.forEach(r => { priceMap[r.diameter] = (tier === 'customer' ? r.price_cust : r.price_list) * (1 - discount / 100); });
  const WEIGHTS = {6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86};

  let totalWeight = 0, totalPrice = 0;
  const orderNum = generateOrderNum();
  const wastePct = 3;
  const confirmToken = crypto.randomBytes(16).toString('hex');

  const orderRow = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_time,delivery_address,
      priority,general_notes,total_weight,waste_pct_charged,billing_weight,portal_order,status,confirm_token)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'ממתינה לאישור לקוח',?)
  `).run(orderNum, c.id, 'פורטל לקוח', deliveryDate, deliveryTime, deliveryAddress,
         'רגיל', notes, 0, wastePct, 0, confirmToken);

  const orderId = orderRow.lastInsertRowid;
  const palletRow = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight) VALUES (?,1,9999)').run(orderId);
  const palletId = palletRow.lastInsertRowid;

  const itemLines = [];
  items.forEach(item => {
    const totalLengthMm = (item.sides || []).reduce((s,v) => s+v, 0);
    const kgPerM = WEIGHTS[item.diameter] ?? (item.diameter*item.diameter*0.00617);
    const weight = (totalLengthMm / 1000) * kgPerM * (item.qty || 1);
    const ppu = priceMap[item.diameter] || 0;
    totalWeight += weight;
    totalPrice += weight * ppu;
    const segments = JSON.stringify((item.sides || []).map((l,i) => ({ length_mm:l, angle_deg:(item.angles||[])[i]??0 })));
    let machine = 'A';
    if (item.diameter >= 14 && item.diameter <= 20) machine = 'B';
    else if (item.diameter > 20) machine = 'D';
    db.prepare(`INSERT INTO items (pallet_id,shape_id,shape_name,diameter,segments,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,note,machine)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(palletId, item.shapeId||'s1', item.shapeName||'ישר', item.diameter, segments, totalLengthMm,
           item.qty||1, Math.ceil((item.qty||1)*(1+wastePct/100)), weight/(item.qty||1), weight, item.note||'', machine);
    itemLines.push(`• ${item.qty||1}× Ø${item.diameter} ${item.shapeName||'ישר'} – ${Math.round(totalLengthMm/10)}ס"מ`);
  });

  const billingWeight = totalWeight * (1 + wastePct/100);
  const portalPrice   = totalPrice  * (1 + wastePct/100);
  db.prepare('UPDATE orders SET total_weight=?,billing_weight=?,portal_price=? WHERE id=?')
    .run(totalWeight, billingWeight, portalPrice, orderId);
  db.prepare('UPDATE pallets SET total_weight=? WHERE id=?').run(totalWeight, palletId);

  wsBroadcast('new_order', { orderNum, orderId, channel: 'פורטל לקוח', status: 'ממתינה לאישור לקוח' });

  // Send WhatsApp confirmation with approve link (non-blocking)
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  const approveLink = `${baseUrl}/api/c/approve/${confirmToken}`;
  const delivInfo = deliveryDate ? `📅 אספקה: ${deliveryDate}${deliveryTime ? ' ' + deliveryTime : ''}` : '';
  const addrInfo  = deliveryAddress ? `📍 ${deliveryAddress}` : '';
  const waMsg = `📋 *הזמנה ${orderNum} – ממתינה לאישורך*\n\nשלום ${c.name},\nקיבלנו את הזמנתך:\n\n${itemLines.join('\n')}\n\n⚖️ משקל לחיוב: ${billingWeight.toFixed(1)} ק"ג\n💰 סה"כ: ₪${portalPrice.toFixed(0)}\n${delivInfo}\n${addrInfo}\n\n*לאישור ותחילת ייצור – לחץ כאן:*\n${approveLink}\n\n_⚠️ ייצור יתחיל רק לאחר אישורך_`;

  if (c.phone) intake.sendWhatsApp(c.phone, waMsg).catch(e => console.warn('[Order confirm WA]', e));

  res.json({
    success: true, orderNum, orderId,
    summary: { totalWeight: +totalWeight.toFixed(2), billingWeight: +billingWeight.toFixed(2), portalPrice: +portalPrice.toFixed(2) },
    token: c.portal_token,
    awaitingApproval: true
  });
});

// Customer order approval (link from WhatsApp)
app.get('/api/c/approve/:token', (req, res) => {
  const order = db.prepare('SELECT o.*,c.name as customer_name,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.confirm_token=?').get(req.params.token);
  if (!order) return res.status(404).send(approvalPage('לא נמצא', 'קישור לא תקין או פג תוקף.', false));
  if (order.status !== 'ממתינה לאישור לקוח') {
    return res.send(approvalPage('כבר אושרה', `הזמנה ${order.order_num} כבר אושרה ובטיפול!`, true));
  }
  db.prepare("UPDATE orders SET status='אושרה – ממתין לייצור', confirm_token=NULL WHERE id=?").run(order.id);
  wsBroadcast('order_status', { id: order.id, status: 'אושרה – ממתין לייצור', orderNum: order.order_num });
  // Notify factory via WA to the notify phone
  const notifyPhone = db.prepare("SELECT value FROM settings WHERE key='WHATSAPP_NOTIFY_PHONE'").get()?.value;
  if (notifyPhone) {
    const msg = `✅ הזמנה ${order.order_num} אושרה ע"י הלקוח ${order.customer_name||''} – ניתן להתחיל ייצור!`;
    intake.sendWhatsApp(notifyPhone, msg).catch(()=>{});
  }
  return res.send(approvalPage('✅ הזמנה אושרה!', `הזמנה ${order.order_num} אושרה בהצלחה.\nנתחיל בייצור בהקדם האפשרי. 🏗️`, true));
});

// Also allow approval from portal (POST)
app.post('/api/c/approve', (req, res) => {
  const { token, orderId } = req.body;
  const c = resolveCustomer(token);
  if (!c) return res.status(401).json({ error: 'לא מורשה' });
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=? AND status=?').get(orderId, c.id, 'ממתינה לאישור לקוח');
  if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה או כבר אושרה' });
  db.prepare("UPDATE orders SET status='אושרה – ממתין לייצור', confirm_token=NULL WHERE id=?").run(orderId);
  wsBroadcast('order_status', { id: orderId, status: 'אושרה – ממתין לייצור', orderNum: order.order_num });
  const notifyPhone = db.prepare("SELECT value FROM settings WHERE key='WHATSAPP_NOTIFY_PHONE'").get()?.value;
  if (notifyPhone) {
    intake.sendWhatsApp(notifyPhone, `✅ הזמנה ${order.order_num} אושרה ע"י הלקוח – ניתן להתחיל ייצור!`).catch(()=>{});
  }
  res.json({ success: true });
});

function approvalPage(title, msg, success) {
  const color = success ? '#27ae60' : '#e74c3c';
  const icon  = success ? '✅' : '❌';
  return `<!DOCTYPE html><html lang="he" dir="rtl">
  <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;direction:rtl}
  .box{background:#fff;border-radius:20px;padding:40px 32px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.1);max-width:380px;width:90%}
  .icon{font-size:64px;margin-bottom:16px}
  h1{font-size:22px;color:${color};margin-bottom:12px}
  p{color:#555;font-size:15px;line-height:1.6;white-space:pre-line}
  a{display:inline-block;margin-top:24px;padding:12px 28px;background:#e07b39;color:#fff;border-radius:12px;text-decoration:none;font-weight:700}
  </style></head>
  <body><div class="box">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${msg}</p>
    <a href="/">חזרה לדף הבית</a>
  </div></body></html>`;
}

// Customer order history
app.get('/api/c/orders/:orderId', (req, res) => {
  const { token } = req.query;
  const c = resolveCustomer(token);
  if (!c) return res.status(401).json({ error: 'לא מורשה' });
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=?').get(req.params.orderId, c.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id); });
  order.pallets = pallets;
  res.json(order);
});

// ── AI PREDICTION ─────────────────────────────────────────────────
app.post('/api/ai/predict', (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });
  const result = ai.predictProductionTime(items);
  res.json(result);
});

app.get('/api/ai/predict-order/:orderId', (req, res) => {
  const order   = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
  const items   = pallets.flatMap(p => db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id));
  const prediction   = ai.predictProductionTime(items);
  const feasibility  = ai.checkDeliveryFeasibility(order, items);
  res.json({ prediction, feasibility });
});

app.get('/api/ai/waste-patterns', (req, res) => {
  res.json(ai.analyzeWastePatterns());
});

app.get('/api/ai/machine-efficiency', (req, res) => {
  const days = Number(req.query.days || 7);
  res.json(ai.getMachineEfficiency(days));
});

// ── REPORTS ───────────────────────────────────────────────────────
app.get('/api/reports/summary', (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const toDate   = to   || new Date().toISOString().split('T')[0];

  res.json({
    period: { from: fromDate, to: toDate },
    orders: db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total_weight) as weight
      FROM orders WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at) ORDER BY date
    `).all(fromDate, toDate),
    byStatus: db.prepare(`
      SELECT status, COUNT(*) as count FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status
    `).all(fromDate, toDate),
    waste: ai.analyzeWastePatterns(),
    machineEfficiency: ai.getMachineEfficiency(30),
    topCustomers: db.prepare(`
      SELECT c.name, COUNT(o.id) as order_count, SUM(o.billing_weight) as total_weight
      FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
      WHERE DATE(o.created_at) BETWEEN ? AND ?
      GROUP BY o.customer_id ORDER BY total_weight DESC LIMIT 10
    `).all(fromDate, toDate),
  });
});

// ── BACKGROUND JOBS ───────────────────────────────────────────────
// Check alerts every 5 minutes
cron.schedule('*/5 * * * *', () => {
  // Urgent orders sitting >30 min without production
  const urgentLate = db.prepare(`
    SELECT o.id, o.order_num FROM orders o
    WHERE o.priority='דחוף' AND o.status NOT IN ('בייצור','הושלם – ממתין לאיסוף','בדרך ללקוח','סופק – אושר','בוטל')
      AND JULIANDAY('now') - JULIANDAY(o.created_at) > 0.021
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.order_id=o.id AND a.type='urgent_late' AND a.resolved=0)
  `).all();
  urgentLate.forEach(o => createAlert('urgent_late', 'danger', `הזמנה דחופה ${o.order_num} ממתינה לייצור מעל 30 דקות`, { orderId: o.id }));

  // Pending approval >15 min
  const pendingLong = db.prepare(`
    SELECT o.id, o.order_num FROM orders o
    WHERE o.status='ממתינה לאישור'
      AND JULIANDAY('now') - JULIANDAY(o.created_at) > 0.01
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.order_id=o.id AND a.type='pending_approval' AND a.resolved=0)
  `).all();
  pendingLong.forEach(o => createAlert('pending_approval', 'info', `הזמנה ${o.order_num} ממתינה לאישור מעל 15 דקות`, { orderId: o.id }));
});

// Email polling every minute — reads settings from DB (not just .env)
cron.schedule('* * * * *', async () => {
  const host = getSetting('EMAIL_IMAP_HOST');
  if (!host) return;
  try {
    const results = await intake.pollEmail(db, {
      host,
      user:       getSetting('EMAIL_IMAP_USER'),
      pass:       getSetting('EMAIL_IMAP_PASS'),
      port:       getSetting('EMAIL_IMAP_PORT') || 993,
      geminiKey:  getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY,
    });
    if (results.length) {
      wsBroadcast('new_intake_email', { count: results.length });
      console.log(`[Email] ${results.length} הזמנות חדשות נמצאו`);
    }
  } catch (err) {
    console.error('[Email cron]', err.message);
  }
});

// ── START ─────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
// NEW MODULES: SUPPLIERS, INVENTORY, AUDIT, USERS, QC, MAINTENANCE,
// PROJECTS, SITES, CREDIT, WASTE
// ══════════════════════════════════════════════════════════════════

// ── SUPPLIERS
app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name').all());
});
app.post('/api/suppliers', (req, res) => {
  const { name, phone, contact, email, address, payment_terms, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'שם ספק חובה' });
  const r = db.prepare('INSERT INTO suppliers (name,phone,contact,email,address,payment_terms,notes) VALUES (?,?,?,?,?,?,?)')
    .run(name, phone||null, contact||null, email||null, address||null, payment_terms||null, notes||null);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/suppliers/:id', (req, res) => {
  const f = req.body;
  db.prepare('UPDATE suppliers SET name=COALESCE(?,name),phone=COALESCE(?,phone),contact=COALESCE(?,contact),email=COALESCE(?,email),address=COALESCE(?,address),payment_terms=COALESCE(?,payment_terms),notes=COALESCE(?,notes),active=COALESCE(?,active) WHERE id=?')
    .run(f.name||null,f.phone||null,f.contact||null,f.email||null,f.address||null,f.payment_terms||null,f.notes||null,f.active??null,req.params.id);
  res.json({ success: true });
});

// ── RAW MATERIAL INVENTORY
app.get('/api/inventory', (req, res) => {
  const { diameter, supplier_id } = req.query;
  let sql = 'SELECT r.*,s.name as supplier_name,ROUND(r.weight_received-r.weight_used-r.weight_scrapped,2) as weight_available FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id WHERE r.active=1';
  const params = [];
  if (diameter)    { sql += ' AND r.diameter=?';    params.push(diameter); }
  if (supplier_id) { sql += ' AND r.supplier_id=?'; params.push(supplier_id); }
  sql += ' ORDER BY r.received_date DESC, r.id DESC';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/inventory/summary', (req, res) => {
  res.json(db.prepare('SELECT diameter,SUM(weight_received) as total_received,SUM(weight_used) as total_used,SUM(weight_scrapped) as total_scrapped,ROUND(SUM(weight_received-weight_used-weight_scrapped),2) as available,COUNT(*) as batches FROM raw_material WHERE active=1 GROUP BY diameter ORDER BY diameter').all());
});
app.post('/api/inventory', (req, res) => {
  const f = req.body;
  if (!f.diameter || !f.weight_received) return res.status(400).json({ error: 'קוטר ומשקל חובה' });
  const r = db.prepare('INSERT INTO raw_material (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.material_type||'coil',f.diameter,f.supplier_id||null,f.lot_number||null,f.certificate_num||null,f.grade||'B500B',f.received_date||new Date().toISOString().split('T')[0],f.weight_received,f.purchase_price||0,f.warehouse_loc||null,f.notes||null);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/inventory/:id', (req, res) => {
  const f = req.body;
  db.prepare('UPDATE raw_material SET weight_used=COALESCE(?,weight_used),weight_scrapped=COALESCE(?,weight_scrapped),warehouse_loc=COALESCE(?,warehouse_loc),notes=COALESCE(?,notes),active=COALESCE(?,active) WHERE id=?')
    .run(f.weight_used??null,f.weight_scrapped??null,f.warehouse_loc||null,f.notes||null,f.active??null,req.params.id);
  res.json({ success: true });
});

// ── AUDIT LOG
function auditLog(entityType,entityId,entityRef,action,fieldName,oldVal,newVal,notes,userId,userName) {
  try {
    db.prepare('INSERT INTO audit_log (entity_type,entity_id,entity_ref,action,field_name,old_value,new_value,notes,user_id,user_name) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(entityType,entityId||null,entityRef||null,action,fieldName||null,oldVal!=null?String(oldVal):null,newVal!=null?String(newVal):null,notes||null,userId||null,userName||null);
  } catch(e) { console.warn('[Audit]',e.message); }
}
app.get('/api/audit-log', (req, res) => {
  const { entity_type, entity_id, limit=200, offset=0 } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (entity_type) { sql += ' AND entity_type=?'; params.push(entity_type); }
  if (entity_id)   { sql += ' AND entity_id=?';   params.push(entity_id); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit),Number(offset));
  res.json(db.prepare(sql).all(...params));
});

// Order status with audit
app.patch('/api/orders/:id/status', (req, res) => {
  const { status, userId, userName } = req.body;
  if (!status) return res.status(400).json({ error: 'חסר סטטוס' });
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  if (order.locked) return res.status(403).json({ error: 'הזמנה נעולה' });
  const old = order.status;
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, order.id);
  auditLog('order',order.id,order.order_num,'status_change','status',old,status,null,userId,userName);
  wsBroadcast('order_status',{ id:order.id, status, orderNum:order.order_num });
  if (order.customer_id) {
    const c = db.prepare('SELECT phone FROM customers WHERE id=?').get(order.customer_id);
    if (c?.phone) intake.notifyOrderStatus(c.phone,order.order_num,status).catch(()=>{});
  }
  res.json({ success: true });
});
app.patch('/api/orders/:id/lock', (req, res) => {
  const { userId, userName } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  db.prepare('UPDATE orders SET locked=1,locked_by=?,locked_at=? WHERE id=?').run(userId||null,new Date().toISOString(),order.id);
  auditLog('order',order.id,order.order_num,'lock','locked','0','1','נעילה לאחר שילוח',userId,userName);
  res.json({ success: true });
});
app.patch('/api/orders/:id/unlock', (req, res) => {
  const { userId, userName } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  db.prepare('UPDATE orders SET locked=0,locked_by=NULL,locked_at=NULL WHERE id=?').run(order.id);
  auditLog('order',order.id,order.order_num,'unlock','locked','1','0','פתיחת נעילה',userId,userName);
  res.json({ success: true });
});

// ── USERS / ROLES
app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT id,username,display_name,role,phone,active,last_login,created_at FROM users ORDER BY role,display_name').all());
});
app.post('/api/users', (req, res) => {
  const { username, display_name, role, pin, phone } = req.body;
  if (!username||!display_name) return res.status(400).json({ error: 'שם משתמש ושם תצוגה חובה' });
  try {
    const r = db.prepare('INSERT INTO users (username,display_name,role,pin,phone) VALUES (?,?,?,?,?)').run(username,display_name,role||'operator',pin||null,phone||null);
    res.json({ id: r.lastInsertRowid });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'שם משתמש קיים' });
    throw e;
  }
});
app.patch('/api/users/:id', (req, res) => {
  const f = req.body;
  db.prepare('UPDATE users SET display_name=COALESCE(?,display_name),role=COALESCE(?,role),pin=COALESCE(?,pin),phone=COALESCE(?,phone),active=COALESCE(?,active) WHERE id=?')
    .run(f.display_name||null,f.role||null,f.pin||null,f.phone||null,f.active??null,req.params.id);
  res.json({ success: true });
});
app.post('/api/users/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'חסר PIN' });
  const user = db.prepare('SELECT id,username,display_name,role FROM users WHERE pin=? AND active=1').get(pin);
  if (!user) return res.status(401).json({ error: 'PIN שגוי' });
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(new Date().toISOString(),user.id);
  res.json(user);
});

// ── QUALITY CONTROL
app.get('/api/quality', (req, res) => {
  const { order_id, item_id, result, limit=100 } = req.query;
  let sql = 'SELECT q.*,u.display_name as inspector_name FROM quality_checks q LEFT JOIN users u ON q.inspector_id=u.id WHERE 1=1';
  const params = [];
  if (order_id) { sql+=' AND q.order_id=?'; params.push(order_id); }
  if (item_id)  { sql+=' AND q.item_id=?';  params.push(item_id); }
  if (result)   { sql+=' AND q.result=?';   params.push(result); }
  sql+=' ORDER BY q.checked_at DESC LIMIT ?'; params.push(Number(limit));
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/quality', (req, res) => {
  const f = req.body;
  if (!f.item_id) return res.status(400).json({ error: 'item_id חובה' });
  const r = db.prepare('INSERT INTO quality_checks (item_id,order_id,order_num,inspector_id,check_type,sample_qty,pass_qty,fail_qty,deviation_mm,deviation_deg,result,action_taken,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.item_id,f.order_id||null,f.order_num||null,f.inspector_id||null,f.check_type||'length',f.sample_qty||1,f.pass_qty||0,f.fail_qty||0,f.deviation_mm||0,f.deviation_deg||0,f.result||'pass',f.action_taken||null,f.notes||null);
  db.prepare('UPDATE items SET qc_status=? WHERE id=?').run(f.result==='pass'?'עבר':'נכשל',f.item_id);
  res.json({ id: r.lastInsertRowid });
});
app.get('/api/quality/stats', (req, res) => {
  res.json({
    total:   db.prepare('SELECT COUNT(*) as c FROM quality_checks').get().c,
    passed:  db.prepare("SELECT COUNT(*) as c FROM quality_checks WHERE result='pass'").get().c,
    failed:  db.prepare("SELECT COUNT(*) as c FROM quality_checks WHERE result='fail'").get().c,
    byType:  db.prepare('SELECT check_type,COUNT(*) as c,AVG(deviation_mm) as avg_dev FROM quality_checks GROUP BY check_type').all(),
  });
});

// ── MAINTENANCE
app.get('/api/maintenance', (req, res) => {
  const { machine_id, status, limit=100 } = req.query;
  let sql = 'SELECT m.*,mc.name as machine_name,mc.label as machine_label,u.display_name as reported_by_name,u2.display_name as assigned_to_name FROM maintenance_logs m LEFT JOIN machines mc ON m.machine_id=mc.id LEFT JOIN users u ON m.reported_by=u.id LEFT JOIN users u2 ON m.assigned_to=u2.id WHERE 1=1';
  const params = [];
  if (machine_id) { sql+=' AND m.machine_id=?'; params.push(machine_id); }
  if (status)     { sql+=' AND m.status=?';     params.push(status); }
  sql+=' ORDER BY m.started_at DESC LIMIT ?'; params.push(Number(limit));
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/maintenance', (req, res) => {
  const f = req.body;
  if (!f.machine_id||!f.description) return res.status(400).json({ error: 'מכונה ותיאור חובה' });
  if (f.log_type==='breakdown') {
    db.prepare("UPDATE machines SET status='תקלה' WHERE id=?").run(f.machine_id);
    wsBroadcast('machine_update',{ machineId:f.machine_id, status:'תקלה' });
  }
  const r = db.prepare('INSERT INTO maintenance_logs (machine_id,log_type,description,reported_by,priority,parts_used,cost) VALUES (?,?,?,?,?,?,?)')
    .run(f.machine_id,f.log_type||'breakdown',f.description,f.reported_by||null,f.priority||'רגיל',f.parts_used||null,f.cost||0);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/maintenance/:id', (req, res) => {
  const f = req.body;
  const log = db.prepare('SELECT * FROM maintenance_logs WHERE id=?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'לא נמצא' });
  const resolvedAt = f.status==='סגורה' ? new Date().toISOString() : null;
  db.prepare('UPDATE maintenance_logs SET status=COALESCE(?,status),assigned_to=COALESCE(?,assigned_to),downtime_min=COALESCE(?,downtime_min),root_cause=COALESCE(?,root_cause),fix_notes=COALESCE(?,fix_notes),parts_used=COALESCE(?,parts_used),cost=COALESCE(?,cost),resolved_at=COALESCE(?,resolved_at) WHERE id=?')
    .run(f.status||null,f.assigned_to||null,f.downtime_min||null,f.root_cause||null,f.fix_notes||null,f.parts_used||null,f.cost||null,resolvedAt,req.params.id);
  if (f.status==='סגורה'&&log.log_type==='breakdown') db.prepare("UPDATE machines SET status='מחובר' WHERE id=?").run(log.machine_id);
  res.json({ success: true });
});
app.get('/api/maintenance/stats', (req, res) => {
  res.json({
    open:        db.prepare("SELECT COUNT(*) as c FROM maintenance_logs WHERE status!='סגורה'").get().c,
    breakdowns:  db.prepare("SELECT COUNT(*) as c FROM maintenance_logs WHERE log_type='breakdown'").get().c,
    avgDowntime: db.prepare('SELECT ROUND(AVG(downtime_min),0) as avg FROM maintenance_logs WHERE downtime_min>0').get().avg||0,
    byMachine:   db.prepare('SELECT mc.label,mc.name,COUNT(*) as events,SUM(m.downtime_min) as total_down FROM maintenance_logs m LEFT JOIN machines mc ON m.machine_id=mc.id GROUP BY m.machine_id ORDER BY total_down DESC').all(),
  });
});

// ── PROJECTS & SITES
app.get('/api/projects', (req, res) => {
  const { customer_id, status } = req.query;
  let sql = 'SELECT p.*,c.name as customer_name,COUNT(DISTINCT s.id) as site_count,COUNT(DISTINCT o.id) as order_count FROM projects p LEFT JOIN customers c ON p.customer_id=c.id LEFT JOIN sites s ON s.project_id=p.id LEFT JOIN orders o ON o.project_id=p.id WHERE 1=1';
  const params = [];
  if (customer_id) { sql+=' AND p.customer_id=?'; params.push(customer_id); }
  if (status)      { sql+=' AND p.status=?';      params.push(status); }
  sql+=' GROUP BY p.id ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/projects/:id', (req, res) => {
  const p = db.prepare('SELECT p.*,c.name as customer_name FROM projects p LEFT JOIN customers c ON p.customer_id=c.id WHERE p.id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'לא נמצא' });
  p.sites  = db.prepare('SELECT * FROM sites WHERE project_id=? ORDER BY name').all(p.id);
  p.orders = db.prepare('SELECT id,order_num,status,total_weight,created_at FROM orders WHERE project_id=? ORDER BY created_at DESC').all(p.id);
  res.json(p);
});
app.post('/api/projects', (req, res) => {
  const f = req.body;
  if (!f.name) return res.status(400).json({ error: 'שם פרויקט חובה' });
  const r = db.prepare('INSERT INTO projects (customer_id,name,project_num,status,start_date,end_date,total_budget,contact_name,contact_phone,notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(f.customer_id||null,f.name,f.project_num||null,f.status||'פעיל',f.start_date||null,f.end_date||null,f.total_budget||0,f.contact_name||null,f.contact_phone||null,f.notes||null);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/projects/:id', (req, res) => {
  const f = req.body;
  db.prepare('UPDATE projects SET name=COALESCE(?,name),project_num=COALESCE(?,project_num),status=COALESCE(?,status),start_date=COALESCE(?,start_date),end_date=COALESCE(?,end_date),total_budget=COALESCE(?,total_budget),contact_name=COALESCE(?,contact_name),contact_phone=COALESCE(?,contact_phone),notes=COALESCE(?,notes) WHERE id=?')
    .run(f.name||null,f.project_num||null,f.status||null,f.start_date||null,f.end_date||null,f.total_budget||null,f.contact_name||null,f.contact_phone||null,f.notes||null,req.params.id);
  res.json({ success: true });
});

app.get('/api/sites', (req, res) => {
  const { project_id, customer_id } = req.query;
  let sql = 'SELECT s.*,p.name as project_name,c.name as customer_name FROM sites s LEFT JOIN projects p ON s.project_id=p.id LEFT JOIN customers c ON s.customer_id=c.id WHERE s.active=1';
  const params = [];
  if (project_id)  { sql+=' AND s.project_id=?';  params.push(project_id); }
  if (customer_id) { sql+=' AND s.customer_id=?'; params.push(customer_id); }
  sql+=' ORDER BY s.name';
  res.json(db.prepare(sql).all(...params));
});
app.post('/api/sites', (req, res) => {
  const f = req.body;
  if (!f.name) return res.status(400).json({ error: 'שם אתר חובה' });
  const r = db.prepare('INSERT INTO sites (project_id,customer_id,name,address,lat,lng,contact_name,contact_phone,access_notes) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(f.project_id||null,f.customer_id||null,f.name,f.address||null,f.lat||null,f.lng||null,f.contact_name||null,f.contact_phone||null,f.access_notes||null);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/sites/:id', (req, res) => {
  const f = req.body;
  db.prepare('UPDATE sites SET name=COALESCE(?,name),address=COALESCE(?,address),lat=COALESCE(?,lat),lng=COALESCE(?,lng),contact_name=COALESCE(?,contact_name),contact_phone=COALESCE(?,contact_phone),access_notes=COALESCE(?,access_notes),active=COALESCE(?,active) WHERE id=?')
    .run(f.name||null,f.address||null,f.lat||null,f.lng||null,f.contact_name||null,f.contact_phone||null,f.access_notes||null,f.active??null,req.params.id);
  res.json({ success: true });
});

// ── CREDIT ACCOUNTS
app.get('/api/credit', (req, res) => {
  res.json(db.prepare('SELECT ca.*,c.name as customer_name,c.phone as customer_phone FROM credit_accounts ca LEFT JOIN customers c ON ca.customer_id=c.id ORDER BY ca.blocked DESC,ca.current_debt DESC').all());
});
app.get('/api/credit/:customerId', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id,credit_limit) VALUES (?,0)').run(req.params.customerId);
  const acc = db.prepare('SELECT ca.*,c.name as customer_name FROM credit_accounts ca LEFT JOIN customers c ON ca.customer_id=c.id WHERE ca.customer_id=?').get(req.params.customerId);
  acc.transactions = db.prepare('SELECT * FROM credit_transactions WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').all(req.params.customerId);
  res.json(acc);
});
app.patch('/api/credit/:customerId', (req, res) => {
  const f = req.body;
  db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id) VALUES (?)').run(req.params.customerId);
  db.prepare('UPDATE credit_accounts SET credit_limit=COALESCE(?,credit_limit),payment_terms=COALESCE(?,payment_terms),blocked=COALESCE(?,blocked),block_reason=COALESCE(?,block_reason),notes=COALESCE(?,notes),updated_at=CURRENT_TIMESTAMP WHERE customer_id=?')
    .run(f.credit_limit??null,f.payment_terms||null,f.blocked??null,f.block_reason||null,f.notes||null,req.params.customerId);
  res.json({ success: true });
});
app.post('/api/credit/:customerId/transaction', (req, res) => {
  const { type, amount, order_id, description } = req.body;
  if (!type||!amount) return res.status(400).json({ error: 'סוג וסכום חובה' });
  db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id) VALUES (?)').run(req.params.customerId);
  const r = db.prepare('INSERT INTO credit_transactions (customer_id,order_id,type,amount,description) VALUES (?,?,?,?,?)').run(req.params.customerId,order_id||null,type,amount,description||null);
  const delta = (type==='payment'||type==='credit_note') ? -Math.abs(amount) : Math.abs(amount);
  db.prepare('UPDATE credit_accounts SET current_debt=ROUND(current_debt+?,2),updated_at=CURRENT_TIMESTAMP WHERE customer_id=?').run(delta,req.params.customerId);
  const acc = db.prepare('SELECT * FROM credit_accounts WHERE customer_id=?').get(req.params.customerId);
  if (acc&&acc.credit_limit>0&&acc.current_debt>acc.credit_limit) {
    db.prepare("UPDATE credit_accounts SET blocked=1,block_reason='חריגה ממסגרת אשראי' WHERE customer_id=?").run(req.params.customerId);
  }
  res.json({ id: r.lastInsertRowid });
});
// Block status from credit endpoint
app.get('/api/credit/:customerId/status', (req, res) => {
  const acc = db.prepare('SELECT blocked,block_reason,credit_limit,current_debt FROM credit_accounts WHERE customer_id=?').get(req.params.customerId);
  res.json(acc || { blocked: 0, credit_limit: 0, current_debt: 0 });
});

// ── WASTE SUMMARY
app.get('/api/waste/summary', (req, res) => {
  const { from, to } = req.query;
  const fromDate = from || new Date(Date.now()-30*86400000).toISOString().split('T')[0];
  const toDate   = to   || new Date().toISOString().split('T')[0];
  res.json({
    period: { from:fromDate, to:toDate },
    byDiameter: db.prepare('SELECT i.diameter,SUM(i.quantity) as items_produced,SUM(i.weight) as net_weight,SUM(i.actual_waste) as actual_waste_g,ROUND(AVG(CAST(i.actual_waste AS REAL)/NULLIF(i.total_length_mm,0)*100),2) as waste_pct FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 GROUP BY i.diameter ORDER BY i.diameter').all(fromDate,toDate),
    topWaste: db.prepare('SELECT o.order_num,i.diameter,i.actual_waste,i.weight,i.shape_name FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 ORDER BY i.actual_waste DESC LIMIT 20').all(fromDate,toDate),
    rawMaterial: db.prepare('SELECT diameter,SUM(weight_scrapped) as total_scrapped,SUM(weight_received) as total_received,ROUND(100.0*SUM(weight_scrapped)/NULLIF(SUM(weight_received),0),1) as scrap_pct FROM raw_material GROUP BY diameter ORDER BY diameter').all(),
  });
});

// ═══════════════════════════════════════════════════════════════════
// ── SPEC-B ROUTES ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ── SHIFTS ────────────────────────────────────────────────────────
app.get('/api/shifts', (req, res) => {
  const { date, machine_id, limit = 50 } = req.query;
  let q = `SELECT s.*, u.display_name as operator_name, m.name as machine_name
           FROM shifts s
           LEFT JOIN users u ON s.operator_id=u.id
           LEFT JOIN machines m ON s.machine_id=m.id`;
  const wheres = [], params = [];
  if (date)       { wheres.push("s.date=?");       params.push(date); }
  if (machine_id) { wheres.push("s.machine_id=?"); params.push(machine_id); }
  if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
  q += ' ORDER BY s.started_at DESC LIMIT ?';
  params.push(Number(limit));
  res.json(db.prepare(q).all(...params));
});

app.post('/api/shifts', (req, res) => {
  const { shift_type, date, operator_id, machine_id, notes } = req.body;
  const today = date || new Date().toISOString().slice(0, 10);
  const r = db.prepare(`INSERT INTO shifts (shift_type,date,operator_id,machine_id,notes) VALUES (?,?,?,?,?)`)
    .run(shift_type || 'morning', today, operator_id || null, machine_id || null, notes || null);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/shifts/:id/end', (req, res) => {
  const { total_pieces, total_weight, notes } = req.body;
  db.prepare(`UPDATE shifts SET ended_at=CURRENT_TIMESTAMP, total_pieces=?, total_weight=?, notes=COALESCE(?,notes) WHERE id=?`)
    .run(total_pieces || 0, total_weight || 0, notes || null, req.params.id);
  res.json({ ok: true });
});

// ── DOWNTIME REASONS ──────────────────────────────────────────────
app.get('/api/downtime-reasons', (req, res) => {
  res.json(db.prepare('SELECT * FROM downtime_reasons ORDER BY label').all());
});

// ── MACHINE STOPS ─────────────────────────────────────────────────
app.get('/api/machine-stops', (req, res) => {
  const { machine_id, shift_id, active } = req.query;
  let q = `SELECT ms.*, dr.label as reason_label, dr.color as reason_color,
           u.display_name as reported_by_name
           FROM machine_stops ms
           LEFT JOIN downtime_reasons dr ON ms.reason_code=dr.code
           LEFT JOIN users u ON ms.reported_by=u.id`;
  const wheres = [], params = [];
  if (machine_id) { wheres.push('ms.machine_id=?'); params.push(machine_id); }
  if (shift_id)   { wheres.push('ms.shift_id=?');   params.push(shift_id); }
  if (active === '1') { wheres.push('ms.ended_at IS NULL'); }
  if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
  q += ' ORDER BY ms.started_at DESC LIMIT 100';
  res.json(db.prepare(q).all(...params));
});

app.post('/api/machine-stops', (req, res) => {
  const { machine_id, shift_id, reason_code, notes, reported_by } = req.body;
  const r = db.prepare(`INSERT INTO machine_stops (machine_id,shift_id,reason_code,notes,reported_by) VALUES (?,?,?,?,?)`)
    .run(machine_id, shift_id || null, reason_code, notes || null, reported_by || null);
  // fire event
  db.prepare(`INSERT INTO production_events (event_type,machine_id,operator_id,payload) VALUES (?,?,?,?)`)
    .run('MachineStopped', machine_id, reported_by || null, JSON.stringify({ reason_code, notes }));
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/machine-stops/:id/end', (req, res) => {
  const stop = db.prepare('SELECT * FROM machine_stops WHERE id=?').get(req.params.id);
  if (!stop) return res.status(404).json({ error: 'not found' });
  const durMin = stop.started_at
    ? Math.round((Date.now() - new Date(stop.started_at).getTime()) / 60000)
    : 0;
  db.prepare(`UPDATE machine_stops SET ended_at=CURRENT_TIMESTAMP, duration_min=? WHERE id=?`)
    .run(durMin, req.params.id);
  res.json({ ok: true, duration_min: durMin });
});

// ── STEEL PRICE HISTORY ───────────────────────────────────────────
app.get('/api/steel-prices', (req, res) => {
  const { diameter } = req.query;
  let q = `SELECT sph.*, s.name as supplier_name FROM steel_price_history sph
           LEFT JOIN suppliers s ON sph.supplier_id=s.id`;
  if (diameter) {
    res.json(db.prepare(q + ' WHERE sph.diameter=? ORDER BY sph.effective_date DESC LIMIT 50').all(diameter));
  } else {
    // Latest price per diameter
    res.json(db.prepare(`SELECT sph.*, s.name as supplier_name
      FROM steel_price_history sph LEFT JOIN suppliers s ON sph.supplier_id=s.id
      WHERE sph.id IN (
        SELECT MAX(id) FROM steel_price_history GROUP BY diameter
      ) ORDER BY sph.diameter`).all());
  }
});

app.post('/api/steel-prices', (req, res) => {
  const { diameter, price_per_ton, supplier_id, effective_date, notes, created_by } = req.body;
  const r = db.prepare(`INSERT INTO steel_price_history (diameter,price_per_ton,supplier_id,effective_date,notes,created_by) VALUES (?,?,?,?,?,?)`)
    .run(diameter, price_per_ton, supplier_id || null, effective_date || new Date().toISOString().slice(0,10), notes || null, created_by || null);
  res.json({ id: r.lastInsertRowid });
});

// ── PACKAGES ─────────────────────────────────────────────────────
app.get('/api/packages', (req, res) => {
  const { order_id, status, zone } = req.query;
  let q = `SELECT pk.*, u.display_name as packed_by_name, c.name as customer_name
           FROM packages pk
           LEFT JOIN orders o ON pk.order_id=o.id
           LEFT JOIN customers c ON o.customer_id=c.id
           LEFT JOIN users u ON pk.packed_by=u.id`;
  const wheres = [], params = [];
  if (order_id) { wheres.push('pk.order_id=?'); params.push(order_id); }
  if (status)   { wheres.push('pk.status=?');   params.push(status); }
  if (zone)     { wheres.push('pk.zone=?');      params.push(zone); }
  if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
  q += ' ORDER BY pk.packed_at DESC LIMIT 200';
  res.json(db.prepare(q).all(...params));
});

app.post('/api/packages', (req, res) => {
  const { order_id, order_num, item_ids, quantity, weight, diameter, zone, packed_by } = req.body;
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const seq = (db.prepare('SELECT COUNT(*)+1 as n FROM packages WHERE package_code LIKE ?').get('PKG-'+dateStr+'%').n || 1);
  const package_code = `PKG-${dateStr}-${String(seq).padStart(3,'0')}`;
  const qr_data = JSON.stringify({ code: package_code, order_num, diameter });
  const r = db.prepare(`INSERT INTO packages (package_code,qr_data,order_id,order_num,item_ids,quantity,weight,diameter,zone,packed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(package_code, qr_data, order_id || null, order_num || null, JSON.stringify(item_ids || []), quantity || 0, weight || 0, diameter || null, zone || null, packed_by || null);
  // Update item package assignments
  if (item_ids && item_ids.length) {
    const upd = db.prepare('UPDATE items SET package_id=?, zone=? WHERE id=?');
    for (const iid of item_ids) upd.run(r.lastInsertRowid, zone || null, iid);
  }
  res.json({ id: r.lastInsertRowid, package_code });
});

app.patch('/api/packages/:id/ship', (req, res) => {
  db.prepare('UPDATE packages SET status=?,shipped_at=CURRENT_TIMESTAMP WHERE id=?')
    .run('shipped', req.params.id);
  res.json({ ok: true });
});

// ── DELIVERY NOTES ────────────────────────────────────────────────
app.get('/api/delivery-notes', (req, res) => {
  const { order_id } = req.query;
  const rows = order_id
    ? db.prepare('SELECT * FROM delivery_notes WHERE order_id=? ORDER BY issued_at DESC').all(order_id)
    : db.prepare('SELECT * FROM delivery_notes ORDER BY issued_at DESC LIMIT 50').all();
  res.json(rows);
});

app.post('/api/delivery-notes', (req, res) => {
  const { order_id, order_num, delivery_id, customer_id, packages_json, items_json, total_weight, driver_id } = req.body;
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const seq = (db.prepare('SELECT COUNT(*)+1 as n FROM delivery_notes WHERE note_num LIKE ?').get('DN-'+dateStr+'%').n || 1);
  const note_num = `DN-${dateStr}-${String(seq).padStart(3,'0')}`;
  const r = db.prepare(`INSERT INTO delivery_notes (note_num,order_id,order_num,delivery_id,customer_id,packages_json,items_json,total_weight,driver_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(note_num, order_id || null, order_num || null, delivery_id || null, customer_id || null,
      JSON.stringify(packages_json || []), JSON.stringify(items_json || []), total_weight || 0, driver_id || null);
  res.json({ id: r.lastInsertRowid, note_num });
});

// ── ITEM STATUS / WASTE UPDATE ───────────────────────────────────
app.patch('/api/items/:id/status', (req, res) => {
  const { status } = req.body;
  const allowed = ['ממתין','בייצור','הושלם','בהמתנה','בוטל'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const updates = { status };
  if (status === 'בייצור' && !item.started_at) updates.started_at = new Date().toISOString();
  if (status === 'הושלם') updates.completed_at = new Date().toISOString();
  db.prepare(`UPDATE items SET status=?${status==='בייצור'&&!item.started_at?',started_at=?':''}${status==='הושלם'?',completed_at=?':''} WHERE id=?`)
    .run(...Object.values(updates), req.params.id);
  wsBroadcast('item_status', { id: Number(req.params.id), status });
  res.json({ ok: true });
});

app.patch('/api/items/:id', (req, res) => {
  const { produced_qty, actual_waste, note, status, package_id, zone } = req.body;
  const fields = [], vals = [];
  if (produced_qty !== undefined) { fields.push('produced_qty=?'); vals.push(produced_qty); }
  if (actual_waste !== undefined) { fields.push('actual_waste=?'); vals.push(actual_waste); }
  if (note         !== undefined) { fields.push('note=?');         vals.push(note); }
  if (status       !== undefined) { fields.push('status=?');       vals.push(status); }
  if (package_id   !== undefined) { fields.push('package_id=?');   vals.push(package_id); }
  if (zone         !== undefined) { fields.push('zone=?');         vals.push(zone); }
  if (!fields.length) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE items SET ${fields.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

// ── PRODUCTION QUEUE ──────────────────────────────────────────────
// Returns pending items grouped and sorted by machine, diameter priority
app.get('/api/production-queue', (req, res) => {
  const { machine } = req.query;
  let q = `
    SELECT i.id, i.pallet_id, i.shape_id, i.shape_name, i.diameter,
           i.quantity, i.produced_qty, i.weight, i.status, i.machine,
           i.segments, i.note, i.qc_status,
           p.order_id, p.pallet_num,
           o.order_num, o.priority, o.delivery_date, o.customer_id,
           c.name as customer_name,
           COALESCE(o.priority='דחוף',0)*100 +
           COALESCE(JULIANDAY('now') - JULIANDAY(o.delivery_date), 0)*10 as priority_score
    FROM items i
    JOIN pallets p ON i.pallet_id=p.id
    JOIN orders o ON p.order_id=o.id
    LEFT JOIN customers c ON o.customer_id=c.id
    WHERE i.status IN ('ממתין','בייצור')
    AND o.status NOT IN ('בוטל','נשלח')
  `;
  const params = [];
  if (machine) { q += ' AND i.machine=?'; params.push(machine); }
  q += ' ORDER BY i.machine, priority_score DESC, o.delivery_date ASC, i.diameter ASC';
  const items = db.prepare(q).all(...params);

  // Group by machine
  const grouped = {};
  for (const item of items) {
    const key = item.machine || 'לא שויך';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  res.json({ items, grouped });
});

// ── PRODUCTION EVENTS ─────────────────────────────────────────────
app.get('/api/production-events', (req, res) => {
  const { machine_id, event_type, limit = 100 } = req.query;
  let q = `SELECT pe.*, m.name as machine_name, u.display_name as operator_name
           FROM production_events pe
           LEFT JOIN machines m ON pe.machine_id=m.id
           LEFT JOIN users u ON pe.operator_id=u.id`;
  const wheres = [], params = [];
  if (machine_id)  { wheres.push('pe.machine_id=?');  params.push(machine_id); }
  if (event_type)  { wheres.push('pe.event_type=?');  params.push(event_type); }
  if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
  q += ' ORDER BY pe.created_at DESC LIMIT ?';
  params.push(Number(limit));
  res.json(db.prepare(q).all(...params));
});

// ── OEE / MACHINE KPIs ────────────────────────────────────────────
app.get('/api/machines/oee', (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const machines = db.prepare('SELECT * FROM machines').all();
  const result = machines.map(m => {
    // Availability: 1 - downtime / shift_hours (assume 8h shift = 480 min)
    const stopMins = db.prepare(
      `SELECT COALESCE(SUM(duration_min),0) as mins FROM machine_stops WHERE machine_id=? AND DATE(started_at)=?`
    ).get(m.id, today).mins;
    const availability = Math.max(0, Math.min(1, 1 - stopMins / 480));

    // Performance: produced pieces vs. theoretical (rough estimate)
    const pieces = db.prepare(
      `SELECT COALESCE(SUM(quantity),0) as q FROM items WHERE machine=? AND DATE(completed_at)=?`
    ).get(m.name, today).q;

    // Quality: pass rate from quality_checks today
    const qc = db.prepare(
      `SELECT SUM(pass_qty) as p, SUM(pass_qty+fail_qty) as t FROM quality_checks WHERE DATE(checked_at)=?`
    ).get(today);
    const quality = qc && qc.t > 0 ? qc.p / qc.t : 1;

    // Tons today
    const tonsToday = db.prepare(
      `SELECT COALESCE(SUM(i.weight),0)/1000 as tons FROM items i WHERE i.machine=? AND DATE(i.completed_at)=?`
    ).get(m.name, today).tons;

    const oee = Math.round(availability * 1 * quality * 100); // simplified (no performance factor)
    return { ...m, availability: Math.round(availability*100), quality: Math.round(quality*100), oee, pieces_today: pieces, tons_today: tonsToday, downtime_min: stopMins };
  });
  res.json(result);
});

// ── FINANCIAL MARGIN ──────────────────────────────────────────────
app.get('/api/orders/:id/margin', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.price_tier, c.discount_pct FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });

  // Cost of steel: use steel_price_history (latest per diameter) × weight per diameter
  const itemsByDiam = db.prepare(`
    SELECT i.diameter, SUM(i.weight) as total_weight
    FROM items i JOIN pallets p ON i.pallet_id=p.id
    WHERE p.order_id=?
    GROUP BY i.diameter
  `).all(req.params.id);

  let cost_material = 0;
  for (const row of itemsByDiam) {
    const price = db.prepare(`SELECT price_per_ton FROM steel_price_history WHERE diameter=? ORDER BY effective_date DESC LIMIT 1`).get(row.diameter);
    if (price) cost_material += (row.total_weight / 1000) * price.price_per_ton;
  }

  // Fallback: use price_list if no steel price history
  if (cost_material === 0) {
    for (const row of itemsByDiam) {
      const pl = db.prepare('SELECT price_list FROM price_list WHERE diameter=?').get(row.diameter);
      if (pl) cost_material += (row.total_weight) * pl.price_list; // price_list is ₪/kg
    }
  }

  const sale_price = order.sale_price || order.portal_price || 0;
  const cost_labor = order.cost_labor || 0;
  const total_cost = cost_material + cost_labor;
  const gross_profit = sale_price - total_cost;
  const margin_pct = sale_price > 0 ? Math.round(gross_profit / sale_price * 100) : 0;

  res.json({
    order_id: order.id, order_num: order.order_num,
    cost_material: Math.round(cost_material), cost_labor,
    total_cost: Math.round(total_cost), sale_price,
    gross_profit: Math.round(gross_profit), margin_pct
  });
});

// ── INVENTORY FORECAST ────────────────────────────────────────────
app.get('/api/inventory/forecast', (req, res) => {
  // Consumption rate: avg kg/day per diameter over last 30 days
  const consumption = db.prepare(`
    SELECT i.diameter,
           COALESCE(SUM(i.weight),0) / 30 as avg_daily_kg
    FROM items i
    JOIN pallets p ON i.pallet_id=p.id
    JOIN orders o ON p.order_id=o.id
    WHERE DATE(o.created_at) >= DATE('now','-30 days')
    AND i.status='הושלם'
    GROUP BY i.diameter
  `).all();

  const stock = db.prepare(`
    SELECT diameter,
           COALESCE(SUM(weight_received-weight_used-weight_scrapped),0) as on_hand_kg
    FROM raw_material WHERE active=1
    GROUP BY diameter
  `).all();

  const stockMap = {};
  for (const s of stock) stockMap[s.diameter] = s.on_hand_kg;

  const forecast = consumption.map(row => {
    const on_hand = stockMap[row.diameter] || 0;
    const days_left = row.avg_daily_kg > 0 ? Math.floor(on_hand / row.avg_daily_kg) : 999;
    return {
      diameter: row.diameter,
      on_hand_kg: Math.round(on_hand),
      avg_daily_kg: Math.round(row.avg_daily_kg),
      days_left,
      alert: days_left <= 3 ? 'critical' : days_left <= 7 ? 'warning' : 'ok'
    };
  });

  // Also check diameters with stock but no consumption
  for (const [diam, kg] of Object.entries(stockMap)) {
    if (!forecast.find(f => f.diameter == diam)) {
      forecast.push({ diameter: Number(diam), on_hand_kg: Math.round(kg), avg_daily_kg: 0, days_left: 999, alert: 'ok' });
    }
  }
  forecast.sort((a,b) => a.days_left - b.days_left);
  res.json(forecast);
});

// ── TONS PER DAY (dashboard KPI) ─────────────────────────────────
app.get('/api/kpi/tons-today', (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const r = db.prepare(`
    SELECT COALESCE(SUM(i.weight),0)/1000 as tons
    FROM items i
    WHERE i.status='הושלם' AND DATE(i.completed_at)=?
  `).get(today);
  res.json({ tons: Math.round((r.tons || 0) * 10) / 10, date: today });
});

// ── MONTHLY KPI (exec dashboard) ─────────────────────────────────
app.get('/api/kpi/monthly', (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,10);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0,10);

  const cur = db.prepare(`
    SELECT
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(o.total_weight),0) as total_weight_kg,
      COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue,
      COALESCE(SUM(CASE WHEN o.cost_material>0 THEN o.cost_material ELSE 0 END),0) as cost_material,
      COALESCE(SUM(CASE WHEN o.cost_labor>0 THEN o.cost_labor ELSE 0 END),0) as cost_labor,
      SUM(CASE WHEN o.status='הושלם' OR o.status='סופק' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN o.status='בייצור' THEN 1 ELSE 0 END) as in_production,
      SUM(CASE WHEN o.status='ממתינה לאישור' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN o.priority='דחוף' AND o.status NOT IN ('הושלם','סופק') THEN 1 ELSE 0 END) as urgent_open
    FROM orders o
    WHERE DATE(o.created_at) >= ?
  `).get(monthStart);

  const prev = db.prepare(`
    SELECT
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(o.total_weight),0) as total_weight_kg,
      COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue
    FROM orders o
    WHERE DATE(o.created_at) BETWEEN ? AND ?
  `).get(prevMonthStart, prevMonthEnd);

  const topCustomers = db.prepare(`
    SELECT c.name, COUNT(o.id) as orders, COALESCE(SUM(o.total_weight),0) as total_weight_kg,
      COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE DATE(o.created_at) >= ?
    GROUP BY c.id, c.name
    ORDER BY total_weight_kg DESC
    LIMIT 5
  `).all(monthStart);

  const tonsMonth = (cur.total_weight_kg || 0) / 1000;
  const revenue   = cur.revenue || 0;
  const cost      = (cur.cost_material || 0) + (cur.cost_labor || 0);
  const margin    = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;

  res.json({
    month: now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }),
    current: { ...cur, tons: Math.round(tonsMonth * 10) / 10, revenue, cost, margin },
    prev: { ...prev, tons: Math.round((prev.total_weight_kg||0) / 100) / 10 },
    topCustomers
  });
});

// ── SHIFT SUMMARY (production dashboard) ─────────────────────────
app.get('/api/kpi/shift-summary', (req, res) => {
  const today = new Date().toISOString().slice(0,10);
  const now = new Date();
  const h = now.getHours();
  let shiftType = h >= 6 && h < 14 ? 'morning' : h >= 14 && h < 22 ? 'afternoon' : 'night';

  const activeShifts = db.prepare(`
    SELECT s.*, u.display_name as operator_name, m.name as machine_name
    FROM shifts s
    LEFT JOIN users u ON s.operator_id = u.id
    LEFT JOIN machines m ON s.machine_id = m.id
    WHERE s.date = ? AND s.ended_at IS NULL
  `).all(today);

  const itemsInProd = db.prepare(`
    SELECT i.id, i.diameter, i.quantity, i.produced_qty,
      COALESCE(i.total_weight, 0) as weight, i.status, i.machine,
      o.order_num,
      c.name as customer_name,
      COALESCE(m.name, i.machine) as machine_name
    FROM items i
    LEFT JOIN pallets p ON i.pallet_id = p.id
    LEFT JOIN orders o ON p.order_id = o.id
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN machines m ON i.machine_id = m.id
    WHERE i.status IN ('בייצור','ממתין')
    ORDER BY i.started_at DESC
    LIMIT 20
  `).all();

  const todayTons = db.prepare(`
    SELECT COALESCE(SUM(i.total_weight),0)/1000 as tons
    FROM items i WHERE i.status='הושלם' AND DATE(i.completed_at)=?
  `).get(today);

  const stops = db.prepare(`
    SELECT ms.*, dr.label as reason_label, m.name as machine_name
    FROM machine_stops ms
    LEFT JOIN downtime_reasons dr ON ms.reason_code = dr.code
    LEFT JOIN machines m ON ms.machine_id = m.id
    WHERE DATE(ms.started_at) = ? AND ms.ended_at IS NULL
  `).all(today);

  res.json({
    shiftType,
    activeShifts,
    itemsInProd,
    todayTons: Math.round((todayTons.tons || 0) * 10) / 10,
    activeStops: stops
  });
});

ai.init(db);

// ── INCIDENTS (War Room) ───────────────────────────────────────────
app.get('/api/incidents', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, m.name as machine_name
    FROM incidents i
    LEFT JOIN machines m ON i.machine_id = m.id
    ORDER BY
      CASE i.status WHEN 'פתוח' THEN 0 WHEN 'בטיפול' THEN 1 ELSE 2 END,
      i.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/incidents', (req, res) => {
  const { title, machine_id, severity, description, assigned_to, financial_impact, opened_by } = req.body;
  const r = db.prepare(`
    INSERT INTO incidents (title,machine_id,severity,description,assigned_to,financial_impact,opened_by,timeline)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    title, machine_id || null, severity || 'בינוני',
    description || '', assigned_to || '', financial_impact || 0, opened_by || '',
    JSON.stringify([{ ts: new Date().toISOString(), text: 'אירוע נפתח' }])
  );
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/incidents/:id', (req, res) => {
  const { status, update_text, assigned_to, financial_impact } = req.body;
  const inc = db.prepare('SELECT * FROM incidents WHERE id=?').get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'not found' });
  let timeline = JSON.parse(inc.timeline || '[]');
  if (update_text) timeline.push({ ts: new Date().toISOString(), text: update_text });
  db.prepare(`
    UPDATE incidents
    SET status           = COALESCE(?, status),
        assigned_to      = COALESCE(?, assigned_to),
        financial_impact = COALESCE(?, financial_impact),
        timeline         = ?,
        resolved_at      = CASE WHEN ? = 'סגור' THEN CURRENT_TIMESTAMP ELSE resolved_at END
    WHERE id = ?
  `).run(status || null, assigned_to || null, financial_impact ?? null,
         JSON.stringify(timeline), status || '', req.params.id);
  res.json({ ok: true });
});

// ── NCR – Non-Conformance Reports ─────────────────────────────────
app.get('/api/ncr', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, m.name as machine_name
    FROM ncr n
    LEFT JOIN machines m ON n.machine_id = m.id
    ORDER BY n.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/ncr', (req, res) => {
  const seq = db.prepare('SELECT COUNT(*)+1 as n FROM ncr').get().n;
  const num = 'NCR-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
  const { order_id, order_num, machine_id, description, severity, root_cause,
          disposition, quantity_affected, diameter, assigned_to, notes } = req.body;
  const r = db.prepare(`
    INSERT INTO ncr (ncr_num,order_id,order_num,machine_id,description,severity,
                     root_cause,disposition,quantity_affected,diameter,assigned_to,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(num, order_id || null, order_num || '', machine_id || null, description,
         severity || 'בינוני', root_cause || '', disposition || '',
         quantity_affected || 0, diameter || null, assigned_to || '', notes || '');
  res.json({ id: r.lastInsertRowid, ncr_num: num });
});

app.patch('/api/ncr/:id', (req, res) => {
  const f = req.body;
  db.prepare(`
    UPDATE ncr
    SET status      = COALESCE(?, status),
        severity    = COALESCE(?, severity),
        root_cause  = COALESCE(?, root_cause),
        disposition = COALESCE(?, disposition),
        assigned_to = COALESCE(?, assigned_to),
        notes       = COALESCE(?, notes),
        closed_by   = COALESCE(?, closed_by),
        closed_at   = CASE WHEN ? = 'סגור' THEN CURRENT_TIMESTAMP ELSE closed_at END
    WHERE id = ?
  `).run(f.status || null, f.severity || null, f.root_cause || null,
         f.disposition || null, f.assigned_to || null, f.notes || null,
         f.closed_by || null, f.status || '', req.params.id);
  res.json({ ok: true });
});

// ── CAPA – Corrective & Preventive Actions ────────────────────────
app.get('/api/capa', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, n.ncr_num
    FROM capa c
    LEFT JOIN ncr n ON c.ncr_id = n.id
    ORDER BY c.created_at DESC
  `).all());
});

app.post('/api/capa', (req, res) => {
  const seq = db.prepare('SELECT COUNT(*)+1 as n FROM capa').get().n;
  const num = 'CAPA-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
  const { ncr_id, title, type, problem_description, root_cause,
          actions, owner, due_date, verification_method } = req.body;
  const r = db.prepare(`
    INSERT INTO capa (capa_num,ncr_id,title,type,problem_description,root_cause,
                      actions,owner,due_date,verification_method)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(num, ncr_id || null, title, type || 'מתקן',
         problem_description || '', root_cause || '',
         JSON.stringify(actions || []), owner || '', due_date || '', verification_method || '');
  res.json({ id: r.lastInsertRowid, capa_num: num });
});

app.patch('/api/capa/:id', (req, res) => {
  const f = req.body;
  db.prepare(`
    UPDATE capa
    SET status         = COALESCE(?, status),
        completion_pct = COALESCE(?, completion_pct),
        actions        = COALESCE(?, actions),
        owner          = COALESCE(?, owner),
        due_date       = COALESCE(?, due_date)
    WHERE id = ?
  `).run(f.status || null, f.completion_pct ?? null,
         f.actions ? JSON.stringify(f.actions) : null,
         f.owner || null, f.due_date || null, req.params.id);
  res.json({ ok: true });
});

// ── LOTO – Lockout / Tagout ───────────────────────────────────────
app.get('/api/loto', (req, res) => {
  res.json(db.prepare(`
    SELECT l.*, m.name as machine_name
    FROM loto l
    LEFT JOIN machines m ON l.machine_id = m.id
    ORDER BY l.created_at DESC
  `).all());
});

app.post('/api/loto', (req, res) => {
  const { machine_id, locked_by, reason, reason_detail, safety_notes } = req.body;
  const existing = db.prepare("SELECT id FROM loto WHERE machine_id=? AND status='פעיל'").get(machine_id);
  if (existing) return res.status(409).json({ error: 'המכונה כבר נעולה' });
  const r = db.prepare(`
    INSERT INTO loto (machine_id,locked_by,reason,reason_detail,safety_notes)
    VALUES (?,?,?,?,?)
  `).run(machine_id, locked_by, reason || 'תחזוקה', reason_detail || '', safety_notes || '');
  db.prepare("UPDATE machines SET status='נעול LOTO' WHERE id=?").run(machine_id);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/loto/:id/release', (req, res) => {
  const { released_by, release_notes } = req.body;
  const loto = db.prepare('SELECT * FROM loto WHERE id=?').get(req.params.id);
  if (!loto) return res.status(404).json({ error: 'not found' });
  db.prepare(`
    UPDATE loto
    SET status='שוחרר', released_by=?, release_notes=?,
        release_confirmed=1, released_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(released_by || '', release_notes || '', req.params.id);
  db.prepare("UPDATE machines SET status='לא מחובר' WHERE id=?").run(loto.machine_id);
  res.json({ ok: true });
});

// ── PREVENTIVE MAINTENANCE SCHEDULE ──────────────────────────────
app.get('/api/pm-schedule', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, m.name as machine_name
    FROM pm_schedule p
    LEFT JOIN machines m ON p.machine_id = m.id
    WHERE p.active = 1
    ORDER BY p.next_due ASC
  `).all());
});

app.post('/api/pm-schedule', (req, res) => {
  const { machine_id, pm_type, frequency, last_done, next_due, instructions } = req.body;
  db.prepare(`
    INSERT OR REPLACE INTO pm_schedule (machine_id,pm_type,frequency,last_done,next_due,instructions)
    VALUES (?,?,?,?,?,?)
  `).run(machine_id, pm_type, frequency || 'חודשי', last_done || null, next_due || null, instructions || '');
  res.json({ ok: true });
});

// ── PURCHASE ORDERS ───────────────────────────────────────────────
app.get('/api/purchase-orders', (req, res) => {
  res.json(db.prepare(`
    SELECT po.*, s.name as supplier_name
    FROM purchase_orders po
    LEFT JOIN suppliers s ON po.supplier_id = s.id
    ORDER BY po.created_at DESC
  `).all());
});

app.post('/api/purchase-orders', (req, res) => {
  const seq = db.prepare('SELECT COUNT(*)+1 as n FROM purchase_orders').get().n;
  const num = 'PO-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
  const { supplier_id, diameter, material_type, quantity_ton,
          price_per_ton, expected_date, notes, created_by } = req.body;
  const total = (quantity_ton || 0) * (price_per_ton || 0);
  const r = db.prepare(`
    INSERT INTO purchase_orders
      (po_num,supplier_id,diameter,material_type,quantity_ton,price_per_ton,total_amount,expected_date,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(num, supplier_id || null, diameter || null, material_type || 'coil',
         quantity_ton || 0, price_per_ton || 0, total,
         expected_date || '', notes || '', created_by || '');
  res.json({ id: r.lastInsertRowid, po_num: num });
});

app.patch('/api/purchase-orders/:id', (req, res) => {
  const f = req.body;
  db.prepare(`
    UPDATE purchase_orders
    SET status      = COALESCE(?, status),
        approved_by = COALESCE(?, approved_by)
    WHERE id = ?
  `).run(f.status || null, f.approved_by || null, req.params.id);
  res.json({ ok: true });
});

app.patch('/api/purchase-orders/:id/receive', (req, res) => {
  const { heat_number, certificate_num, received_weight, notes } = req.body;
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'not found' });
  const actualWeight = received_weight || (po.quantity_ton * 1000);
  db.prepare(`
    UPDATE purchase_orders
    SET status='הגיע', heat_number=?, certificate_num=?, received_weight=?, received_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(heat_number || '', certificate_num || '', actualWeight, req.params.id);
  // Also push to raw material inventory
  if (po.supplier_id && po.diameter) {
    db.prepare(`
      INSERT INTO raw_material
        (material_type,diameter,supplier_id,lot_number,certificate_num,received_date,weight_received,purchase_price,notes)
      VALUES (?,?,?,?,?,date('now'),?,?,?)
    `).run(po.material_type || 'coil', po.diameter, po.supplier_id,
           heat_number || '', certificate_num || '',
           actualWeight, po.price_per_ton || 0, notes || '');
  }
  res.json({ ok: true });
});

// ── GLOBAL SEARCH (כרך ט) ────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const results = [];

  // Orders
  const orders = db.prepare(`
    SELECT 'order' as type, o.id, o.order_num as ref, c.name as label,
           o.status, o.created_at as ts
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
    WHERE o.order_num LIKE ? OR c.name LIKE ? OR o.delivery_address LIKE ?
    LIMIT 5
  `).all(like, like, like);
  results.push(...orders.map(r => ({ ...r, url: `/orders.html?id=${r.id}`, icon: '📋' })));

  // Customers
  const customers = db.prepare(`
    SELECT 'customer' as type, c.id, c.name as ref, c.phone as label, c.created_at as ts
    FROM customers c WHERE c.name LIKE ? OR c.phone LIKE ? OR c.priority_id LIKE ?
    LIMIT 5
  `).all(like, like, like);
  results.push(...customers.map(r => ({ ...r, url: `/admin.html?tab=customers&id=${r.id}`, icon: '👤' })));

  // Packages
  const packages = db.prepare(`
    SELECT 'package' as type, id, package_code as ref, order_num as label, status, packed_at as ts
    FROM packages WHERE package_code LIKE ? OR order_num LIKE ? OR zone LIKE ?
    LIMIT 4
  `).all(like, like, like);
  results.push(...packages.map(r => ({ ...r, url: `/warehouse.html?pkg=${r.id}`, icon: '📦' })));

  // Raw material / inventory
  const rawmat = db.prepare(`
    SELECT 'inventory' as type, id, lot_number as ref, diameter||'mm ' ||material_type as label, created_at as ts
    FROM raw_material WHERE lot_number LIKE ? OR certificate_num LIKE ? OR notes LIKE ?
    LIMIT 4
  `).all(like, like, like);
  results.push(...rawmat.map(r => ({ ...r, url: `/inventory.html`, icon: '🗄️' })));

  // Incidents
  const incidents = db.prepare(`
    SELECT 'incident' as type, id, title as ref, status as label, created_at as ts
    FROM incidents WHERE title LIKE ? OR description LIKE ?
    LIMIT 3
  `).all(like, like);
  results.push(...incidents.map(r => ({ ...r, url: `/warroom.html`, icon: '🚨' })));

  // Sort by relevance: exact match first, then by date
  results.sort((a, b) => {
    const aExact = a.ref?.toLowerCase() === q.toLowerCase() ? 1 : 0;
    const bExact = b.ref?.toLowerCase() === q.toLowerCase() ? 1 : 0;
    return bExact - aExact;
  });

  res.json({ results: results.slice(0, 15), query: q });
});

// ── INVOICES (כרך ט) ─────────────────────────────────────────────
app.get('/api/invoices', (req, res) => {
  const { customer_id, status, order_id } = req.query;
  const wheres = [], params = [];
  if (customer_id) { wheres.push('i.customer_id=?'); params.push(customer_id); }
  if (status)      { wheres.push('i.status=?');       params.push(status); }
  if (order_id)    { wheres.push('i.order_id=?');     params.push(order_id); }
  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  const rows = db.prepare(`SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id ${where} ORDER BY i.created_at DESC LIMIT 100`).all(...params);
  res.json(rows);
});

app.post('/api/invoices', (req, res) => {
  const { order_id, customer_id, items_json, subtotal, vat_rate, notes, invoice_type, created_by } = req.body;
  const year = new Date().getFullYear();
  const seq = db.prepare("SELECT COUNT(*)+1 as n FROM invoices WHERE invoice_num LIKE ?").get(`INV-${year}-%`).n;
  const invoice_num = `INV-${year}-${String(seq).padStart(5,'0')}`;
  const vat = vat_rate ?? 0.18;
  const sub = subtotal || 0;
  const vatAmount = sub * vat;
  const total = sub + vatAmount;
  const order = order_id ? db.prepare('SELECT order_num,customer_id FROM orders WHERE id=?').get(order_id) : null;
  const cust = (customer_id || order?.customer_id) ? db.prepare('SELECT name,vat_id FROM customers WHERE id=?').get(customer_id || order?.customer_id) : null;
  const r = db.prepare(`INSERT INTO invoices (invoice_num,invoice_type,order_id,order_num,customer_id,customer_name,customer_vat_id,issue_date,items_json,subtotal,vat_rate,vat_amount,total,notes,created_by)
    VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?)`)
    .run(invoice_num, invoice_type||'tax_invoice', order_id||null, order?.order_num||null,
      customer_id||order?.customer_id||null, cust?.name||null, cust?.vat_id||null,
      JSON.stringify(items_json||[]), sub, vat, vatAmount, total, notes||null, created_by||null);
  wsBroadcast('new_invoice', { id: r.lastInsertRowid, invoice_num, total });
  res.json({ id: r.lastInsertRowid, invoice_num, total });
});

app.patch('/api/invoices/:id/pay', (req, res) => {
  const { paid_amount, payment_method, payment_ref } = req.body;
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  const newPaid = (inv.paid_amount || 0) + (paid_amount || 0);
  const status = newPaid >= inv.total ? 'שולמה' : 'חלקית';
  db.prepare('UPDATE invoices SET paid_amount=?,status=?,payment_method=COALESCE(?,payment_method),payment_ref=COALESCE(?,payment_ref) WHERE id=?')
    .run(newPaid, status, payment_method||null, payment_ref||null, req.params.id);
  res.json({ ok: true, status, paid_amount: newPaid });
});

app.patch('/api/invoices/:id/cancel', (req, res) => {
  db.prepare("UPDATE invoices SET status='ביטול' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── CSV EXPORT (כרך ט) ────────────────────────────────────────────
function toCSV(rows, cols) {
  const header = cols.map(c => c.label).join(',');
  const lines = rows.map(r => cols.map(c => {
    const v = r[c.key] ?? '';
    const s = String(v).replace(/"/g, '""');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
  }).join(','));
  return '﻿' + [header, ...lines].join('\r\n'); // BOM for Hebrew Excel
}

app.get('/api/export/orders', (req, res) => {
  const rows = db.prepare(`
    SELECT o.order_num, c.name as customer, o.delivery_date, o.status, o.total_weight,
           o.priority, o.channel, o.created_at
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
    ORDER BY o.created_at DESC LIMIT 5000
  `).all();
  const cols = [
    { key:'order_num',    label:'מספר הזמנה' },
    { key:'customer',     label:'לקוח' },
    { key:'delivery_date',label:'תאריך אספקה' },
    { key:'status',       label:'סטטוס' },
    { key:'total_weight', label:'משקל (ק"ג)' },
    { key:'priority',     label:'עדיפות' },
    { key:'channel',      label:'ערוץ' },
    { key:'created_at',   label:'נוצרה' },
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
  res.send(toCSV(rows, cols));
});

app.get('/api/export/packages', (req, res) => {
  const rows = db.prepare(`
    SELECT pk.package_code, pk.order_num, pk.status, pk.weight, pk.diameter, pk.zone, pk.packed_at, pk.shipped_at
    FROM packages pk ORDER BY pk.packed_at DESC LIMIT 5000
  `).all();
  const cols = [
    { key:'package_code', label:'קוד חבילה' },
    { key:'order_num',    label:'מספר הזמנה' },
    { key:'status',       label:'סטטוס' },
    { key:'weight',       label:'משקל (ק"ג)' },
    { key:'diameter',     label:'קוטר' },
    { key:'zone',         label:'אזור מחסן' },
    { key:'packed_at',    label:'תאריך אריזה' },
    { key:'shipped_at',   label:'תאריך משלוח' },
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="packages.csv"');
  res.send(toCSV(rows, cols));
});

app.get('/api/export/inventory', (req, res) => {
  const rows = db.prepare(`
    SELECT r.material_type, r.diameter, s.name as supplier, r.lot_number, r.certificate_num,
           r.grade, r.received_date, r.weight_received, r.weight_used, r.warehouse_loc
    FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id
    ORDER BY r.received_date DESC LIMIT 5000
  `).all();
  const cols = [
    { key:'material_type',   label:'סוג חומר' },
    { key:'diameter',        label:'קוטר (mm)' },
    { key:'supplier',        label:'ספק' },
    { key:'lot_number',      label:'מספר אצווה' },
    { key:'certificate_num', label:'תעודת חומר' },
    { key:'grade',           label:'איכות פלדה' },
    { key:'received_date',   label:'תאריך קבלה' },
    { key:'weight_received', label:'משקל שהתקבל (ק"ג)' },
    { key:'weight_used',     label:'משקל שנצרך (ק"ג)' },
    { key:'warehouse_loc',   label:'מיקום במחסן' },
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
  res.send(toCSV(rows, cols));
});

// ── BVBS PARSER ──────────────────────────────────────────────────
function parseBVBSLine(line) {
  line = line.trim();
  if (!line.startsWith('@3') && !line.startsWith('@')) return null;
  const item = {};
  // Split on ^ delimiter
  const parts = line.split('^');
  for (const part of parts) {
    if (!part || part === '!' || part.startsWith('@')) continue;
    const m = part.match(/^([a-zA-Z]+)(.+)$/);
    if (!m) {
      // geometry block [A 500 B 1800 ...]
      const geoM = part.match(/\[([^\]]+)\]/);
      if (geoM) {
        const legs = [];
        const tokens = geoM[1].trim().split(/\s+/);
        for (let i = 0; i < tokens.length - 1; i += 2) {
          const label = tokens[i];
          const len = parseFloat(tokens[i + 1]);
          if (!isNaN(len)) legs.push({ label, length: len });
        }
        item.legs = legs;
        item.sides = legs.map(l => l.length);
      }
      continue;
    }
    const [, key, val] = m;
    switch (key.toLowerCase()) {
      case 'd':  item.diameter    = parseFloat(val); break;
      case 'l':  item.total_length= parseFloat(val); break;
      case 'n':  item.mark        = val; break;
      case 'p':  item.quantity    = parseInt(val, 10) || 1; break;
      case 'a':  item.shape_code  = val; break;
      case 'r':  item.grade_code  = val; item.grade = val === '1' ? 'B500B' : val === '2' ? 'B500C' : 'B500B'; break;
      case 'w':  {
        if (!item.angles) item.angles = [];
        item.angles.push(parseFloat(val));
        break;
      }
    }
  }
  if (!item.diameter || !item.quantity) return null;
  // Compute weight
  const WEIGHTS = { 6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86 };
  const kgPerM = WEIGHTS[item.diameter] ?? (item.diameter * item.diameter * 0.00617);
  item.weight_per_unit = (item.total_length / 1000) * kgPerM;
  item.total_weight = item.weight_per_unit * item.quantity;
  return item;
}

function parseBVBS(content) {
  const lines = content.split(/\r?\n/);
  const items = [];
  let header = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('@1') || t.startsWith('@2')) {
      // Header record — extract project/order info
      const parts = t.split('^');
      for (const p of parts) {
        const m = p.match(/^([A-Za-z]+)(.+)$/);
        if (!m) continue;
        if (m[1].toLowerCase() === 'bs') header.project = m[2];
        if (m[1].toLowerCase() === 'kd') header.customer = m[2];
        if (m[1].toLowerCase() === 'da') header.date = m[2];
      }
      continue;
    }
    const item = parseBVBSLine(t);
    if (item) items.push(item);
  }
  return { header, items, total_weight: items.reduce((s, i) => s + i.total_weight, 0) };
}

app.post('/api/bvbs/parse', upload.single('file'), (req, res) => {
  try {
    const content = req.file
      ? req.file.buffer.toString('utf-8')
      : (req.body.content || '');
    if (!content.trim()) return res.status(400).json({ error: 'Empty BVBS content' });
    const result = parseBVBS(content);
    if (!result.items.length) return res.status(422).json({ error: 'לא נמצאו פריטים בקובץ BVBS', raw_lines: content.split('\n').slice(0,5) });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert parsed BVBS data to an IronBend order
app.post('/api/bvbs/create-order', (req, res) => {
  const { bvbs_result, customer_id, delivery_date, priority } = req.body;
  if (!bvbs_result?.items?.length) return res.status(400).json({ error: 'No items' });
  const orderNum = generateOrderNum();
  const totalWeight = bvbs_result.total_weight || 0;
  const orderId = db.prepare(`INSERT INTO orders (order_num,customer_id,channel,delivery_date,priority,status,total_weight,general_notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(orderNum, customer_id || null, 'BVBS',
    delivery_date || null, priority || 'רגיל', 'ממתינה לאישור',
    totalWeight, `יובא מקובץ BVBS${bvbs_result.header?.project ? ' – פרויקט: ' + bvbs_result.header.project : ''}`
  ).lastInsertRowid;

  // Create one pallet
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,1,?)')
    .run(orderId, totalWeight).lastInsertRowid;

  // Insert items
  const insertItem = db.prepare(`INSERT INTO items (pallet_id,shape_id,diameter,total_length_mm,quantity,weight_per_unit,total_weight,note,status)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const item of bvbs_result.items) {
    const shapeId = item.shape_code ? 's12' : 's1'; // default to custom or straight
    insertItem.run(palletId, shapeId, item.diameter, item.total_length || 0, item.quantity,
      item.weight_per_unit || 0, item.total_weight || 0, `מסימן ${item.mark || ''} | ${item.grade || 'B500B'}`, 'ממתין');
  }

  wsBroadcast('new_order', { orderId, orderNum });
  res.json({ ok: true, order_id: orderId, order_num: orderNum, items_created: bvbs_result.items.length });
});

// ════════════════════════════════════════════════════════════════
// ── כרך יב – INDUSTRIAL ECONOMICS & FINANCIAL INTELLIGENCE ──────
// ════════════════════════════════════════════════════════════════

// Schema additions for financial engine
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_costs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL REFERENCES orders(id),
      material_cost   REAL DEFAULT 0,
      labor_cost      REAL DEFAULT 0,
      machine_cost    REAL DEFAULT 0,
      scrap_cost      REAL DEFAULT 0,
      overhead_cost   REAL DEFAULT 0,
      total_cost      REAL DEFAULT 0,
      revenue         REAL DEFAULT 0,
      gross_margin    REAL DEFAULT 0,
      margin_pct      REAL DEFAULT 0,
      tons_delivered  REAL DEFAULT 0,
      cost_per_ton    REAL DEFAULT 0,
      confidence      TEXT DEFAULT 'medium',
      locked          INTEGER DEFAULT 0,
      locked_by       TEXT,
      locked_at       TEXT,
      notes           TEXT DEFAULT '',
      updated_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(order_id)
    );

    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    INTEGER NOT NULL REFERENCES orders(id),
      snapshot    TEXT NOT NULL,
      reason      TEXT DEFAULT '',
      created_by  TEXT DEFAULT 'system',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_credit (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id     INTEGER NOT NULL REFERENCES customers(id) UNIQUE,
      credit_limit    REAL DEFAULT 0,
      payment_terms   INTEGER DEFAULT 30,
      open_debt       REAL DEFAULT 0,
      wip_value       REAL DEFAULT 0,
      total_exposure  REAL DEFAULT 0,
      credit_status   TEXT DEFAULT 'active',
      last_payment_date TEXT,
      notes           TEXT DEFAULT '',
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,
      entity_type TEXT,
      entity_id   INTEGER,
      amount      REAL DEFAULT 0,
      description TEXT DEFAULT '',
      created_by  TEXT DEFAULT 'system',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS steel_prices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      diameter    INTEGER,
      grade       TEXT DEFAULT 'B500B',
      price_per_ton REAL NOT NULL,
      effective_date TEXT DEFAULT (date('now')),
      source      TEXT DEFAULT 'manual',
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
} catch(e) { console.warn('כרך יב schema warn:', e.message); }

// ── REBAR WEIGHT TABLE (kg/m) ──────────────────────────────────
const REBAR_KG_PER_M = {
  5:0.154, 6:0.222, 8:0.395, 10:0.617, 12:0.888, 14:1.208,
  16:1.578, 18:1.998, 20:2.466, 22:2.98, 24:3.55, 25:3.85,
  26:4.17, 28:4.83, 30:5.55, 32:6.31, 34:7.13, 36:7.99,
  38:8.9, 40:9.86, 45:12.48, 50:15.41
};

// ── COST ENGINE ────────────────────────────────────────────────
function calculateOrderCost(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) return null;

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(orderId);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id); });
  const allItems = pallets.flatMap(p => p.items);

  // Get latest steel price (use existing steel_price_history table, or steel_prices if available)
  let steelPrice = db.prepare(
    'SELECT price_per_ton FROM steel_price_history ORDER BY effective_date DESC, id DESC LIMIT 1'
  ).get();
  if (!steelPrice) steelPrice = db.prepare(
    'SELECT price_per_ton FROM steel_prices ORDER BY effective_date DESC, id DESC LIMIT 1'
  ).get();
  const pricePerTon = steelPrice ? steelPrice.price_per_ton : 3800; // default ILS/ton

  // Total weight: prefer order.total_weight (most accurate), then sum items, then calculate from diameter+length
  let totalWeightKg = order.total_weight || 0;
  if (totalWeightKg === 0) {
    // Try summing items
    totalWeightKg = allItems.reduce((s, it) => {
      if (it.total_weight && it.total_weight > 0) return s + it.total_weight;
      // Calculate from diameter + length
      const kgPerM = REBAR_KG_PER_M[it.diameter] || 0;
      const lengthM = (it.total_length_mm || 0) / 1000;
      return s + (kgPerM * lengthM * (it.quantity || 1));
    }, 0);
  }
  const material_cost = (totalWeightKg / 1000) * pricePerTon;

  // Labor cost: approximate based on weight + complexity
  const avgBends = allItems.reduce((s, it) => {
    const segs = (() => { try { return JSON.parse(it.segments || '[]'); } catch(e) { return []; } })();
    return s + Math.max(0, segs.length - 1);
  }, 0) / Math.max(1, allItems.length);
  const laborRatePerTon = 120 + (avgBends * 40); // ILS
  const labor_cost = (totalWeightKg / 1000) * laborRatePerTon;

  // Machine cost: based on weight (approx ILS 80/ton)
  const machine_cost = (totalWeightKg / 1000) * 80;

  // Scrap cost: ~3% of material
  const scrap_cost = material_cost * 0.03;

  // Overhead: 15% of direct costs
  const directCosts = material_cost + labor_cost + machine_cost + scrap_cost;
  const overhead_cost = directCosts * 0.15;
  const total_cost = directCosts + overhead_cost;

  // Revenue from order (portal_price is the customer-facing price in ILS)
  const revenue = order.portal_price || 0;

  const gross_margin = revenue - total_cost;
  const margin_pct   = revenue > 0 ? (gross_margin / revenue) * 100 : 0;
  const tons_delivered = totalWeightKg / 1000;
  const cost_per_ton   = tons_delivered > 0 ? total_cost / tons_delivered : 0;

  // Confidence: low if missing prices, high if verified
  const confidence = steelPrice ? 'high' : 'low';

  return {
    order_id: orderId, material_cost, labor_cost, machine_cost,
    scrap_cost, overhead_cost, total_cost, revenue,
    gross_margin, margin_pct, tons_delivered, cost_per_ton, confidence
  };
}

// GET /api/orders/:id/costs
app.get('/api/orders/:id/costs', (req, res) => {
  const orderId = Number(req.params.id);
  let existing = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  if (!existing) {
    const calc = calculateOrderCost(orderId);
    if (!calc) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    db.prepare(`INSERT OR REPLACE INTO order_costs
      (order_id,material_cost,labor_cost,machine_cost,scrap_cost,overhead_cost,
       total_cost,revenue,gross_margin,margin_pct,tons_delivered,cost_per_ton,confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(calc.order_id, calc.material_cost, calc.labor_cost, calc.machine_cost,
           calc.scrap_cost, calc.overhead_cost, calc.total_cost, calc.revenue,
           calc.gross_margin, calc.margin_pct, calc.tons_delivered, calc.cost_per_ton, calc.confidence);
    existing = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  }
  res.json(existing);
});

// POST /api/orders/:id/costs/recalculate
app.post('/api/orders/:id/costs/recalculate', (req, res) => {
  const orderId = Number(req.params.id);
  const locked = db.prepare('SELECT locked FROM order_costs WHERE order_id=?').get(orderId);
  if (locked && locked.locked) return res.status(403).json({ error: 'עלויות נעולות – נדרש מנהל לביטול הנעילה' });

  const calc = calculateOrderCost(orderId);
  if (!calc) return res.status(404).json({ error: 'הזמנה לא נמצאה' });

  // Snapshot before overwrite
  const prev = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  if (prev) {
    db.prepare('INSERT INTO cost_snapshots (order_id,snapshot,reason,created_by) VALUES (?,?,?,?)')
      .run(orderId, JSON.stringify(prev), req.body.reason || 'חישוב מחדש', req.headers['x-user'] || 'system');
  }

  db.prepare(`INSERT OR REPLACE INTO order_costs
    (order_id,material_cost,labor_cost,machine_cost,scrap_cost,overhead_cost,
     total_cost,revenue,gross_margin,margin_pct,tons_delivered,cost_per_ton,confidence,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(calc.order_id, calc.material_cost, calc.labor_cost, calc.machine_cost,
         calc.scrap_cost, calc.overhead_cost, calc.total_cost, calc.revenue,
         calc.gross_margin, calc.margin_pct, calc.tons_delivered, calc.cost_per_ton, calc.confidence);

  wsBroadcast('cost_update', { orderId, margin_pct: calc.margin_pct, gross_margin: calc.gross_margin });
  res.json({ ...calc, recalculated: true });
});

// PATCH /api/orders/:id/costs/lock
app.patch('/api/orders/:id/costs/lock', requireRole('manager'), (req, res) => {
  const { lock, reason } = req.body;
  const user = req.headers['x-user'] || 'מנהל';
  db.prepare(`UPDATE order_costs SET locked=?,locked_by=?,locked_at=datetime('now'),notes=? WHERE order_id=?`)
    .run(lock ? 1 : 0, lock ? user : null, reason || '', req.params.id);
  db.prepare('INSERT INTO financial_events (event_type,entity_type,entity_id,description,created_by) VALUES (?,?,?,?,?)')
    .run(lock ? 'cost_locked' : 'cost_unlocked', 'order', Number(req.params.id), reason || '', user);
  res.json({ success: true, locked: !!lock });
});

// GET /api/orders/:id/costs/snapshots
app.get('/api/orders/:id/costs/snapshots', (req, res) => {
  const snaps = db.prepare('SELECT * FROM cost_snapshots WHERE order_id=? ORDER BY created_at DESC LIMIT 20')
    .all(req.params.id);
  res.json(snaps.map(s => ({ ...s, snapshot: JSON.parse(s.snapshot) })));
});

// ── CUSTOMER LEDGER ────────────────────────────────────────────

// GET /api/customers/:id/ledger
app.get('/api/customers/:id/ledger', (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });

  // All orders for this customer
  const orders = db.prepare(`
    SELECT o.*, oc.total_cost, oc.revenue, oc.gross_margin, oc.margin_pct, oc.tons_delivered
    FROM orders o
    LEFT JOIN order_costs oc ON o.id=oc.order_id
    WHERE o.customer_id=?
    ORDER BY o.created_at DESC
  `).all(customerId);

  // Credit info
  let credit = db.prepare('SELECT * FROM customer_credit WHERE customer_id=?').get(customerId);
  if (!credit) {
    // auto-create default
    db.prepare('INSERT OR IGNORE INTO customer_credit (customer_id,credit_limit,payment_terms) VALUES (?,?,?)')
      .run(customerId, 100000, 30);
    credit = db.prepare('SELECT * FROM customer_credit WHERE customer_id=?').get(customerId);
  }

  // Calculate open debt from unpaid invoices
  const openInvoices = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total
    FROM invoices WHERE customer_id=? AND status NOT IN ('שולמה','ביטול')
  `).get(customerId);
  const open_debt = openInvoices ? openInvoices.total : 0;

  // WIP value (orders in production)
  const wipOrders = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(oc.total_cost),0) as val
    FROM orders o LEFT JOIN order_costs oc ON o.id=oc.order_id
    WHERE o.customer_id=? AND o.status IN ('בייצור','ממתין','מאושר')
  `).get(customerId);
  const wip_value = wipOrders ? wipOrders.val : 0;

  // Totals
  const totalRevenue  = orders.reduce((s, o) => s + (o.revenue || 0), 0);
  const totalCost     = orders.reduce((s, o) => s + (o.total_cost || 0), 0);
  const totalMargin   = totalRevenue - totalCost;
  const avgMarginPct  = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;
  const totalTons     = orders.reduce((s, o) => s + (o.tons_delivered || 0), 0);

  // Update credit record
  db.prepare(`UPDATE customer_credit SET open_debt=?,wip_value=?,total_exposure=?,updated_at=datetime('now') WHERE customer_id=?`)
    .run(open_debt, wip_value, open_debt + wip_value, customerId);

  const total_exposure = open_debt + wip_value;
  const credit_available = Math.max(0, (credit.credit_limit || 0) - total_exposure);
  const credit_pct = credit.credit_limit > 0 ? (total_exposure / credit.credit_limit) * 100 : 0;
  const credit_alert = credit_pct >= 90 ? 'critical' : credit_pct >= 70 ? 'warning' : 'ok';

  res.json({
    customer,
    credit: { ...credit, open_debt, wip_value, total_exposure, credit_available, credit_pct, credit_alert },
    summary: { total_orders: orders.length, totalRevenue, totalCost, totalMargin, avgMarginPct, totalTons },
    orders
  });
});

// PATCH /api/customers/:id/credit
app.patch('/api/customers/:id/credit', requireRole('manager'), (req, res) => {
  const { credit_limit, payment_terms, notes } = req.body;
  db.prepare(`INSERT OR REPLACE INTO customer_credit (customer_id,credit_limit,payment_terms,notes,updated_at)
    VALUES (?,?,?,?,datetime('now'))`).run(req.params.id, credit_limit, payment_terms || 30, notes || '');
  res.json({ success: true });
});

// ── STEEL PRICES (use existing steel_price_history endpoint) ──
// Note: POST /api/steel-prices is handled by existing endpoint at line ~3059

// ── FINANCIAL DASHBOARD KPIs ──────────────────────────────────

app.get('/api/finance/kpis', (req, res) => {
  const { period } = req.query; // 'week', 'month', 'quarter'
  const daysBack = period === 'quarter' ? 90 : period === 'week' ? 7 : 30;
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0,10);

  // Revenue & margin
  const costSummary = db.prepare(`
    SELECT
      COALESCE(SUM(oc.revenue),0)       as total_revenue,
      COALESCE(SUM(oc.total_cost),0)    as total_cost,
      COALESCE(SUM(oc.gross_margin),0)  as total_margin,
      COALESCE(SUM(oc.tons_delivered),0) as total_tons,
      COUNT(*)                           as order_count,
      COALESCE(AVG(oc.margin_pct),0)    as avg_margin_pct
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    WHERE o.created_at >= ?
  `).get(since);

  // Unpaid invoices
  const unpaid = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as cnt
    FROM invoices WHERE status NOT IN ('שולמה','ביטול')
  `).get();

  // Overdue
  const overdue = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as cnt
    FROM invoices WHERE status NOT IN ('שולמה','ביטול') AND due_date < date('now')
  `).get();

  // Top 5 customers by revenue
  const topCustomers = db.prepare(`
    SELECT c.name, COALESCE(SUM(oc.revenue),0) as revenue,
           COALESCE(SUM(oc.gross_margin),0) as margin,
           COALESCE(AVG(oc.margin_pct),0) as margin_pct
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    JOIN customers c ON c.id=o.customer_id
    WHERE o.created_at >= ?
    GROUP BY c.id ORDER BY revenue DESC LIMIT 5
  `).all(since);

  // Latest steel price
  const latestPrice = db.prepare('SELECT price_per_ton, effective_date FROM steel_price_history ORDER BY effective_date DESC, id DESC LIMIT 1').get();

  // Orders with margin < 5% (warning)
  const lowMargin = db.prepare(`
    SELECT o.order_num, c.name as customer, oc.margin_pct, oc.gross_margin
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    JOIN customers c ON c.id=o.customer_id
    WHERE oc.revenue > 0 AND oc.margin_pct < 5 AND o.status NOT IN ('בוטל','הושלם')
    ORDER BY oc.margin_pct ASC LIMIT 10
  `).all();

  res.json({
    period: { days: daysBack, since },
    summary: costSummary,
    receivables: { unpaid: unpaid?.total || 0, unpaid_count: unpaid?.cnt || 0,
                   overdue: overdue?.total || 0, overdue_count: overdue?.cnt || 0 },
    steel_price: latestPrice,
    top_customers: topCustomers,
    low_margin_orders: lowMargin
  });
});

// ── FINANCIAL EVENTS LOG ──────────────────────────────────────

app.get('/api/finance/events', (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const events = db.prepare('SELECT * FROM financial_events ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(Number(limit), Number(offset));
  res.json(events);
});

// ── Admin Database Migration (Cloud Upload/Download) ──────────────
// Download active database backup
app.get('/api/admin/database/download', (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return res.status(404).json({ ok: false, error: 'קובץ בסיס הנתונים לא נמצא' });
    }
    res.download(DB_PATH, 'ironbend.db');
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload and restore database backup
app.post('/api/admin/database/upload', upload.single('dbFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'לא הועלה קובץ' });
    }

    console.log('[Database Migration] מתחיל תהליך שחזור בסיס נתונים מהעלאה...');

    // 1. Close current connection safely
    try {
      db.close();
      console.log('[Database Migration] 💾 חיבור בסיס הנתונים הישן נסגר בבטחה');
    } catch (err) {
      console.warn('[Database Migration] שגיאה בסגירת בסיס הנתונים:', err.message);
    }

    // 2. Backup old database file just in case
    if (fs.existsSync(DB_PATH)) {
      const backupPath = `${DB_PATH}.bak`;
      fs.copyFileSync(DB_PATH, backupPath);
      console.log(`[Database Migration] 📂 גובה קובץ ישן ל-${backupPath}`);
    }

    // 3. Write new uploaded file
    fs.writeFileSync(DB_PATH, req.file.buffer);
    console.log(`[Database Migration] 📝 נכתב קובץ בסיס נתונים חדש ל-${DB_PATH}`);

    // 4. Reopen connection
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // 5. Reinitialize submodules
    modbus.init(db);
    ai.init(db);
    console.log('[Database Migration] 🚀 בסיס הנתונים החדש נטען ואותחל בהצלחה!');

    res.json({ ok: true, message: 'בסיס הנתונים שוחזר בהצלחה והשרת אותחל מחדש!' });
  } catch (e) {
    console.error('[Database Migration] ❌ שגיאה בשחזור:', e);
    
    // In case of crash, try to reopen whatever is at DB_PATH to stay online
    try {
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      modbus.init(db);
      ai.init(db);
    } catch (_) {}

    res.status(500).json({ ok: false, error: `שגיאה בשחזור בסיס הנתונים: ${e.message}` });
  }
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM orders').get();
    res.json({ ok: true, orders: row.cnt, ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Auto-backup SQLite ────────────────────────────────────────────
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const fs         = require('fs');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

cron.schedule('0 2 * * *', () => {        // כל לילה 02:00
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest  = `${BACKUP_DIR}/ironbend-${stamp}.db`;
    if (!fs.existsSync(dest)) {
      db.backup(dest)                      // better-sqlite3 hot-backup (safe under WAL)
        .then(() => {
          console.log(`[Backup] ✅ גובה ל-${dest}`);
          // שמור 30 ימים אחרונים בלבד
          const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db'))
            .sort();
          if (files.length > 30)
            fs.unlinkSync(`${BACKUP_DIR}/${files[0]}`);
        })
        .catch(err => console.error('[Backup] ❌', err.message));
    }
  } catch (err) { console.error('[Backup] ❌', err.message); }
});

// ── Graceful shutdown ────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] קיבלתי ${signal} – סוגר בעדינות...`);
  server.close(() => {
    try { db.close(); } catch (_) {}
    console.log('[Shutdown] ✅ השרת נסגר בבטחה');
    process.exit(0);
  });
  setTimeout(() => { console.error('[Shutdown] ⏱ timeout – יוצא'); process.exit(1); }, 8000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Start ────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  // הצג IP מקומי כדי שעמדות אחרות ידעו לאן להתחבר
  const nets = require('os').networkInterfaces();
  const localIP = Object.values(nets).flat()
    .find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';

  console.log(`\n✅  IronBend Server – טנא תעשיות ברזל בע"מ`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`🖥️  מחשב זה:    http://localhost:${PORT}`);
  console.log(`🌐  רשת מקומית: http://${localIP}:${PORT}`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`📊  Dashboard: http://${localIP}:${PORT}/dashboard.html`);
  console.log(`📋  Orders:    http://${localIP}:${PORT}/orders.html`);
  console.log(`🔧  Machine:   http://${localIP}:${PORT}/machine.html`);
  console.log(`🚚  Driver:    http://${localIP}:${PORT}/driver.html`);
  console.log(`📈  Reports:   http://${localIP}:${PORT}/reports.html`);
  console.log(`💰  Finance:   http://${localIP}:${PORT}/finance.html`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`💾  DB:        ${DB_PATH}`);
  console.log(`🗂️  Backups:   ${BACKUP_DIR}  (יומי 02:00)\n`);
});
