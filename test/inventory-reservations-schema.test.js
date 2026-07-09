const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

test('core schema defines inventory reservations migration contract', () => {
  const coreSchema = fs.readFileSync(path.join(__dirname, '..', 'db', 'coreSchema.js'), 'utf8');
  const block = coreSchema.match(/CREATE TABLE IF NOT EXISTS inventory_reservations \([\s\S]*?\n    \);/);

  assert.ok(block, 'expected inventory_reservations table migration');
  assert.match(block[0], /id\s+INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(block[0], /order_id\s+INTEGER NOT NULL/);
  assert.match(block[0], /item_id\s+INTEGER/);
  assert.match(block[0], /diameter\s+NUMERIC/);
  assert.match(block[0], /material_type\s+TEXT/);
  assert.match(block[0], /reserved_kg\s+NUMERIC DEFAULT 0/);
  assert.match(block[0], /status\s+TEXT NOT NULL DEFAULT 'active' CHECK \(status IN \('active', 'released', 'consumed'\)\)/);
  assert.match(block[0], /created_at\s+DATETIME DEFAULT CURRENT_TIMESTAMP/);
  assert.match(block[0], /updated_at\s+DATETIME DEFAULT CURRENT_TIMESTAMP/);
});
