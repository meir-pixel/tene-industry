'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { normalizeDiameter, seedLegacyDiameterCatalog } = require('../services/materialCatalog');
const { ensureCoreSchema } = require('../db/coreSchema');
const { runCoreMigrations } = require('../db/startup');

test('diameter normalization accepts keyboard formats and rejects unsafe catalog input', () => {
  assert.deepEqual(normalizeDiameter('5.5'), { key: '5.5', numeric: 5.5, display: 'Ø5.5' });
  assert.deepEqual(normalizeDiameter(' Ø5,50 '), { key: '5.5', numeric: 5.5, display: 'Ø5.5' });
  assert.deepEqual(normalizeDiameter('5.25'), { key: '5.25', numeric: 5.25, display: 'Ø5.25' });
  assert.deepEqual(normalizeDiameter('55'), { key: '55', numeric: 55, display: 'Ø55' });
  assert.equal(normalizeDiameter('5.1234'), null);
  assert.equal(normalizeDiameter('diameter-5.5'), null);
});

test('legacy raw-material diameters seed an active catalog without changing lots', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE raw_material (id INTEGER PRIMARY KEY, diameter NUMERIC, active INTEGER DEFAULT 1);
    CREATE TABLE diameter_catalog (
      id INTEGER PRIMARY KEY, diameter_key TEXT UNIQUE, diameter_display TEXT, status TEXT, source TEXT
    );
    INSERT INTO raw_material (id,diameter) VALUES (1,6),(2,5.5),(3,5.50);
  `);
  const before = db.prepare('SELECT * FROM raw_material ORDER BY id').all();
  seedLegacyDiameterCatalog(db);
  assert.deepEqual(db.prepare('SELECT diameter_key,diameter_display,status,source FROM diameter_catalog ORDER BY id').all(), [
    { diameter_key: '6', diameter_display: 'Ø6', status: 'active', source: 'legacy' },
    { diameter_key: '5.5', diameter_display: 'Ø5.5', status: 'active', source: 'legacy' },
  ]);
  assert.deepEqual(db.prepare('SELECT * FROM raw_material ORDER BY id').all(), before);
  db.close();
});

test('catalog foundation keeps legacy lots approved and optional catalog linking additive', () => {
  const db = new Database(':memory:');
  ensureCoreSchema(db);
  db.prepare("INSERT INTO raw_material (diameter,weight_received) VALUES (14,100)").run();
  runCoreMigrations(db);
  const lot = db.prepare('SELECT diameter,verification_status,catalog_item_id FROM raw_material').get();
  assert.deepEqual(lot, { diameter: 14, verification_status: 'approved', catalog_item_id: null });
  assert.deepEqual(db.prepare("SELECT diameter_key,status FROM diameter_catalog WHERE diameter_key='14'").get(), { diameter_key: '14', status: 'active' });
  db.close();
});
