'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const recommendations = require('../services/procurementRecommendationV2');

function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); return value; }
function seed(value, { catalog = false } = {}) {
  value.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,'B5B1',2)").run();
  value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,12,100)').run();
  value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (1,'REQ-1',1,1,2,12,'coil',100,'unknown','open','manual','r1')").run();
  if (catalog) {
    value.prepare("INSERT INTO diameter_catalog (diameter_key,diameter_display,status) VALUES ('12','Ø12','active')").run();
    return value.prepare("INSERT INTO catalog_items (sku,item_kind,name,supply_form,diameter_key,steel_grade,standard_code,nominal_length_mm) VALUES ('RB-12','raw_material','RB Ø12','coil','12','B500B','SI-4466',12000)").run().lastInsertRowid;
  }
  return null;
}
function input(key, extra = {}) { return { idempotency_key: key, specification: { diameter: 12, material_type: 'coil', grade: 'B500B', standard_code: 'SI-4466', nominal_length_mm: 12000 }, recommended_kg: 100, links: [{ material_requirement_id: 1, recommended_kg: 100 }], ...extra }; }

test('B5B1 creates immutable snapshots and explicit B1 requirement links without any PO or stock write', () => {
  const value = db(); const catalogItemId = seed(value, { catalog: true });
  const before = { pos: value.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n, lots: value.prepare('SELECT COUNT(*) n FROM raw_material').get().n, allocations: value.prepare('SELECT COUNT(*) n FROM allocation_plans_v2').get().n };
  const row = recommendations.createDraft(value, input('create-complete', { catalog_item_id: catalogItemId }));
  assert.equal(row.status, 'draft'); assert.equal(row.freshness_status, 'current'); assert.equal(row.spec_identity_status, 'complete'); assert.equal(row.links.length, 1); assert.equal(row.links[0].requirement_uid, 'REQ-1');
  assert.deepEqual(row.spec_snapshot, { ...input('x').specification, supply_form: 'coil' }); assert.equal(value.prepare('SELECT COUNT(*) n FROM procurement_recommendation_events_v2').get().n, 1);
  assert.deepEqual({ pos: value.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n, lots: value.prepare('SELECT COUNT(*) n FROM raw_material').get().n, allocations: value.prepare('SELECT COUNT(*) n FROM allocation_plans_v2').get().n }, before);
  value.close();
});

test('B5B1 allows a no-SKU recommendation only as partial identity and rejects silent mismatches', () => {
  const value = db(); seed(value);
  const partial = recommendations.createDraft(value, input('partial'));
  assert.equal(partial.spec_identity_status, 'partial');
  assert.throws(() => recommendations.createDraft(value, input('wrong-type', { specification: { diameter: 12, material_type: 'straight' } })), /requirement_specification_mismatch/);
  assert.throws(() => recommendations.createDraft(value, input('bad-links', { recommended_kg: 99 })), /recommendation_link_total_mismatch/);
  value.close();
});

test('B5B1 idempotency is safe and payload conflicts are fail-closed', () => {
  const value = db(); seed(value); const first = recommendations.createDraft(value, input('repeat'));
  assert.equal(recommendations.createDraft(value, input('repeat')).id, first.id);
  assert.throws(() => recommendations.createDraft(value, input('repeat', { recommended_kg: 90, links: [{ material_requirement_id: 1, recommended_kg: 90 }] })), /idempotency_key_conflict/);
  value.close();
});

test('B5B1 approval is an audited recommendation-only action and concurrent second decision fails', () => {
  const value = db(); seed(value); const draft = recommendations.createDraft(value, input('approval-draft'));
  const before = value.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n;
  const approved = recommendations.approveRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'approve', decided_by: 9 });
  assert.equal(approved.status, 'approved'); assert.equal(value.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n, before);
  assert.equal(recommendations.approveRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'approve', decided_by: 9 }).id, draft.id);
  assert.throws(() => recommendations.rejectRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'second-decision', decided_by: 10 }), /draft_recommendation_required/);
  assert.deepEqual(value.prepare('SELECT event_type FROM procurement_recommendation_events_v2 ORDER BY id').all().map(row => row.event_type), ['created','approved']); value.close();
});

