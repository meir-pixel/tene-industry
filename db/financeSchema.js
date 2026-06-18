'use strict';

function ensureFinanceSchema(db) {
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

    CREATE TABLE IF NOT EXISTS pricing_price_books (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      code            TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      customer_id     INTEGER REFERENCES customers(id),
      customer_name   TEXT DEFAULT '',
      price_type      TEXT DEFAULT 'customer',
      currency        TEXT DEFAULT 'ILS',
      status          TEXT DEFAULT 'draft',
      source_type     TEXT DEFAULT 'manual',
      source_ref      TEXT DEFAULT '',
      notes           TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pricing_price_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      price_book_id     INTEGER NOT NULL REFERENCES pricing_price_books(id) ON DELETE CASCADE,
      sku               TEXT NOT NULL,
      diameter          INTEGER,
      category          TEXT DEFAULT '',
      description       TEXT NOT NULL,
      quantity          REAL DEFAULT 1,
      unit              TEXT DEFAULT 'kg',
      price_before_vat  REAL DEFAULT 0,
      currency          TEXT DEFAULT 'ILS',
      exception_flag    INTEGER DEFAULT 0,
      active            INTEGER DEFAULT 1,
      valid_from        TEXT,
      valid_to          TEXT,
      sort_order        INTEGER DEFAULT 0,
      notes             TEXT DEFAULT '',
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),
      UNIQUE(price_book_id, sku)
    );

  `);
  } catch (err) {
    console.warn('[DB] finance schema warn:', err.message);
  }
  try {
    db.prepare('ALTER TABLE pricing_price_items ADD COLUMN diameter INTEGER').run();
  } catch (err) {
    if (!String(err.message || '').includes('duplicate column')) {
      console.warn('[DB] pricing items diameter migration warn:', err.message);
    }
  }
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pricing_price_books_active
        ON pricing_price_books(status, price_type, customer_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_pricing_price_items_book_diameter
        ON pricing_price_items(price_book_id, diameter, active);
    `);
  } catch (err) {
    console.warn('[DB] finance pricing index warn:', err.message);
  }
}

module.exports = { ensureFinanceSchema };
