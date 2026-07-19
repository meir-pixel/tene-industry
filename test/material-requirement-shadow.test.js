'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildMaterialRequirementShadowReport } = require('../services/materialRequirementShadow');

const FIXED_CLOCK = () => new Date('2026-07-19T10:00:00.000Z');

function createDb({ explicitMaterialType = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      order_num TEXT,
      delivery_date TEXT,
      priority TEXT,
      inventory_lifecycle_version INTEGER DEFAULT 1
    );
    CREATE TABLE pallets (id INTEGER PRIMARY KEY, order_id INTEGER);
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      pallet_id INTEGER,
      diameter NUMERIC,
      total_weight NUMERIC,
      batch_id INTEGER
      ${explicitMaterialType ? ', material_type TEXT' : ''}
    );
    CREATE TABLE raw_material (id INTEGER PRIMARY KEY, material_type TEXT);
    CREATE TABLE raw_material_usage (
      id INTEGER PRIMARY KEY,
      raw_material_id INTEGER,
      order_id INTEGER,
      item_id INTEGER,
      weight_used NUMERIC
    );
    CREATE TABLE inventory_reservations (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      item_id INTEGER,
      material_type TEXT
    );
  `);
  return db;
}

function insertCandidate(db, {
  orderId = 1,
  itemId = 1,
  orderNum = 'ORD-1',
  deliveryDate = '2026-08-20',
  priority = 'רגיל',
  lifecycleVersion = 1,
  diameter = 12,
  totalWeight = 100,
  materialType,
  batchId = null,
} = {}) {
  db.prepare('INSERT OR IGNORE INTO orders (id,order_num,delivery_date,priority,inventory_lifecycle_version) VALUES (?,?,?,?,?)')
    .run(orderId, orderNum, deliveryDate, priority, lifecycleVersion);
  const columns = db.prepare("SELECT name FROM pragma_table_info('items')").all().map(row => row.name);
  if (columns.includes('material_type')) {
    db.prepare('INSERT INTO items (id,order_id,diameter,total_weight,batch_id,material_type) VALUES (?,?,?,?,?,?)')
      .run(itemId, orderId, diameter, totalWeight, batchId, materialType ?? null);
  } else {
    db.prepare('INSERT INTO items (id,order_id,diameter,total_weight,batch_id) VALUES (?,?,?,?,?)')
      .run(itemId, orderId, diameter, totalWeight, batchId);
  }
}

function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return {
    totalChanges: db.prepare('SELECT total_changes() AS count').get().count,
    tables: Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY id`).all()])),
  };
}

test('empty database returns a deterministic valid empty report', () => {
  const db = new Database(':memory:');
  assert.deepEqual(buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }), {
    generatedAt: '2026-07-19T10:00:00.000Z',
    lifecycleVersion: 2,
    mode: 'shadow_read_only',
    rows: [],
  });
  db.close();
});

test('valid weight and diameter without material type remains incomplete and never defaults to coil', () => {
  const db = createDb();
  insertCandidate(db);
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.materialTypeCandidate, null);
  assert.equal(row.materialTypeEvidence.classification, 'missing');
  assert.equal(row.readiness, 'incomplete');
  assert.deepEqual(row.issues, ['missing_material_type']);
  assert.equal(row.needByDate, '2026-08-20');
  assert.equal(row.needBySource, 'order_delivery_date');
  db.close();
});

test('explicit valid item material type is authoritative and can be ready', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: ' Straight ' });
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.materialTypeCandidate, 'straight');
  assert.deepEqual(row.materialTypeEvidence, {
    classification: 'explicit', authoritative: true, values: ['straight'], sources: ['item'],
  });
  assert.equal(row.readiness, 'ready');
  assert.deepEqual(row.issues, []);
  db.close();
});

test('consistent reservation evidence is labelled non-authoritative and cannot be ready', () => {
  const db = createDb();
  insertCandidate(db);
  db.prepare("INSERT INTO inventory_reservations (id,order_id,item_id,material_type) VALUES (2,1,1,'coil'),(1,1,1,'coil')").run();
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.materialTypeCandidate, 'coil');
  assert.equal(row.materialTypeEvidence.classification, 'consistent_legacy_evidence');
  assert.equal(row.materialTypeEvidence.authoritative, false);
  assert.equal(row.readiness, 'incomplete');
  assert.deepEqual(row.issues, ['material_type_not_explicit']);
  db.close();
});

