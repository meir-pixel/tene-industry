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
  assert.throws(() => db.prepare("INSERT INTO raw_material (diameter,verification_status) VALUES (16,'unknown')").run(), /CHECK constraint failed/);
  db.close();
});

test('startup upgrades an existing raw-material table with the verification check without changing lots', () => {
  const db = new Database(':memory:');
  ensureCoreSchema(db);
  db.exec(`
    CREATE TABLE raw_material_legacy (
      id INTEGER PRIMARY KEY AUTOINCREMENT, material_type TEXT DEFAULT 'coil', diameter INTEGER NOT NULL,
      supplier_id INTEGER, lot_number TEXT, certificate_num TEXT, grade TEXT DEFAULT 'B500B', received_date TEXT,
      weight_received REAL DEFAULT 0, weight_used REAL DEFAULT 0, weight_scrapped REAL DEFAULT 0,
      purchase_price REAL DEFAULT 0, warehouse_loc TEXT, bending_shape_name TEXT, bending_shape_segments TEXT,
      bending_shape_source TEXT, bending_shape_confidence REAL, notes TEXT, active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO raw_material_legacy (id,diameter,lot_number,weight_received) VALUES (7,5.5,'LEGACY-55',80);
    DROP TABLE raw_material;
    ALTER TABLE raw_material_legacy RENAME TO raw_material;
  `);
  runCoreMigrations(db);
  assert.deepEqual(db.prepare('SELECT id,diameter,lot_number,weight_received,verification_status FROM raw_material').get(), {
    id: 7, diameter: 5.5, lot_number: 'LEGACY-55', weight_received: 80, verification_status: 'approved',
  });
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='raw_material'").get().sql, /CHECK \(verification_status IN/);
  assert.throws(() => db.prepare("UPDATE raw_material SET verification_status='unexpected' WHERE id=7").run(), /CHECK constraint failed/);
  db.close();
});
