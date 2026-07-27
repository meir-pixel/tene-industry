'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const planning = require('../services/materialAllocationPlanningV2');

function createDb() { const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); ensureCoreSchema(db); return db; }
function seed(db, { lifecycle = 2, required = 100, material = 'coil' } = {}) {
  db.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,?,?)').run('B2-1', lifecycle);
  db.prepare("INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,12,100)").run();
  db.prepare('INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (1,?,?,?,?,?,?,?,?,?,?,?)')
    .run('req-1',1,1,2,12,material,required,'unknown','open','manual','rev-1');
}
function lot(db, id, weight, { verified = 'approved', material = 'coil' } = {}) {
  db.prepare('INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (?,?,?,?,?,1)').run(id,12,material,weight,verified);
}
test('suggestion is FIFO and confirmation supports partial and zero plans without stock consumption', () => {
  const db = createDb(); seed(db); lot(db, 2, 40); lot(db, 3, 90);
  assert.deepEqual(planning.suggestFifoLots(db, { material_requirement_id: 1 }).lines, [{ raw_material_id: 2, allocated_kg: 40 }, { raw_material_id: 3, allocated_kg: 60 }]);
  const partial = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'partial', lines: [{ raw_material_id: 2, allocated_kg: 40 }] });
  assert.equal(partial.uncovered_kg, 60);
  assert.equal(db.prepare('SELECT weight_used FROM raw_material WHERE id=2').get().weight_used, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM raw_material_usage').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n, 0);
  planning.releaseAllocationPlan(db, { allocation_plan_id: partial.id });
  const zero = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'zero', lines: [] });
  assert.equal(zero.uncovered_kg, 100); db.close();
});
test('only active verified matching lots can be confirmed and over-allocation is blocked', () => {
  const db = createDb(); seed(db); lot(db, 2, 50, { verified: 'pending_verification' }); lot(db, 3, 50, { material: 'straight' }); lot(db, 4, 50);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad', lines: [{ raw_material_id: 2, allocated_kg: 1 }] }), /invalid_allocation_lot/);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad2', lines: [{ raw_material_id: 3, allocated_kg: 1 }] }), /invalid_allocation_lot/);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad3', lines: [{ raw_material_id: 4, allocated_kg: 51 }] }), /over_allocation/);
  db.close();
});
test('idempotency is safe and lifecycle-v1 is fail-closed', () => {
  const db = createDb(); seed(db); lot(db, 2, 100);
  const first = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'same', lines: [{ raw_material_id: 2, allocated_kg: 10 }] });
  const replay = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'same', lines: [{ raw_material_id: 2, allocated_kg: 10 }] });
  assert.equal(first.id, replay.id);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'same', lines: [] }), /idempotency_key_conflict/);
  const other = createDb(); seed(other, { lifecycle: 1 }); lot(other, 2, 100);
  assert.throws(() => planning.confirmAllocationPlan(other, { material_requirement_id: 1, idempotency_key: 'v1', lines: [] }), /lifecycle_v2_required/);
  db.close(); other.close();
});