test('conflicting reservation and linked-lot evidence is ambiguous', () => {
  const db = createDb();
  db.prepare("INSERT INTO raw_material (id,material_type) VALUES (9,'straight')").run();
  insertCandidate(db, { batchId: 9 });
  db.prepare("INSERT INTO inventory_reservations (id,order_id,item_id,material_type) VALUES (1,1,1,'coil')").run();
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.materialTypeCandidate, null);
  assert.equal(row.materialTypeEvidence.classification, 'ambiguous_legacy_evidence');
  assert.deepEqual(row.materialTypeEvidence.values, ['coil', 'straight']);
  assert.equal(row.readiness, 'ambiguous');
  assert.deepEqual(row.issues, ['conflicting_legacy_material_type_evidence']);
  db.close();
});

test('exact usage-linked lot is visible as non-authoritative legacy evidence', () => {
  const db = createDb();
  insertCandidate(db);
  db.prepare("INSERT INTO raw_material (id,material_type) VALUES (8,'straight')").run();
  db.prepare('INSERT INTO raw_material_usage (id,raw_material_id,order_id,item_id,weight_used) VALUES (7,8,1,1,50)').run();
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.materialTypeCandidate, 'straight');
  assert.equal(row.materialTypeEvidence.classification, 'consistent_legacy_evidence');
  assert.deepEqual(row.materialTypeEvidence.sources, ['raw_material_usage']);
  db.close();
});

test('missing date uses unknown provenance without blocking an otherwise ready candidate', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: 'coil', deliveryDate: null });
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.needByDate, null);
  assert.equal(row.needBySource, 'unknown');
  assert.deepEqual(row.issues, ['missing_need_by_date']);
  assert.equal(row.readiness, 'ready');
  db.close();
});

test('invalid date is visible and no planned-production date is invented', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: 'coil', deliveryDate: '2026-02-30' });
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.needByDate, null);
  assert.equal(row.needBySource, 'unknown');
  assert.deepEqual(row.issues, ['invalid_need_by_date']);
  db.close();
});

test('V2 allocation is zero, unallocated equals requirement and procurement remains uncalculated', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: 'coil', totalWeight: 123.45 });
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.equal(row.v2AllocatedKg, 0);
  assert.equal(row.v2CurrentlyUnallocatedKg, 123.45);
  assert.equal(row.procurementShortageKg, null);
  assert.equal(row.procurementStatus, 'not_calculated_in_b1');
  db.close();
});

test('invalid weight and diameter produce stable issues and no calculated quantities', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: 'coil', diameter: Buffer.from('12'), totalWeight: -4 });
  const [row] = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.deepEqual(row.issues, ['invalid_diameter', 'invalid_required_kg']);
  assert.equal(row.diameterCandidate, null);
  assert.equal(row.requiredKgCandidate, null);
  assert.equal(row.v2AllocatedKg, null);
  assert.equal(row.v2CurrentlyUnallocatedKg, null);
  db.close();
});

test('lifecycle-v2 orders are excluded from the lifecycle-v1 shadow report', () => {
  const db = createDb({ explicitMaterialType: true });
  insertCandidate(db, { materialType: 'coil', lifecycleVersion: 2 });
  assert.deepEqual(buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows, []);
  db.close();
});

