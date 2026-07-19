'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { ensureCoreSchema } = require('../db/coreSchema');
const { runCoreMigrations } = require('../db/startup');
const {
  MaterialRequirementValidationError,
  normalizeMaterialRequirementInput,
  createMaterialRequirementV2,
  getMaterialRequirementV2ByItem,
  listMaterialRequirementsV2ForOrder,
} = require('../services/materialRequirementV2');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureCoreSchema(db);
  return db;
}

function seedOrderItem(db, { orderId = 1, itemId = 1, lifecycleVersion = 2, orderNum = `ORD-${orderId}` } = {}) {
  db.prepare('INSERT INTO orders (id, order_num, inventory_lifecycle_version) VALUES (?, ?, ?)')
    .run(orderId, orderNum, lifecycleVersion);
  db.prepare('INSERT INTO items (id, order_id, diameter, total_weight) VALUES (?, ?, 12, 100)')
    .run(itemId, orderId);
}

function validInput(overrides = {}) {
  return {
    requirement_uid: 'req-1',
    order_id: 1,
    item_id: 1,
    lifecycle_version: 2,
    diameter: 12,
    material_type: 'coil',
    required_kg: 100,
    need_by_date: '2026-08-15',
    need_by_source: 'order_delivery_date',
    priority_snapshot: 'רגיל',
    status: 'open',
    source: 'order_item',
    source_revision: 'item-1',
    ...overrides,
  };
}

function assertValidationCode(action, code) {
  assert.throws(action, error => error instanceof MaterialRequirementValidationError && error.code === code);
}

test('fresh and migrated schemas contain the additive lifecycle-v2 foundation', () => {
  const db = createDb();
  const orderColumns = db.pragma('table_info(orders)').map(row => row.name);
  const requirementColumns = db.pragma('table_info(material_requirements_v2)').map(row => row.name);
  assert.ok(orderColumns.includes('inventory_lifecycle_version'));
  assert.deepEqual(requirementColumns, [
    'id', 'requirement_uid', 'order_id', 'item_id', 'lifecycle_version', 'diameter', 'material_type',
    'required_kg', 'need_by_date', 'need_by_source', 'priority_snapshot', 'status', 'source',
    'source_revision', 'created_at', 'updated_at',
  ]);
  assert.doesNotThrow(() => runCoreMigrations(db));
  assert.doesNotThrow(() => runCoreMigrations(db));
  db.close();
});

