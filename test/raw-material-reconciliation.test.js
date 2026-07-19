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

function seedDemand(db, { orderId = 1, itemId = 1, itemOrderId = orderId, producedQty = 0, status = 'waiting', startedAt = null, completedAt = null } = {}) {
  db.prepare('INSERT OR IGNORE INTO orders (id,status) VALUES (?,?)').run(orderId, status);
  if (itemOrderId !== orderId) db.prepare('INSERT OR IGNORE INTO orders (id,status) VALUES (?,?)').run(itemOrderId, status);
  db.prepare('INSERT OR IGNORE INTO items (id,order_id,produced_qty,status,started_at,completed_at) VALUES (?,?,?,?,?,?)')
    .run(itemId, itemOrderId, producedQty, status, startedAt, completedAt);
}

function diagnostics(report, code) {
  return report.diagnostics.filter(row => row.code === code);
}

function snapshot(db) {
  return {
    raw: db.prepare('SELECT * FROM raw_material ORDER BY id').all(),
    orders: db.prepare('SELECT * FROM orders ORDER BY id').all(),
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    usage: db.prepare('SELECT * FROM raw_material_usage ORDER BY id').all(),
    reservations: db.prepare('SELECT * FROM inventory_reservations ORDER BY id').all(),
    changes: db.prepare('SELECT total_changes() AS count').get().count,
  };
}

function assertReadOnly(db, action) {
  const before = snapshot(db);
  action();
  const after = snapshot(db);
  assert.deepEqual(after, before);
}

test('empty reconciliation database returns a deterministic read-only report', () => {
  const db = createDb();
  const first = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const second = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    reportVersion: 1,
    generatedAt: '2026-07-19T10:00:00.000Z',
    summary: {
      rawMaterialCount: 0,
      reservationCount: 0,
      usageCount: 0,
      unknownReservationCount: 0,
      unknownReservedKg: 0,
      diagnosticCounts: {},
    },
    lots: [],
    stockPositions: [],
    demands: [],
    orphans: [],
    referenceIssues: [],
    diagnostics: [],
  });
  assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
  db.close();
});

test('exact 100/10/10/10 demand reports 90 and 80 with one demand-scoped double count', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (41,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (51,1,1,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const stock = report.stockPositions[0];
  assert.equal(stock.observedBalance.counterPhysicalOnHand, 90);
  assert.equal(stock.observedBalance.reservationAwareAvailableFromCounter, 80);
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    code: 'probable_double_count',
    severity: 'warning',
    scope: 'demand',
    entity: { rawMaterialId: null, orderId: 1, itemId: 1, diameter: 12, materialType: 'coil' },
    evidence: {
      orderId: 1,
      itemId: 1,
      diameter: 12,
      materialType: 'coil',
      usageIds: [41],
      reservationIds: [51],
      usageRowsKg: 10,
      activeReservedKg: 10,
    },
    explanationKey: 'exact_demand_usage_and_active_reservation_overlap',
  });
  assert.equal(stock.observedBalance.futureAuthoritativeBalance.physicalOnHand, null);
  db.close();
});

test('same bucket usage and reservation belonging to unrelated demands are not double-counted', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  seedDemand(db, { orderId: 2, itemId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,2,2,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT).length, 0);
  const allocation = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_RESERVATION_ALLOCATION);
  assert.equal(allocation.length, 1);
  assert.equal(allocation[0].scope, 'bucket');
  db.close();
});

test('same demand usage and active reservation with different material types are not double-counted', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'straight',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT).length, 0);
  db.close();
});

test('legacy usage remains ambiguous with canonical production status and timestamps', () => {
  const db = createDb();
  seedDemand(db, {
    producedQty: 5,
    status: 'הושלם',
    startedAt: '2026-07-18T09:00:00Z',
    completedAt: '2026-07-18T10:00:00Z',
  });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (7,1,1,1,10)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, 'review');
  assert.equal(rows[0].scope, 'demand');
  assert.deepEqual(rows[0].entity, { rawMaterialId: null, orderId: 1, itemId: 1, diameter: null, materialType: null });
  assert.deepEqual(rows[0].evidence, {
    usageCount: 1,
    usageIds: [7],
    usageRowsKg: 10,
    supportingProductionEvidence: {
      producedQty: 5,
      status: 'הושלם',
      startedAt: '2026-07-18T09:00:00Z',
      completedAt: '2026-07-18T10:00:00Z',
      recognizedStatus: true,
    },
  });
  assert.equal(report.summary.diagnosticCounts.ambiguous_historical_consumption, 1);
  db.close();
});