test('direct-only, pallet-only and consistent dual ownership use their canonical order metadata', () => {
  const db = createDb({ explicitMaterialType: true });
  db.exec(`
    INSERT INTO orders (id,order_num,delivery_date,priority,inventory_lifecycle_version) VALUES
      (1,'DIRECT','2026-08-20','direct-priority',1),
      (2,'PALLET','2026-08-21','pallet-priority',1);
    INSERT INTO pallets (id,order_id) VALUES (10,2),(11,1);
    INSERT INTO items (id,order_id,diameter,total_weight,material_type) VALUES (1,1,12,100,'coil');
    INSERT INTO items (id,pallet_id,diameter,total_weight,material_type) VALUES (2,10,12,100,'coil');
    INSERT INTO items (id,order_id,pallet_id,diameter,total_weight,material_type) VALUES (3,1,11,12,100,'coil');
  `);

  const rows = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK }).rows;
  assert.deepEqual(rows.map(row => [row.itemId, row.orderId, row.orderNumber, row.needByDate, row.priority, row.ownership.status]), [
    [1, 1, 'DIRECT', '2026-08-20', 'direct-priority', 'direct'],
    [3, 1, 'DIRECT', '2026-08-20', 'direct-priority', 'consistent'],
    [2, 2, 'PALLET', '2026-08-21', 'pallet-priority', 'pallet'],
  ]);
  db.close();
});

test('conflicting ownership remains ambiguous, ignores legacy evidence and reports deterministically without writes', () => {
  const db = createDb({ explicitMaterialType: true });
  db.exec(`
    INSERT INTO orders (id,order_num,delivery_date,priority,inventory_lifecycle_version) VALUES
      (1,'DIRECT','2026-08-20','direct-priority',1),
      (2,'PALLET','2026-08-21','pallet-priority',1);
    INSERT INTO pallets (id,order_id) VALUES (10,2);
    INSERT INTO items (id,order_id,pallet_id,diameter,total_weight,batch_id,material_type) VALUES (1,1,10,12,100,9,'coil');
    INSERT INTO raw_material (id,material_type) VALUES (9,'straight'),(8,'coil');
    INSERT INTO inventory_reservations (id,order_id,item_id,material_type) VALUES (1,1,1,'coil');
    INSERT INTO raw_material_usage (id,raw_material_id,order_id,item_id,weight_used) VALUES (1,8,2,1,50);
  `);
  const before = snapshot(db);
  const first = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK });
  const second = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK });
  const [row] = first.rows;
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(row.ownership, { status: 'conflict', orderId: null, directOrderId: 1, palletId: 10, palletOrderId: 2 });
  assert.equal(row.orderId, null);
  assert.equal(row.orderNumber, null);
  assert.equal(row.needByDate, null);
  assert.equal(row.needBySource, 'unknown');
  assert.equal(row.priority, null);
  assert.equal(row.materialTypeCandidate, null);
  assert.deepEqual(row.legacyMaterialTypeEvidence, []);
  assert.equal(row.readiness, 'ambiguous');
  assert.deepEqual(row.issues, ['item_order_ownership_conflict']);
  assert.equal(row.v2AllocatedKg, null);
  assert.equal(row.v2CurrentlyUnallocatedKg, null);
  assert.equal(row.procurementShortageKg, null);
  db.close();
});

test('report ordering and evidence ordering are deterministic', () => {
  const db = createDb();
  insertCandidate(db, { orderId: 2, itemId: 8, orderNum: 'ORD-2' });
  insertCandidate(db, { orderId: 1, itemId: 5, orderNum: 'ORD-1' });
  insertCandidate(db, { orderId: 1, itemId: 3, orderNum: 'ORD-1' });
  for (const [id, orderId, itemId] of [[4, 1, 3], [2, 1, 3], [9, 1, 5], [1, 2, 8]]) {
    db.prepare("INSERT INTO inventory_reservations (id,order_id,item_id,material_type) VALUES (?,?,?,'coil')").run(id, orderId, itemId);
  }
  const first = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK });
  const second = buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(first, second);
  assert.deepEqual(first.rows.map(row => [row.orderId, row.itemId]), [[1, 3], [1, 5], [2, 8]]);
  assert.deepEqual(first.rows[0].legacyMaterialTypeEvidence.map(entry => entry.sourceId), [2, 4]);
  db.close();
});

test('report generation performs no writes and leaves total_changes and tables unchanged', () => {
  const db = createDb();
  insertCandidate(db);
  db.prepare("INSERT INTO inventory_reservations (id,order_id,item_id,material_type) VALUES (1,1,1,'coil')").run();
  const before = snapshot(db);
  buildMaterialRequirementShadowReport(db, { clock: FIXED_CLOCK });
  const after = snapshot(db);
  assert.deepEqual(after, before);
  db.close();
});
