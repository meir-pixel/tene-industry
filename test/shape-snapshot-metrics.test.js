const assert = require('node:assert/strict');
const test = require('node:test');

const { itemShapeMetrics } = require('../services/shapeSnapshot');

function snapshotWith(calculated) {
  return JSON.stringify({
    contractVersion: 2,
    shapeVersion: '1.0',
    shapeId: 'test-shape',
    shapeType: 'closed_stirrup',
    family: 'stirrups',
    data: {},
    calculated,
    machineOutput: {},
    validation: { valid: true },
  });
}

test('snapshot unit weight is multiplied by item quantity', () => {
  const metrics = itemShapeMetrics({
    quantity: 16,
    shape_snapshot_json: snapshotWith({ weightKg: 0.8625, totalLengthMm: 1400 }),
  });
  assert.equal(metrics.unitWeightKg, 0.8625);
  assert.ok(Math.abs(metrics.totalWeightKg - 13.8) < 0.001);
});

test('snapshot total weight is never multiplied by quantity again', () => {
  // Order-screen snapshots store only totalWeightKg for the whole quantity;
  // the old code treated it as a unit weight and inflated totals by quantity.
  const metrics = itemShapeMetrics({
    quantity: 16,
    shape_snapshot_json: snapshotWith({ totalWeightKg: 13.8, totalLengthMm: 1400 }),
  });
  assert.ok(Math.abs(metrics.totalWeightKg - 13.8) < 0.001, `expected 13.8, got ${metrics.totalWeightKg}`);
  assert.ok(Math.abs(metrics.unitWeightKg - 0.8625) < 0.001);
});

test('snapshot with unit and matching total resolves to unit x quantity', () => {
  const metrics = itemShapeMetrics({
    quantity: 16,
    shape_snapshot_json: snapshotWith({ weightKg: 0.8625, totalWeightKg: 13.8 }),
  });
  assert.ok(Math.abs(metrics.totalWeightKg - 13.8) < 0.001);
});

test('mirrored equal unit/total fields are treated as a total', () => {
  // Some editor snapshots copy the same number into both fields.
  const metrics = itemShapeMetrics({
    quantity: 16,
    shape_snapshot_json: snapshotWith({ weightKg: 13.8, totalWeightKg: 13.8 }),
  });
  assert.ok(Math.abs(metrics.totalWeightKg - 13.8) < 0.001, `expected 13.8, got ${metrics.totalWeightKg}`);
});

test('without a snapshot, weight_per_unit x quantity wins, then total_weight', () => {
  const fromUnit = itemShapeMetrics({ quantity: 4, weight_per_unit: 2.5 });
  assert.equal(fromUnit.totalWeightKg, 10);

  const fromTotal = itemShapeMetrics({ quantity: 4, total_weight: 11.5 });
  assert.equal(fromTotal.totalWeightKg, 11.5);
});
