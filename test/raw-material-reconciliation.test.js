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

function assertDemandAggregationInvariant(demand) {
  const totals = demand.materialBuckets.reduce((sum, bucket) => ({
    usageCount: sum.usageCount + bucket.usageRows.length,
    usageRowsKg: sum.usageRowsKg + bucket.totals.usageRowsKg,
    reservationCount: sum.reservationCount + bucket.reservations.length,
    activeReservationCount: sum.activeReservationCount + bucket.totals.activeReservationCount,
    activeReservedKg: sum.activeReservedKg + bucket.totals.activeReservedKg,
    consumedReservationCount: sum.consumedReservationCount + bucket.totals.consumedReservationCount,
    consumedReservationKg: sum.consumedReservationKg + bucket.totals.consumedReservationKg,
    releasedReservationCount: sum.releasedReservationCount + bucket.totals.releasedReservationCount,
    releasedReservationKg: sum.releasedReservationKg + bucket.totals.releasedReservationKg,
    unknownReservationCount: sum.unknownReservationCount + bucket.totals.unknownReservationCount,
    unknownReservedKg: sum.unknownReservedKg + bucket.totals.unknownReservedKg,
  }), {
    usageCount: 0,
    usageRowsKg: 0,
    reservationCount: 0,
    activeReservationCount: 0,
    activeReservedKg: 0,
    consumedReservationCount: 0,
    consumedReservationKg: 0,
    releasedReservationCount: 0,
    releasedReservationKg: 0,
    unknownReservationCount: 0,
    unknownReservedKg: 0,
  });
  for (const [field, value] of Object.entries(totals)) assert.equal(demand[field], value, field);
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
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length, 0);
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
  const withoutReservation = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION);
  assert.equal(withoutReservation.length, 1);
  assert.equal(withoutReservation[0].entity.materialType, 'coil');
  assert.deepEqual(report.demands[0].materialBuckets.map(row => [row.diameter, row.materialType]), [
    [12, 'coil'],
    [12, 'straight'],
  ]);
  assert.equal(report.demands[0].materialBuckets[1].diagnostics.length, 0);
  db.close();
});

test('different material released and consumed reservations correlate only within their own bucket', () => {
  for (const status of ['released', 'consumed']) {
    const db = createDb();
    seedDemand(db);
    db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
    db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
    db.prepare("INSERT INTO inventory_reservations VALUES (2,1,1,12,'straight',10,?)").run(status);
    const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE).length, 0);
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length, 1);
    const consumed = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE);
    assert.equal(consumed.length, status === 'consumed' ? 1 : 0);
    if (consumed.length) assert.equal(consumed[0].entity.materialType, 'straight');
    db.close();
  }
});

test('different diameter reservations do not correlate with usage in the same demand', () => {
  for (const status of ['active', 'released', 'consumed']) {
    const db = createDb();
    seedDemand(db);
    db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
    db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
    db.prepare("INSERT INTO inventory_reservations VALUES (2,1,1,16,'coil',10,?)").run(status);
    const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT).length, 0);
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE).length, 0);
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length, 1);
    const consumed = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE);
    assert.equal(consumed.length, status === 'consumed' ? 1 : 0);
    if (consumed.length) assert.equal(consumed[0].entity.diameter, 16);
    db.close();
  }
});

