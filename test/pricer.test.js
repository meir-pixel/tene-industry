const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createPricer } = require('../services/pricer');

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE price_list (
      diameter INTEGER PRIMARY KEY,
      price_list REAL,
      price_cust REAL
    );
  `);
  db.prepare('INSERT INTO price_list (diameter, price_list, price_cust) VALUES (?,?,?)').run(8, 5, 4);
  db.prepare('INSERT INTO price_list (diameter, price_list, price_cust) VALUES (?,?,?)').run(10, 6, null);
  return { db, pricer: createPricer(db) };
}

test('pricer uses the selected customer price list without fallback', () => {
  const { db, pricer } = setup();
  try {
    const personal = pricer.resolveDiameterPrice(10, { tier: 'customer' });
    assert.equal(personal.status, 'price_list_requires_update');
    assert.equal(personal.pricePerKg, null);
    assert.equal(personal.pricingSource, 'customer');

    const general = pricer.resolveDiameterPrice(10, { tier: 'list' });
    assert.equal(general.status, 'priced');
    assert.equal(general.pricePerKg, 6);
    assert.equal(general.pricingSource, 'general');
  } finally {
    db.close();
  }
});

test('order quote marks missing selected prices instead of returning zero silently', () => {
  const { db, pricer } = setup();
  try {
    const result = pricer.calcOrderPriceForCustomer(
      [{ diameter: 10, totalWeight: 100 }],
      { price_tier: 'customer', discount_pct: 0 },
    );
    assert.equal(result.status, 'price_list_requires_update');
    assert.equal(result.requiresPriceListUpdate, true);
    assert.equal(result.warnings[0].diameter, 10);
    assert.equal(result.breakdown[0].pricePerKg, null);
  } finally {
    db.close();
  }
});