test('ordinary active reservation remains a normal reservation-only state despite production hints', () => {
  const db = createDb();
  seedDemand(db, { producedQty: 2, status: 'בייצור', startedAt: '2026-07-18T09:00:00Z' });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.demands[0].relationship, 'reservation_only');
  assert.equal(report.demands[0].diagnostics.some(row => row.code === 'reservation_without_usage'), false);
  assert.equal(report.demands[0].supportingProductionEvidence.recognizedStatus, true);
  db.close();
});

test('consumed reservation without usage remains diagnosed', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'consumed')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const row = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE)[0];
  assert.equal(row.severity, 'error');
  assert.equal(row.scope, 'demand');
  assert.deepEqual(row.evidence, { consumedReservationKg: 10 });
  db.close();
});

test('released reservation with retained usage remains diagnosed', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'released')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const row = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE)[0];
  assert.equal(row.severity, 'warning');
  assert.equal(row.scope, 'demand');
  assert.deepEqual(row.evidence, { releasedReservationKg: 10, usageRowsKg: 10 });
  db.close();
});

test('missing raw material produces one source-scoped orphaned usage', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare('INSERT INTO raw_material_usage VALUES (8,999,1,1,10)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope, 'reference');
  assert.deepEqual(rows[0].evidence, {
    type: 'orphaned_usage',
    sourceKind: 'usage',
    usageId: 8,
    rawMaterialId: 999,
    orderId: 1,
    itemId: 1,
    missing: ['raw_material'],
  });
  assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
  db.close();
});

test('usage item/order ownership mismatch is distinct from missing references', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 10, itemOrderId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (6,1,1,10,10)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.orphans.length, 0);
  const row = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH)[0];
  assert.equal(row.severity, 'error');
  assert.equal(row.scope, 'reference');
  assert.deepEqual(row.evidence, {
    type: 'item_order_mismatch',
    sourceKind: 'usage',
    sourceRowId: 6,
    usageId: 6,
    referencedOrderId: 1,
    itemId: 10,
    actualItemOrderId: 2,
    rawMaterialId: 1,
    diameter: 12,
    materialType: 'coil',
  });
  db.close();
});

test('reservation item/order ownership mismatch includes bucket evidence', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 10, itemOrderId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (9,1,10,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.orphans.length, 0);
  const row = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH)[0];
  assert.equal(row.scope, 'reference');
  assert.equal(row.evidence.sourceKind, 'reservation');
  assert.equal(row.evidence.reservationId, 9);
  assert.equal(row.evidence.referencedOrderId, 1);
  assert.equal(row.evidence.actualItemOrderId, 2);
  assert.equal(row.evidence.diameter, 12);
  assert.equal(row.evidence.materialType, 'coil');
  db.close();
});

test('matching ownership has no mismatch while missing order or item remains orphaned', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,5),(2,1,99,999,5)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 0);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE).length, 1);
  assert.deepEqual(report.orphans[0].missing, ['order', 'item']);
  db.close();
});

test('usage missing order and usage missing item remain separate orphans without mismatch', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  seedDemand(db, { orderId: 2, itemId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,99,2,5),(2,1,1,999,5)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 0);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE).length, 2);
  assert.deepEqual(report.orphans.map(row => [row.usageId, row.missing]), [
    [2, ['item']],
    [1, ['order']],
  ]);
  db.close();
});

test('reservation missing order and reservation missing item remain separate orphans without mismatch', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  seedDemand(db, { orderId: 2, itemId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,99,2,12,'coil',5,'active'),(2,1,999,12,'coil',5,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 0);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION).length, 2);
  assert.deepEqual(report.orphans.map(row => [row.reservationId, row.missing]), [
    [2, ['item']],
    [1, ['order']],
  ]);
  db.close();
});

test('coil and straight active reservations are separate non-duplicate groups', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1),(2,12,'straight',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active'),(2,1,1,12,'straight',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION).length, 0);
  db.close();
});

test('released history plus active replacement is not a duplicate', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'released'),(2,1,1,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION).length, 0);
  db.close();
});

