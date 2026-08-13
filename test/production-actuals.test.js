const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const productionActuals = require('../services/productionActuals');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  ensureCoreSchema(db);
  return db;
}

function seedItem(db, id, { machine = 'A', totalWeight = 999, actualWeight = null, completedAt = null, status = 'הושלם' } = {}) {
  db.prepare(`
    INSERT INTO items (id, machine, total_weight, actual_weight_kg, status, completed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, machine, totalWeight, actualWeight, status, completedAt);
}

test('daily actual production uses the append-only reported-weight ledger and never planned item weight', () => {
  const db = createDb();
  try {
    seedItem(db, 1, { totalWeight: 5000 });
    productionActuals.recordActualWeightChange(db, {
      itemId: 1,
      beforeKg: 0,
      afterKg: 50,
      source: 'production_card_weight',
      occurredAt: '2026-08-13T07:00:00.000Z',
    });
    productionActuals.recordActualWeightChange(db, {
      itemId: 1,
      beforeKg: 50,
      afterKg: 70,
      source: 'production_card_weight',
      occurredAt: '2026-08-13T08:00:00.000Z',
    });

    const august13 = productionActuals.getDailyProductionActuals(db, '2026-08-13');
    assert.equal(august13.actual_weight_kg, 70);
    assert.equal(august13.actual_tons, 0.07);
    assert.equal(august13.item_count, 1);
    assert.equal(august13.source_breakdown.production_event_kg, 70);
    assert.equal(august13.machines[0].machine, 'A');
    assert.equal(august13.machines[0].weight_kg, 70);
    assert.equal(august13.items.length, 1);
    assert.equal(august13.items[0].source, 'production_event');
    assert.equal(august13.items[0].estimated, false);

    // A later correction is recorded on the date it was reported; it does not
    // silently rewrite the amount reported on 13/8.
    productionActuals.recordActualWeightChange(db, {
      itemId: 1,
      beforeKg: 70,
      afterKg: 60,
      source: 'production_card_weight',
      occurredAt: '2026-08-14T07:00:00.000Z',
    });
    assert.equal(productionActuals.getDailyProductionActuals(db, '2026-08-13').actual_weight_kg, 70);
    assert.equal(productionActuals.getDailyProductionActuals(db, '2026-08-14').actual_weight_kg, -10);
  } finally {
    db.close();
  }
});

test('historical card reports use saved measured cards in Israel day boundaries and deduplicate item actual weight', () => {
  const db = createDb();
  try {
    // 22:30 UTC on 12/8 is 01:30 on 13/8 in Israel daylight saving time.
    db.prepare('INSERT INTO orders (id, order_num) VALUES (?, ?)').run(1, 'ACTUAL-HISTORICAL');
    seedItem(db, 1, { actualWeight: 42, completedAt: '2026-08-12T22:30:00.000Z', totalWeight: 4000 });
    db.prepare(`
      INSERT INTO production_card_weights
        (order_id,item_id,card_index,card_total,card_qty,target_weight_kg,actual_weight_kg,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(1, 1, 1, 1, 1, 4000, 42, '2026-08-12 22:30:00');

    const august13 = productionActuals.getDailyProductionActuals(db, '2026-08-13');
    assert.equal(august13.actual_weight_kg, 42);
    assert.equal(august13.item_count, 1);
    assert.equal(august13.source_breakdown.legacy_card_snapshot_kg, 42);
    assert.equal(august13.source_breakdown.completed_item_actual_kg, 0);
    assert.equal(august13.unweighed_completed_items, 0);
  } finally {
    db.close();
  }
});

test('completed items without a measured weight use their saved theoretical weight as an explicit estimate', () => {
  const db = createDb();
  try {
    seedItem(db, 1, { actualWeight: null, completedAt: '2026-08-13T08:00:00.000Z', totalWeight: 12000 });
    const august13 = productionActuals.getDailyProductionActuals(db, '2026-08-13');
    assert.equal(august13.actual_weight_kg, 12000);
    assert.equal(august13.item_count, 1);
    assert.equal(august13.estimated_completed_items, 1);
    assert.equal(august13.source_breakdown.completed_item_theoretical_kg, 12000);
    assert.equal(august13.items[0].source, 'completed_item_theoretical');
    assert.equal(august13.items[0].estimated, true);
    assert.equal(august13.unweighed_completed_items, 0);
  } finally {
    db.close();
  }
});

test('completed items with neither measured nor theoretical weight remain visibly unweighed', () => {
  const db = createDb();
  try {
    seedItem(db, 1, { actualWeight: null, completedAt: '2026-08-13T08:00:00.000Z', totalWeight: 0 });
    const august13 = productionActuals.getDailyProductionActuals(db, '2026-08-13');
    assert.equal(august13.actual_weight_kg, 0);
    assert.equal(august13.item_count, 0);
    assert.equal(august13.estimated_completed_items, 0);
    assert.equal(august13.unweighed_completed_items, 1);
  } finally {
    db.close();
  }
});

test('production series includes every requested calendar day', () => {
  const db = createDb();
  try {
    seedItem(db, 1);
    productionActuals.recordActualWeightChange(db, {
      itemId: 1,
      beforeKg: 0,
      afterKg: 12.345,
      source: 'production_item_patch',
      occurredAt: '2026-08-13T10:00:00.000Z',
    });
    const series = productionActuals.getProductionActualSeries(db, '2026-08-12', '2026-08-14');
    assert.deepEqual(series.map(row => row.date), ['2026-08-12', '2026-08-13', '2026-08-14']);
    assert.deepEqual(series.map(row => row.actual_weight_kg), [0, 12.345, 0]);
  } finally {
    db.close();
  }
});

test('actual-output ledger rejects an invalid measured weight instead of treating it as zero', () => {
  const db = createDb();
  try {
    seedItem(db, 1);
    assert.throws(() => productionActuals.recordActualWeightChange(db, {
      itemId: 1,
      beforeKg: 0,
      afterKg: 'not-a-weight',
      source: 'production_item_patch',
    }), /invalid actual production weight/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM production_output_events').get().count, 0);
  } finally {
    db.close();
  }
});
