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
  `);
  } catch (err) {
    console.warn('[DB] finance schema warn:', err.message);
  }
}

module.exports = { ensureFinanceSchema };