test('two active rows in one exact group produce one deterministic review diagnostic', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (8,1,1,12,'coil',4,'active'),(3,1,1,12,'coil',6,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, 'review');
  assert.equal(rows[0].scope, 'demand');
  assert.deepEqual(rows[0].entity, { rawMaterialId: null, orderId: 1, itemId: 1, diameter: 12, materialType: 'coil' });
  assert.deepEqual(rows[0].evidence, {
    orderId: 1,
    itemId: 1,
    diameter: 12,
    materialType: 'coil',
    activeRowCount: 2,
    totalActiveReservedKg: 10,
    reservations: [
      { reservationId: 3, reservedKg: 6 },
      { reservationId: 8, reservedKg: 4 },
    ],
    reservationIds: [3, 8],
  });
  db.close();
});

test('same bucket on separate items and same item reference on separate orders do not combine as duplicates', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  seedDemand(db, { orderId: 1, itemId: 2 });
  db.prepare('INSERT INTO orders VALUES (2,?)').run('waiting');
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',10,'active'),(2,1,2,12,'coil',10,'active'),(3,2,1,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION).length, 0);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 1);
  db.close();
});

test('unknown reservation status remains visible without entering recognized balances', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (12,1,1,12,'coil',17.5,'mystery')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.summary.unknownReservationCount, 1);
  assert.equal(report.summary.unknownReservedKg, 17.5);
  assert.equal(report.demands[0].unknownReservationCount, 1);
  assert.equal(report.demands[0].unknownReservedKg, 17.5);
  assert.equal(report.stockPositions[0].unknownReservedKg, 17.5);
  assert.deepEqual(report.stockPositions[0].observedBalance.observed, {
    receivedKg: 100,
    legacyUsedCounterKg: 0,
    usageRowsKg: 0,
    scrappedCounterKg: 0,
    activeReservedKg: 0,
    consumedReservationKg: 0,
    releasedReservationKg: 0,
  });
  const row = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.UNKNOWN_RESERVATION_STATUS)[0];
  assert.equal(row.severity, 'review');
  assert.equal(row.scope, 'reference');
  assert.deepEqual(row.evidence, {
    reservationId: 12,
    rawStatus: 'mystery',
    reservedKg: 17.5,
    orderId: 1,
    itemId: 1,
    diameter: 12,
    materialType: 'coil',
  });
  assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
  db.close();
});

test('over-reservation preserves negative observed availability', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',120,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.stockPositions[0].observedBalance.reservationAwareAvailableFromCounter, -20);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.OVER_RESERVED).length, 1);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.NEGATIVE_OBSERVED_AVAILABLE).length, 1);
  db.close();
});

function seedDeterministicState(db, reverse = false) {
  seedDemand(db, { orderId: 1, itemId: 1 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,2,1)").run();
  const usageRows = [[2, 1, 1, 1, 4], [1, 1, 1, 1, 6]];
  const reservationRows = [[4, 1, 1, 12, 'coil', 4, 'active'], [3, 1, 1, 12, 'coil', 6, 'active']];
  for (const row of reverse ? [...usageRows].reverse() : usageRows) {
    db.prepare('INSERT INTO raw_material_usage VALUES (?,?,?,?,?)').run(...row);
  }
  for (const row of reverse ? [...reservationRows].reverse() : reservationRows) {
    db.prepare('INSERT INTO inventory_reservations VALUES (?,?,?,?,?,?,?)').run(...row);
  }
}

test('same logical rows and clock produce identical de-duplicated reports regardless of insertion order', () => {
  const firstDb = createDb();
  const secondDb = createDb();
  seedDeterministicState(firstDb, false);
  seedDeterministicState(secondDb, true);
  const first = buildRawMaterialReconciliationReport(firstDb, { clock: FIXED_CLOCK });
  const second = buildRawMaterialReconciliationReport(secondDb, { clock: FIXED_CLOCK });
  assert.deepEqual(first, second);
  assert.equal(first.summary.diagnosticCounts.ambiguous_historical_consumption, 1);
  assert.equal(diagnostics(first, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT).length, 1);
  assert.equal(diagnostics(first, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION).length, 1);
  assertReadOnly(firstDb, () => {
    buildRawMaterialReconciliationReport(firstDb, { clock: FIXED_CLOCK });
    buildRawMaterialReconciliationReport(firstDb, { clock: FIXED_CLOCK });
  });
  firstDb.close();
  secondDb.close();
});
