'use strict';

const { ensureCoreSchema } = require('./coreSchema');
const { seedCoreData } = require('./seed');
const { ensureVehicleCompatibility } = require('./vehicleMigrations');

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

  ensureVehicleCompatibility(db);
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

module.exports = {
  ensureCoreSchema,
  runCoreMigrations,
  seedCoreData,
};