test('same order with different items does not create probable double count', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  seedDemand(db, { orderId: 1, itemId: 2 });
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (2,1,2,12,'coil',10,'active')").run();
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
  assert.deepEqual(rows[0].entity, { rawMaterialId: null, orderId: 1, itemId: 1, diameter: 12, materialType: 'coil' });
  assert.deepEqual(rows[0].evidence, {
    usageCount: 1,
    usageIds: [7],
    usageRowsKg: 10,
    supportingProductionEvidence: [{
      usageId: 7,
      producedQty: 5,
      status: 'הושלם',
      startedAt: '2026-07-18T09:00:00Z',
      completedAt: '2026-07-18T10:00:00Z',
      recognizedStatus: true,
    }],
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
  assert.deepEqual(report.demands[0].supportingProductionEvidence, []);
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
  assert.deepEqual(row.evidence, {
    orderId: 1,
    itemId: 1,
    diameter: 12,
    materialType: 'coil',
    usageIds: [],
    reservationIds: [1],
    reservations: [{ reservationId: 1, reservedKg: 10, status: 'consumed' }],
    consumedReservationKg: 10,
  });
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
  assert.deepEqual(row.evidence, {
    orderId: 1,
    itemId: 1,
    diameter: 12,
    materialType: 'coil',
    usageIds: [1],
    reservationIds: [1],
    reservations: [{ reservationId: 1, reservedKg: 10, status: 'released' }],
    releasedReservationKg: 10,
    usageRowsKg: 10,
  });
  db.close();
});

test('reservation-state diagnostics use usage-row presence even when recorded weight is zero', () => {
  for (const status of [null, 'released', 'consumed']) {
    const db = createDb();
    seedDemand(db);
    db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
    db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,0)').run();
    if (status) db.prepare("INSERT INTO inventory_reservations VALUES (2,1,1,12,'coil',10,?)").run(status);
    const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
    assert.equal(
      diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length,
      status === null ? 1 : 0
    );
    assert.equal(
      diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE).length,
      status === 'released' ? 1 : 0
    );
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE).length, 0);
    assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION).length, 1);
    db.close();
  }
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
  assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
  db.close();
});

test('mismatched usage cannot suppress consumed-without-usage for a valid bucket', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  db.prepare("INSERT INTO orders VALUES (2,'waiting')").run();
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,2,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (2,1,1,12,'coil',10,'consumed')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 1);
  const consumed = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE);
  assert.equal(consumed.length, 1);
  assert.deepEqual(consumed[0].evidence.usageIds, []);
  db.close();
});

test('orphaned reservation cannot suppress usage-without-reservation for valid usage', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (2,1,999,12,'coil',10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION).length, 1);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length, 1);
  db.close();
});

test('invalid-only usage demands remain neutral while retaining mismatch and orphan evidence', () => {
  const scenarios = [
    {
      seed(db) {
        seedDemand(db, { orderId: 1, itemId: 10, itemOrderId: 2 });
        db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
        db.prepare('INSERT INTO raw_material_usage VALUES (6,1,1,10,10)').run();
      },
      code: RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH,
      sourceId: 6,
    },
    {
      seed(db) {
        seedDemand(db);
        db.prepare('INSERT INTO raw_material_usage VALUES (8,999,1,1,10)').run();
      },
      code: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE,
      sourceId: 8,
    },
  ];
  for (const scenario of scenarios) {
    const db = createDb();
    scenario.seed(db);
    const first = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
    const second = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
    assert.deepEqual(second, first);
    const demand = first.demands[0];
    assert.deepEqual(demand.materialBuckets, []);
    assert.equal(demand.usageCount, 0);
    assert.equal(demand.usageRowsKg, 0);
    assert.deepEqual(demand.usageIds, []);
    assert.deepEqual(demand.supportingProductionEvidence, []);
    assert.equal(demand.relationship, 'none');
    assertDemandAggregationInvariant(demand);
    const broken = diagnostics(first, scenario.code);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].evidence.usageId ?? broken[0].evidence.sourceRowId, scenario.sourceId);
    assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
    db.close();
  }
});

test('invalid-only reservation demand remains neutral while retaining mismatch evidence', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 10, itemOrderId: 2 });
  db.prepare("INSERT INTO inventory_reservations VALUES (9,1,10,12,'coil',10,'active')").run();
  const first = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const second = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(second, first);
  const demand = first.demands[0];
  assert.deepEqual(demand.materialBuckets, []);
  assert.equal(demand.reservationCount, 0);
  assert.equal(demand.activeReservationCount, 0);
  assert.equal(demand.activeReservedKg, 0);
  assert.equal(demand.consumedReservationCount, 0);
  assert.equal(demand.consumedReservationKg, 0);
  assert.equal(demand.releasedReservationCount, 0);
  assert.equal(demand.releasedReservationKg, 0);
  assert.equal(demand.unknownReservationCount, 0);
  assert.equal(demand.unknownReservedKg, 0);
  assert.deepEqual(demand.reservationIds, []);
  assert.equal(demand.relationship, 'none');
  assertDemandAggregationInvariant(demand);
  assert.equal(diagnostics(first, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 1);
  assertReadOnly(db, () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }));
  db.close();
});

