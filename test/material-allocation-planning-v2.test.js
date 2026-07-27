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
function lot(db, id, weight, { verified = 'approved', material = 'coil', active = 1 } = {}) {
  db.prepare('INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (?,?,?,?,?,?)').run(id,12,material,weight,verified,active);
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
  const db = createDb(); seed(db); lot(db, 2, 50, { verified: 'pending_verification' }); lot(db, 3, 50, { material: 'straight' }); lot(db, 4, 50); lot(db, 5, 50, { active: 0 });
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad', lines: [{ raw_material_id: 2, allocated_kg: 1 }] }), /invalid_allocation_lot/);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad2', lines: [{ raw_material_id: 3, allocated_kg: 1 }] }), /invalid_allocation_lot/);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad3', lines: [{ raw_material_id: 4, allocated_kg: 51 }] }), /over_allocation/);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'bad4', lines: [{ raw_material_id: 5, allocated_kg: 1 }] }), /invalid_allocation_lot/);
  db.close();
});
test('full plans, one active plan, and competing requirements cannot over-allocate one lot', () => {
  const db = createDb(); seed(db); lot(db, 2, 100);
  const full = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'full', lines: [{ raw_material_id: 2, allocated_kg: 100 }] });
  assert.equal(full.uncovered_kg, 0);
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'second-plan', lines: [] }), /active_allocation_plan_exists/);
  db.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (2,?,2)').run('B2-2');
  db.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (2,2,12,100)').run();
  db.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (2,'req-2',2,2,2,12,'coil',1,'unknown','open','manual','rev-1')").run();
  assert.throws(() => planning.confirmAllocationPlan(db, { material_requirement_id: 2, idempotency_key: 'competing', lines: [{ raw_material_id: 2, allocated_kg: 1 }] }), /over_allocation/);
  db.close();
});
test('reconciliation preserves increases, releases reductions in reverse order, and supersedes changed specifications', () => {
  const db = createDb(); seed(db); lot(db, 2, 60); lot(db, 3, 60);
  const plan = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'original', lines: [{ raw_material_id: 2, allocated_kg: 60 }, { raw_material_id: 3, allocated_kg: 40 }] });
  db.prepare("UPDATE material_requirements_v2 SET required_kg=120,source_revision='rev-2' WHERE id=1").run();
  const increased = planning.reconcileAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'increase' });
  assert.equal(increased.status, 'active'); assert.equal(increased.uncovered_kg, 20);
  db.prepare("UPDATE material_requirements_v2 SET required_kg=70,source_revision='rev-3' WHERE id=1").run();
  const reduced = planning.reconcileAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'reduce' });
  assert.equal(reduced.uncovered_kg, 0);
  assert.deepEqual(reduced.lines.map(line => [line.raw_material_id, line.allocated_kg, line.status]), [[2, 60, 'active'], [3, 10, 'active']]);
  db.prepare("UPDATE material_requirements_v2 SET material_type='straight',source_revision='rev-4' WHERE id=1").run();
  const superseded = planning.reconcileAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'spec-change' });
  assert.equal(superseded.status, 'superseded'); assert.ok(superseded.lines.every(line => line.status === 'released'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocation_plan_events_v2 WHERE allocation_plan_id=?').get(plan.id).n, 3);
  db.close();
});
test('reconciliation cancels plans, audits once, and rejects conflicting idempotency keys', () => {
  const db = createDb(); seed(db); lot(db, 2, 100);
  const plan = planning.confirmAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'cancel-plan', lines: [{ raw_material_id: 2, allocated_kg: 20 }] });
  db.prepare("UPDATE material_requirements_v2 SET status='cancelled' WHERE id=1").run();
  const cancelled = planning.reconcileAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'cancel-reconcile' });
  const replay = planning.reconcileAllocationPlan(db, { material_requirement_id: 1, idempotency_key: 'cancel-reconcile' });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(replay.id, plan.id); assert.ok(cancelled.lines.every(line => line.status === 'released'));
  assert.throws(() => planning.reconcileAllocationPlan(db, { material_requirement_id: 2, idempotency_key: 'cancel-reconcile' }), /idempotency_key_conflict/);
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