test('core startup upgrades a legacy orders table without changing its existing rows', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orders (id INTEGER PRIMARY KEY, order_num TEXT UNIQUE NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY, order_id INTEGER);
    INSERT INTO orders (id,order_num) VALUES (7,'legacy-seven');
    INSERT INTO items (id,order_id) VALUES (9,7);
  `);
  ensureCoreSchema(db);
  assert.deepEqual(
    db.prepare('SELECT id,order_num,inventory_lifecycle_version FROM orders WHERE id=7').get(),
    { id: 7, order_num: 'legacy-seven', inventory_lifecycle_version: 1 }
  );
  assert.deepEqual(db.prepare('SELECT id,order_id FROM items WHERE id=9').get(), { id: 9, order_id: 7 });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='material_requirements_v2'").get());
  db.close();
});

test('existing orders keep lifecycle version 1 and startup is additive and idempotent', () => {
  const db = createDb();
  db.prepare("INSERT INTO orders (id, order_num) VALUES (1, 'legacy-1')").run();
  db.prepare('INSERT INTO items (id, order_id, diameter, total_weight) VALUES (1, 1, 12, 75)').run();
  db.prepare("INSERT INTO inventory_reservations (order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (1,1,12,'coil',75,'active')").run();
  const before = {
    order: db.prepare('SELECT id,order_num,inventory_lifecycle_version FROM orders WHERE id=1').get(),
    item: db.prepare('SELECT id,order_id,diameter,total_weight FROM items WHERE id=1').get(),
    reservation: db.prepare('SELECT order_id,item_id,diameter,material_type,reserved_kg,status FROM inventory_reservations').get(),
  };
  runCoreMigrations(db);
  runCoreMigrations(db);
  assert.deepEqual({
    order: db.prepare('SELECT id,order_num,inventory_lifecycle_version FROM orders WHERE id=1').get(),
    item: db.prepare('SELECT id,order_id,diameter,total_weight FROM items WHERE id=1').get(),
    reservation: db.prepare('SELECT order_id,item_id,diameter,material_type,reserved_kg,status FROM inventory_reservations').get(),
  }, before);
  assert.equal(before.order.inventory_lifecycle_version, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 0);
  db.close();
});

test('normal order inserts remain lifecycle-v1 and do not create V2 requirements', () => {
  const db = createDb();
  db.prepare("INSERT INTO orders (order_num) VALUES ('normal-order')").run();
  assert.equal(db.prepare("SELECT inventory_lifecycle_version FROM orders WHERE order_num='normal-order'").get().inventory_lifecycle_version, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 0);

  const productionFiles = ['services/orders.js', 'routes/orders.js', 'routes/inventory.js', 'routes/production.js'];
  for (const relative of productionFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
    assert.doesNotMatch(source, /materialRequirementV2|material_requirements_v2/);
  }
  db.close();
});

test('normalization accepts primitive numbers and trimmed decimal strings without mutating input', () => {
  const input = validInput({ diameter: ' 12.5 ', required_kg: ' 100.25 ', material_type: ' STRAIGHT ' });
  const before = structuredClone(input);
  const normalized = normalizeMaterialRequirementInput(input);
  assert.equal(normalized.diameter, 12.5);
  assert.equal(normalized.required_kg, 100.25);
  assert.equal(normalized.material_type, 'straight');
  assert.deepEqual(input, before);
});

test('normalization rejects missing, non-positive, non-finite and non-primitive quantities', () => {
  const invalid = [undefined, null, '', 0, -1, NaN, Infinity, 'Infinity', '0x10', Buffer.from('12'), [], {}, true, new Number(12)];
  for (const value of invalid) {
    assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ diameter: value })), 'invalid_diameter');
    assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ required_kg: value })), 'invalid_required_kg');
  }
});

test('normalization requires explicit supported material type', () => {
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ material_type: undefined })), 'invalid_material_type');
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ material_type: 'bent' })), 'invalid_material_type');
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ material_type: Buffer.from('coil') })), 'invalid_material_type');
});

test('need-by dates and provenance are validated deterministically', () => {
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ need_by_date: '2026-02-30' })), 'invalid_need_by_date');
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ need_by_date: '15/08/2026' })), 'invalid_need_by_date');
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ need_by_date: null })), 'need_by_source_without_date');
  assertValidationCode(() => normalizeMaterialRequirementInput(validInput({ need_by_source: 'unknown' })), 'need_by_date_without_provenance');
  const undated = normalizeMaterialRequirementInput(validInput({ need_by_date: null, need_by_source: 'unknown' }));
  assert.equal(undated.need_by_date, null);
});

test('lifecycle-v1 orders cannot receive a V2 requirement', () => {
  const db = createDb();
  seedOrderItem(db, { lifecycleVersion: 1 });
  assertValidationCode(() => createMaterialRequirementV2(db, validInput()), 'order_not_lifecycle_v2');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 0);
  db.close();
});

test('a lifecycle-v2 order with a matching item receives one requirement', () => {
  const db = createDb();
  seedOrderItem(db);
  const row = createMaterialRequirementV2(db, validInput());
  assert.equal(row.requirement_uid, 'req-1');
  assert.equal(row.lifecycle_version, 2);
  assert.equal(getMaterialRequirementV2ByItem(db, { order_id: 1, item_id: 1 }).id, row.id);
  db.close();
});

test('direct-only, pallet-only and consistent dual item ownership resolve to the requested order', () => {
  const db = createDb();
  db.prepare('INSERT INTO orders (id, order_num, inventory_lifecycle_version) VALUES (1, ?, 2), (2, ?, 2)')
    .run('ORD-1', 'ORD-2');
  db.prepare('INSERT INTO pallets (id, order_id) VALUES (10, 1)').run();
  db.prepare('INSERT INTO items (id, order_id, diameter, total_weight) VALUES (1, 1, 12, 100)').run();
  db.prepare('INSERT INTO items (id, pallet_id, diameter, total_weight) VALUES (2, 10, 12, 100)').run();
  db.prepare('INSERT INTO items (id, order_id, pallet_id, diameter, total_weight) VALUES (3, 1, 10, 12, 100)').run();

  for (const itemId of [1, 2, 3]) {
    const row = createMaterialRequirementV2(db, validInput({ requirement_uid: `req-${itemId}`, item_id: itemId }));
    assert.equal(row.order_id, 1);
    assert.equal(row.item_id, itemId);
  }
  db.close();
});

test('conflicting direct and pallet ownership rejects either requested owner without creating a requirement', () => {
  const db = createDb();
  db.prepare('INSERT INTO orders (id, order_num, inventory_lifecycle_version) VALUES (1, ?, 2), (2, ?, 2)')
    .run('ORD-1', 'ORD-2');
  db.prepare('INSERT INTO pallets (id, order_id) VALUES (10, 2)').run();
  db.prepare('INSERT INTO items (id, order_id, pallet_id, diameter, total_weight) VALUES (1, 1, 10, 12, 100)').run();

  for (const orderId of [1, 2]) {
    let error;
    try {
      createMaterialRequirementV2(db, validInput({ requirement_uid: `conflict-${orderId}`, order_id: orderId }));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof MaterialRequirementValidationError);
    assert.equal(error.code, 'item_order_ownership_conflict');
    assert.deepEqual(error.details, { itemId: 1, requestedOrderId: orderId, directOrderId: 1, palletId: 10, palletOrderId: 2 });
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 0);
  db.close();
});

test('missing orders, missing items and item/order mismatches are rejected', () => {
  const db = createDb();
  assertValidationCode(() => createMaterialRequirementV2(db, validInput()), 'order_not_found');
  seedOrderItem(db, { orderId: 1, itemId: 1 });
  assertValidationCode(() => createMaterialRequirementV2(db, validInput({ item_id: 999 })), 'item_not_found');
  seedOrderItem(db, { orderId: 2, itemId: 2, orderNum: 'ORD-2' });
  assertValidationCode(() => createMaterialRequirementV2(db, validInput({ item_id: 2 })), 'item_order_mismatch');
  db.close();
});

test('same UID and identical normalized payload is idempotent', () => {
  const db = createDb();
  seedOrderItem(db);
  const first = createMaterialRequirementV2(db, validInput());
  const replay = createMaterialRequirementV2(db, validInput({ diameter: '12', required_kg: '100.0' }));
  assert.equal(replay.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 1);
  db.close();
});

test('a same-UID replay fails if item ownership becomes conflicting and leaves the requirement unchanged', () => {
  const db = createDb();
  db.prepare('INSERT INTO orders (id, order_num, inventory_lifecycle_version) VALUES (1, ?, 2), (2, ?, 2)')
    .run('ORD-1', 'ORD-2');
  db.prepare('INSERT INTO pallets (id, order_id) VALUES (10, 1)').run();
  db.prepare('INSERT INTO items (id, order_id, pallet_id, diameter, total_weight) VALUES (1, 1, 10, 12, 100)').run();
  createMaterialRequirementV2(db, validInput());
  const before = db.prepare('SELECT * FROM material_requirements_v2 WHERE requirement_uid=?').get('req-1');
  db.prepare('UPDATE pallets SET order_id=2 WHERE id=10').run();

  assertValidationCode(() => createMaterialRequirementV2(db, validInput()), 'item_order_ownership_conflict');
  assert.deepEqual(db.prepare('SELECT * FROM material_requirements_v2 WHERE requirement_uid=?').get('req-1'), before);
  db.close();
});

test('conflicting UID replay and another current requirement fail deterministically', () => {
  const db = createDb();
  seedOrderItem(db);
  createMaterialRequirementV2(db, validInput());
  assertValidationCode(() => createMaterialRequirementV2(db, validInput({ required_kg: 101 })), 'requirement_uid_conflict');
  assertValidationCode(() => createMaterialRequirementV2(db, validInput({ requirement_uid: 'req-2' })), 'current_requirement_exists');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM material_requirements_v2').get().count, 1);
  db.close();
});

test('listing by order is deterministic', () => {
  const db = createDb();
  seedOrderItem(db, { orderId: 1, itemId: 2 });
  db.prepare('INSERT INTO items (id, order_id, diameter, total_weight) VALUES (1, 1, 10, 50)').run();
  createMaterialRequirementV2(db, validInput({ requirement_uid: 'req-2', item_id: 2 }));
  createMaterialRequirementV2(db, validInput({ requirement_uid: 'req-1', item_id: 1, diameter: 10, required_kg: 50 }));
  assert.deepEqual(listMaterialRequirementsV2ForOrder(db, 1).map(row => row.item_id), [1, 2]);
  db.close();
});

test('requirement creation does not modify inventory usage, reservations or raw-material counters', () => {
  const db = createDb();
  seedOrderItem(db);
  db.prepare("INSERT INTO raw_material (id,diameter,material_type,weight_received,weight_used,weight_scrapped) VALUES (1,12,'coil',500,25,5)").run();
  db.prepare("INSERT INTO raw_material_usage (id,raw_material_id,order_id,item_id,weight_used) VALUES (1,1,1,1,25)").run();
  db.prepare("INSERT INTO inventory_reservations (id,order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (1,1,1,12,'coil',100,'active')").run();
  const before = {
    raw: db.prepare('SELECT * FROM raw_material WHERE id=1').get(),
    usage: db.prepare('SELECT * FROM raw_material_usage WHERE id=1').get(),
    reservation: db.prepare('SELECT * FROM inventory_reservations WHERE id=1').get(),
  };
  createMaterialRequirementV2(db, validInput());
  assert.deepEqual({
    raw: db.prepare('SELECT * FROM raw_material WHERE id=1').get(),
    usage: db.prepare('SELECT * FROM raw_material_usage WHERE id=1').get(),
    reservation: db.prepare('SELECT * FROM inventory_reservations WHERE id=1').get(),
  }, before);
  db.close();
});