test('valid and orphaned usage in one apparent demand counts only the valid bucket row', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,5,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,5),(2,999,1,1,7)').run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const demand = report.demands[0];
  assert.equal(demand.usageCount, 1);
  assert.equal(demand.usageRowsKg, 5);
  assert.deepEqual(demand.usageIds, [1]);
  assert.equal(demand.relationship, 'usage_only');
  assert.deepEqual(demand.materialBuckets[0].usageRows.map(row => row.usageId), [1]);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE).length, 1);
  assertDemandAggregationInvariant(demand);
  db.close();
});

test('valid reservation totals exclude a mismatched reservation demand', () => {
  const db = createDb();
  seedDemand(db, { orderId: 1, itemId: 1 });
  db.prepare("INSERT INTO orders VALUES (2,'waiting')").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',4,'active'),(2,2,1,12,'coil',9,'consumed')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const validDemand = report.demands.find(row => row.orderId === 1);
  const invalidDemand = report.demands.find(row => row.orderId === 2);
  assert.equal(validDemand.reservationCount, 1);
  assert.equal(validDemand.activeReservationCount, 1);
  assert.equal(validDemand.activeReservedKg, 4);
  assert.equal(validDemand.relationship, 'reservation_only');
  assert.equal(invalidDemand.reservationCount, 0);
  assert.equal(invalidDemand.consumedReservationCount, 0);
  assert.equal(invalidDemand.consumedReservationKg, 0);
  assert.equal(invalidDemand.relationship, 'none');
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH).length, 1);
  assertDemandAggregationInvariant(validDemand);
  assertDemandAggregationInvariant(invalidDemand);
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

test('three active rows in one exact group preserve all evidence in one review diagnostic', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.prepare("INSERT INTO inventory_reservations VALUES (9,1,1,12,'coil',2,'active'),(3,1,1,12,'coil',3,'active'),(7,1,1,12,'coil',5,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, 'review');
  assert.deepEqual(rows[0].evidence.reservations, [
    { reservationId: 3, reservedKg: 3 },
    { reservationId: 7, reservedKg: 5 },
    { reservationId: 9, reservedKg: 2 },
  ]);
  assert.deepEqual(rows[0].evidence.reservationIds, [3, 7, 9]);
  assert.equal(rows[0].evidence.totalActiveReservedKg, 10);
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

test('unknown reservation status variants remain distinct, visible and excluded from formulas', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  const statuses = [null, '', '   ', 'Active', 'לא ידוע'];
  statuses.forEach((status, index) => {
    db.prepare("INSERT INTO inventory_reservations VALUES (?,1,1,12,'coil',?,?)")
      .run(index + 1, index + 1, status);
  });
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.equal(report.summary.unknownReservationCount, 5);
  assert.equal(report.summary.unknownReservedKg, 15);
  assert.equal(report.demands[0].unknownReservationCount, 5);
  assert.equal(report.demands[0].materialBuckets[0].totals.unknownReservationCount, 5);
  assert.deepEqual(report.demands[0].materialBuckets[0].totals, {
    usageRowsKg: 0,
    activeReservationCount: 0,
    activeReservedKg: 0,
    consumedReservationCount: 0,
    consumedReservationKg: 0,
    releasedReservationCount: 0,
    releasedReservationKg: 0,
    unknownReservationCount: 5,
    unknownReservedKg: 15,
  });
  const rows = diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.UNKNOWN_RESERVATION_STATUS);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => row.evidence.rawStatus), statuses);
  assert.deepEqual(rows.map(row => row.evidence.reservationId), [1, 2, 3, 4, 5]);
  db.close();
});

test('null reservation material type remains a separate unknown physical bucket', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,10,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,10)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (2,1,1,12,NULL,10,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  assert.deepEqual(report.demands[0].materialBuckets.map(row => row.materialType), ['coil', null]);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT).length, 0);
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION).length, 1);
  db.close();
});

test('material buckets expose separate diameters with their own totals', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,5,0,1),(2,16,'coil',100,7,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,5),(2,2,1,1,7)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (3,1,1,12,'coil',4,'active'),(4,1,1,16,'coil',6,'active')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const demand = report.demands[0];
  assert.deepEqual(demand.materialBuckets.map(bucket => ({
    diameter: bucket.diameter,
    usageRowsKg: bucket.totals.usageRowsKg,
    activeReservedKg: bucket.totals.activeReservedKg,
  })), [
    { diameter: 12, usageRowsKg: 5, activeReservedKg: 4 },
    { diameter: 16, usageRowsKg: 7, activeReservedKg: 6 },
  ]);
  assertDemandAggregationInvariant(demand);
  db.close();
});

