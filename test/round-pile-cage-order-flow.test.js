const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { ensureCoreSchema } = require('../db/coreSchema');
const { runCoreMigrations } = require('../db/startup');
const industry = require('../modules/steel-rebar');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');
const { createOrderFactory } = require('../services/orders');
const productionCards = require('../services/productionCards');
const delivery = require('../routes/orderDeliveryCertificate')._test;

function cageSnapshot(overrides = {}) {
  return calculatePileCage({
    shapeId: 'order-flow-pile-cage',
    roundPileCage: true,
    pileDiameterMm: 600,
    pileLengthMm: 12000,
    longitudinalBars: {
      totalBars: 10,
      defaultDiameterMm: 20,
      defaultLengthMm: 12000,
      pattern: [{ type: 'straight', lengthMm: 12000 }, { type: 'L', lengthMm: 12000, bendLengthMm: 200 }],
    },
    spiral: {
      barDiameterMm: 8,
      outerDiameterMm: 480,
      pitchMode: 'zones',
      zones: [{ name: 'A', lengthMm: 3000, pitchMm: 150 }, { name: 'B', lengthMm: 2000, noWrap: true }, { name: 'C', lengthMm: 7000, pitchMm: 200 }],
    },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
    ...overrides,
  });
}

test('order persistence stores physical cage length and complete five-card assembly weight', () => {
  const db = new Database(':memory:');
  try {
    ensureCoreSchema(db);
    runCoreMigrations(db);
    const snapshot = cageSnapshot();
    const service = createOrderFactory(db, { generateOrderNum: () => 'PILE-ORDER-1', industry });
    service.createOrderFromPayload({
      customer: { name: 'Pile test' },
      order: {},
      pallets: [{ items: [{ shapeSnapshot: snapshot, shapeName: 'generic bar', diameter: 20, qty: 2 }] }],
    });
    const item = db.prepare('SELECT shape_name,total_length_mm,quantity,weight_per_unit,total_weight,segments,shape_snapshot_json FROM items').get();
    assert.equal(item.shape_name, 'PILE CAGE');
    assert.equal(item.total_length_mm, 12000);
    assert.equal(item.quantity, 2);
    assert.equal(item.weight_per_unit, 344.52);
    assert.equal(item.total_weight, 689.04);
    assert.deepEqual(JSON.parse(item.segments), []);
    assert.equal(JSON.parse(item.shape_snapshot_json).shapeType, 'round_pile_cage');
  } finally {
    db.close();
  }
});

test('delivery metrics ignore corrupt generic stored values and use canonical cage assembly', () => {
  const snapshot = cageSnapshot();
  const item = {
    quantity: 2,
    diameter: 20,
    total_length_mm: 215590,
    total_weight: 29.64,
    shape_name: 'straight',
    shape_snapshot_json: JSON.stringify(snapshot),
  };
  const metrics = delivery.roundPileCageDeliveryMetrics(item);
  assert.deepEqual(metrics, {
    isRoundPileCage: true,
    totalLengthMm: 12000,
    totalWeightKg: 689.04,
    unitWeightKg: 344.52,
    pileDiameterMm: 600,
    quantity: 2,
  });
  assert.deepEqual(delivery.deliveryItemMetrics(item, industry), metrics);
  assert.equal(delivery.deliverySectionKey(item, [{ length_mm: 215590, angle_deg: 0 }]), 'cage');
  const svg = productionCards.itemShapeSvg(item);
  assert.match(svg, /aria-label="PILE CAGE"/);
  assert.doesNotMatch(svg, /data-shape-kind="generic-bar"/);
});

test('invalid pile cage fails closed instead of falling back to one generic bar weight', () => {
  const invalid = cageSnapshot({ hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420 } });
  assert.equal(invalid.validation.ok, false);
  const item = { quantity: 1, total_length_mm: 12000, total_weight: 29.64, shape_snapshot_json: JSON.stringify(invalid) };
  assert.throws(() => delivery.deliveryItemMetrics(item, industry), /invalid_round_pile_cage_assembly_metrics/);
});