test('B5B1 GET projects stale without writing and explicit reconciliation persists stale_detected', () => {
  const value = db(); seed(value); const draft = recommendations.createDraft(value, input('stale-requirement'));
  value.prepare("UPDATE material_requirements_v2 SET source_revision='r2' WHERE id=1").run();
  const projected = recommendations.getRecommendation(value, draft.id);
  assert.equal(projected.freshness_status, 'current'); assert.equal(projected.projected_freshness_status, 'stale');
  assert.equal(value.prepare("SELECT COUNT(*) n FROM procurement_recommendation_events_v2 WHERE event_type='stale_detected'").get().n, 0);
  const reconciled = recommendations.reconcileRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'reconcile', reconciled_by: 9 });
  assert.equal(reconciled.freshness_status, 'stale'); assert.equal(value.prepare("SELECT COUNT(*) n FROM procurement_recommendation_events_v2 WHERE event_type='stale_detected'").get().n, 1);
  assert.throws(() => recommendations.approveRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'stale-approve', decided_by: 9 }), /recommendation_stale/); value.close();
});

for (const [name, mutate] of [
  ['allocation', value => { value.prepare("INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (1,12,'coil',10,'approved',1)").run(); value.prepare("INSERT INTO allocation_plans_v2 (plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,status) VALUES ('p','p','p',1,'REQ-1',100,'active')").run(); value.prepare('INSERT INTO allocation_plan_lines_v2 (allocation_plan_id,raw_material_id,allocated_kg,allocation_sequence) VALUES (1,1,10,1)').run(); }],
  ['consumption', value => { value.prepare("INSERT INTO material_consumption_events_v2 (event_uid,event_type,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,order_id,item_id,approved_by) VALUES ('e','consumption','e','e',1,'REQ-1',1,1,1)").run(); value.prepare('INSERT INTO material_consumption_event_lines_v2 (consumption_event_id,allocation_plan_id,allocation_plan_line_id,raw_material_id,consumed_kg) VALUES (1,1,1,1,1)').run(); }],
  ['B4 receipt', value => { value.prepare("INSERT INTO pending_raw_material_receipts_v2 (receipt_uid,status,source_type,idempotency_key,payload_fingerprint) VALUES ('r','draft','manual','r','r')").run(); value.prepare("INSERT INTO pending_raw_material_receipt_lines_v2 (receipt_id,source_line_ref,material_type,diameter,weight_received) VALUES (1,'1','coil',12,10)").run(); }],
]) test(`B5B1 projects stale after ${name} changes B5A inputs`, () => {
  const value = db(); seed(value); const draft = recommendations.createDraft(value, input(`stale-${name}`));
  if (name === 'consumption') { value.prepare("INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (1,12,'coil',10,'approved',1)").run(); value.prepare("INSERT INTO allocation_plans_v2 (plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,status) VALUES ('p','p','p',1,'REQ-1',100,'active')").run(); value.prepare('INSERT INTO allocation_plan_lines_v2 (allocation_plan_id,raw_material_id,allocated_kg,allocation_sequence) VALUES (1,1,10,1)').run(); }
  mutate(value); assert.equal(recommendations.getRecommendation(value, draft.id).projected_freshness_status, 'stale'); value.close();
});

test('B5B1 refresh explicitly replaces only a stale draft snapshot before approval', () => {
  const value = db(); seed(value); const draft = recommendations.createDraft(value, input('refresh-draft'));
  value.prepare("UPDATE material_requirements_v2 SET source_revision='r2' WHERE id=1").run();
  assert.throws(() => recommendations.approveRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'blocked', decided_by: 9 }), /recommendation_stale/);
  const refreshed = recommendations.refreshDraft(value, input('refresh', { recommendation_id: draft.id, refreshed_by: 3 }));
  assert.equal(refreshed.freshness_status, 'current'); assert.equal(recommendations.approveRecommendation(value, { recommendation_id: draft.id, idempotency_key: 'approved-after-refresh', decided_by: 9 }).status, 'approved'); value.close();
});