test('one consumed and one active reservation do not form a duplicate active group', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',4,'active'),(2,1,1,12,'coil',6,'consumed')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const demand = report.demands[0];
  assert.equal(diagnostics(report, RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION).length, 0);
  assert.equal(demand.activeReservationCount, 1);
  assert.equal(demand.activeReservedKg, 4);
  assert.equal(demand.consumedReservationCount, 1);
  assert.equal(demand.consumedReservationKg, 6);
  assertDemandAggregationInvariant(demand);
  db.close();
});

test('demand operational summaries equal independent sums across multiple lifecycle buckets', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,5,0,1),(2,16,'straight',100,7,0,1)").run();
  db.prepare('INSERT INTO raw_material_usage VALUES (1,1,1,1,5),(2,2,1,1,7)').run();
  db.prepare("INSERT INTO inventory_reservations VALUES (1,1,1,12,'coil',2,'active'),(2,1,1,12,'coil',3,'consumed'),(3,1,1,16,'straight',4,'released'),(4,1,1,16,'straight',5,'mystery')").run();
  const report = buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK });
  const demand = report.demands[0];
  assertDemandAggregationInvariant(demand);
  assert.deepEqual({
    usageCount: demand.usageCount,
    usageRowsKg: demand.usageRowsKg,
    reservationCount: demand.reservationCount,
    activeReservationCount: demand.activeReservationCount,
    activeReservedKg: demand.activeReservedKg,
    consumedReservationCount: demand.consumedReservationCount,
    consumedReservationKg: demand.consumedReservationKg,
    releasedReservationCount: demand.releasedReservationCount,
    releasedReservationKg: demand.releasedReservationKg,
    unknownReservationCount: demand.unknownReservationCount,
    unknownReservedKg: demand.unknownReservedKg,
    relationship: demand.relationship,
  }, {
    usageCount: 2,
    usageRowsKg: 12,
    reservationCount: 4,
    activeReservationCount: 1,
    activeReservedKg: 2,
    consumedReservationCount: 1,
    consumedReservationKg: 3,
    releasedReservationCount: 1,
    releasedReservationKg: 4,
    unknownReservationCount: 1,
    unknownReservedKg: 5,
    relationship: 'usage_and_reservation',
  });
  assert.deepEqual(demand.supportingProductionEvidence.map(row => row.usageId), [1, 2]);
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
  assert.deepEqual(first.demands[0].supportingProductionEvidence.map(row => row.usageId), [1, 2]);
  const derivedCounts = first.diagnostics.reduce((counts, row) => {
    counts[row.code] = (counts[row.code] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(first.summary.diagnosticCounts, Object.fromEntries(
    Object.entries(derivedCounts).sort(([left], [right]) => left.localeCompare(right, 'en'))
  ));
  assertReadOnly(firstDb, () => {
    buildRawMaterialReconciliationReport(firstDb, { clock: FIXED_CLOCK });
    buildRawMaterialReconciliationReport(firstDb, { clock: FIXED_CLOCK });
  });
  firstDb.close();
  secondDb.close();
});

test('schema failure after read-only queries leaves existing tables unchanged', () => {
  const db = createDb();
  seedDemand(db);
  db.prepare("INSERT INTO raw_material VALUES (1,12,'coil',100,0,0,1)").run();
  db.exec('DROP TABLE inventory_reservations');
  const before = {
    raw: db.prepare('SELECT * FROM raw_material ORDER BY id').all(),
    orders: db.prepare('SELECT * FROM orders ORDER BY id').all(),
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    usage: db.prepare('SELECT * FROM raw_material_usage ORDER BY id').all(),
    changes: db.prepare('SELECT total_changes() AS count').get().count,
  };
  assert.throws(
    () => buildRawMaterialReconciliationReport(db, { clock: FIXED_CLOCK }),
    /no such table: inventory_reservations/
  );
  const after = {
    raw: db.prepare('SELECT * FROM raw_material ORDER BY id').all(),
    orders: db.prepare('SELECT * FROM orders ORDER BY id').all(),
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    usage: db.prepare('SELECT * FROM raw_material_usage ORDER BY id').all(),
    changes: db.prepare('SELECT total_changes() AS count').get().count,
  };
  assert.deepEqual(after, before);
  db.close();
});
