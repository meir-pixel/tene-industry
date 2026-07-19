'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { RAW_MATERIAL_DIAGNOSTIC } = require('../services/rawMaterialBalanceModel');
const { buildRawMaterialReconciliationReport } = require('../services/rawMaterialReconciliation');

const FIXED_CLOCK = () => new Date('2026-07-19T10:00:00.000Z');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE raw_material (
      id INTEGER PRIMARY KEY,
      diameter NUMERIC,
      material_type TEXT DEFAULT 'coil',
      weight_received NUMERIC DEFAULT 0,
      weight_used NUMERIC DEFAULT 0,
      weight_scrapped NUMERIC DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      produced_qty INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting',
      started_at DATETIME,
      completed_at DATETIME
    );
    CREATE TABLE raw_material_usage (
      id INTEGER PRIMARY KEY,
      raw_material_id INTEGER,
      order_id INTEGER,
      item_id INTEGER,
      weight_used NUMERIC DEFAULT 0
    );
    CREATE TABLE inventory_reservations (
      id INTEGER PRIMARY KEY,
      order_id INTEGER,
      item_id INTEGER,
      diameter NUMERIC,
      material_type TEXT DEFAULT 'coil',
      reserved_kg NUMERIC DEFAULT 0,
      status TEXT
    );
  `);
  return db;
}

function seedDemand(db, { orderId = 1, itemId = 1, producedQty = 0, status = 'waiting', startedAt = null, completedAt = null } = {}) {
  db.prepare('INSERT INTO orders (id,status) VALUES (?,?)').run(orderId, status);
  db.prepare('INSERT INTO items (id,order_id,produced_qty,status,started_at,completed_at) VALUES (?,?,?,?,?,?)')
    .run(itemId, orderId, producedQty, status, startedAt, completedAt);
}

function codes(report) {
  return report.diagnostics.map(row => row.code);
}

test('current creation pattern reports 90 API-style, 80 reservation-aware and probable double count', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active')").run();

  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const stock = report.stockPositions[0];
  assert.equal(stock.observedBalance.counterPhysicalOnHand, 90);
  assert.equal(stock.observedBalance.usageRowPhysicalOnHand, 90);
  assert.equal(stock.observedBalance.reservationAwareAvailableFromCounter, 80);
  assert.equal(stock.observedBalance.reservationAwareAvailableFromUsageRows, 80);
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT));
  assert.equal(stock.observedBalance.futureAuthoritativeBalance.physicalOnHand, null);
  assert.equal(stock.reservationScope, 'diameter_material_bucket');
  db.close();
});

test('usage before production is classified as ambiguous historical consumption', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.ok(report.demands[0].diagnostics.some(row => row.code === RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION));
  assert.equal(report.demands[0].productionEvidence, false);
  db.close();
});

test('active reservation without usage remains a valid reservation-only pre-production demand', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.demands[0].relationship, 'reservation_only');
  assert.equal(report.demands[0].diagnostics.length, 0);
  db.close();
});

test('consumed reservation without usage is diagnosed', () => {
  const db = createDb();
  seedDemand(db, { producedQty: 5, status: 'done', completedAt: '2026-07-18T10:00:00Z' });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'consumed')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE));
  db.close();
});

test('released reservation retaining usage before production is diagnosed', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'released')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE));
  db.close();
});

test('usage referencing deleted entities is reported as orphaned usage', () => {
  const db = createDb();
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,99,999,10)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(report.orphans[0], {
    type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE,
    usageId: 1,
    rawMaterialId: 1,
    orderId: 99,
    itemId: 999,
    missing: ['order', 'item'],
  });
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE));
  db.close();
});

test('reservation referencing deleted order and item is reported as orphaned reservation', () => {
  const db = createDb();
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,99,999,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(report.orphans[0], {
    type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION,
    reservationId: 1,
    orderId: 99,
    itemId: 999,
    missing: ['order', 'item'],
  });
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION));
  db.close();
});

test('repeated active reservations for one demand are diagnosed deterministically', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  const insert = db.prepare("INSERT INTO inventory_reservations VALUES (?,?,?,?,?,?, 'active')");
  insert.run(2, 1, 1, 12, 'coil', 10);
  insert.run(1, 1, 1, 12, 'coil', 10);
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const diagnostic = report.demands[0].diagnostics.find(row => row.code === RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION);
  assert.equal(diagnostic.evidence.activeReservationCount, 2);
  assert.deepEqual(report.demands[0].reservationIds, [1, 2]);
  db.close();
});

test('over-reservation preserves negative observed availability', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',120,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.stockPositions[0].observedBalance.reservationAwareAvailableFromCounter, -20);
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.OVER_RESERVED));
  assert.ok(codes(report).includes(RAW_MATERIAL_DIAGNOSTIC.NEGATIVE_OBSERVED_AVAILABLE));
  db.close();
});

test('report generation performs no writes and is deterministic with an injected clock', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,2,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active')").run();
  const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
  const before = {
    raw: db.prepare('SELECT * FROM raw_material ORDER BY id').all(),
    usage: db.prepare('SELECT * FROM raw_material_usage ORDER BY id').all(),
    reservation: db.prepare('SELECT * FROM inventory_reservations ORDER BY id').all(),
  };
  const first = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const second = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
  assert.deepEqual(first, second);
  assert.equal(afterChanges, beforeChanges);
  assert.deepEqual(db.prepare('SELECT * FROM raw_material ORDER BY id').all(), before.raw);
  assert.deepEqual(db.prepare('SELECT * FROM raw_material_usage ORDER BY id').all(), before.usage);
  assert.deepEqual(db.prepare('SELECT * FROM inventory_reservations ORDER BY id').all(), before.reservation);
  const sorted = [...first.diagnostics].sort((a, b) => {
    const severity = { error: 0, warning: 1, review: 2 };
    return severity[a.severity] - severity[b.severity] || a.code.localeCompare(b.code, 'en');
  });
  assert.deepEqual(first.diagnostics.map(row => [row.severity, row.code]), sorted.map(row => [row.severity, row.code]));
  db.close();
});
