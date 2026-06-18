const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createPricer } = require('../services/pricer');

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pricing_price_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      customer_id INTEGER,
      customer_name TEXT DEFAULT '',
      price_type TEXT DEFAULT 'customer',
      currency TEXT DEFAULT 'ILS',
      status TEXT DEFAULT 'draft',
      source_type TEXT DEFAULT 'manual',
      source_ref TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE pricing_price_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_book_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      diameter INTEGER,
      category TEXT DEFAULT '',
      description TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit TEXT DEFAULT 'kg',
      price_before_vat REAL DEFAULT 0,
      currency TEXT DEFAULT 'ILS',
      exception_flag INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      valid_from TEXT,
      valid_to TEXT,
      sort_order INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(price_book_id, sku)
    );
  `);
  const general = db.prepare(`
    INSERT INTO pricing_price_books (code, name, price_type, status)
    VALUES ('GEN-1', 'General', 'general', 'active')
  `).run().lastInsertRowid;
  const customer = db.prepare(`
    INSERT INTO pricing_price_books (code, name, customer_id, price_type, status)
    VALUES ('CUST-7', 'Customer 7', 7, 'customer', 'active')
  `).run().lastInsertRowid;
  const ins = db.prepare(`
    INSERT INTO pricing_price_items
      (price_book_id, sku, diameter, description, price_before_vat)
    VALUES (?, ?, ?, ?, ?)
  `);
  ins.run(general, 'D8', 8, 'Diameter 8 general', 5);
  ins.run(general, 'D10', 10, 'Diameter 10 general', 6);
  ins.run(customer, 'D8', 8, 'Diameter 8 customer', 4);
  return { db, pricer: createPricer(db) };
}

test('pricer uses active customer price book without general fallback', () => {
  const { db, pricer } = setup();
  try {
    const missingCustomerDiameter = pricer.resolveDiameterPrice(10, { tier: 'customer', customerId: 7 });
    assert.equal(missingCustomerDiameter.status, 'price_list_requires_update');
    assert.equal(missingCustomerDiameter.pricePerKg, null);
    assert.equal(missingCustomerDiameter.pricingSource, 'customer');

    const general = pricer.resolveDiameterPrice(10, { tier: 'general' });
    assert.equal(general.status, 'priced');
    assert.equal(general.pricePerKg, 6);
    assert.equal(general.pricingSource, 'general');
  } finally {
    db.close();
  }
});

test('order quote marks missing selected new price-book rows instead of returning zero silently', () => {
  const { db, pricer } = setup();
  try {
    const result = pricer.calcOrderPriceForCustomer(
      [{ diameter: 10, totalWeight: 100 }],
      { id: 7, price_tier: 'customer', discount_pct: 0 },
    );
    assert.equal(result.status, 'price_list_requires_update');
    assert.equal(result.requiresPriceListUpdate, true);
    assert.equal(result.warnings[0].diameter, 10);
    assert.equal(result.breakdown[0].pricePerKg, null);
  } finally {
    db.close();
  }
});
