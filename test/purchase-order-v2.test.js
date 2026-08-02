'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const recommendations = require('../services/procurementRecommendationV2');
const purchaseOrders = require('../services/purchaseOrderV2');
const { projectMaterialCoverageV2 } = require('../services/materialCoverageProjectionV2');

function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); return value; }
function seed(value) {
  value.prepare("INSERT INTO suppliers (id,name,active) VALUES (1,'Steel Co',1)").run();
  value.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,'PO-V2',2)").run();
  value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,12,10)').run();
  value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (1,'PO-REQ',1,1,2,12,'coil',10,'unknown','open','manual','r1')").run();
  const recommendation = recommendations.createDraft(value, { idempotency_key: 'recommendation', specification: { diameter: 12, material_type: 'coil' }, recommended_kg: 10, links: [{ material_requirement_id: 1, recommended_kg: 10 }] });
  return recommendations.approveRecommendation(value, { recommendation_id: recommendation.id, idempotency_key: 'recommendation-approve', decided_by: 9 });
}
function input(key, recommendationId, extra = {}) { return { idempotency_key: key, currency_code: 'ILS', lines: [{ source_recommendation_id: recommendationId, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 1, unit_price_per_kg: 1.005 }], ...extra }; }
function forbiddenCounts(value) { return Object.fromEntries(['purchase_orders','raw_material','pending_raw_material_receipts_v2','allocation_plans_v2','material_consumption_events_v2'].map(table => [table, value.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n])); }

test('B5B2 keeps a draft separate from legacy, receipts, coverage and internal approval freezes commercial amounts', () => {
  const value = db(); const recommendation = seed(value); const before = forbiddenCounts(value); const beforeProjection = { ...projectMaterialCoverageV2(value), generated_at: null };
  const draft = purchaseOrders.createDraft(value, input('draft', recommendation.id));
  assert.equal(draft.status, 'draft'); assert.equal(draft.supplier_id, null); assert.equal(draft.lines[0].line_amount, null); assert.deepEqual(forbiddenCounts(value), before);
  assert.throws(() => purchaseOrders.approvePurchaseOrder(value, { purchase_order_id: draft.id, expected_revision: 1, idempotency_key: 'no-supplier' }), /supplier_required/);
  const updated = purchaseOrders.updateDraft(value, input('update', recommendation.id, { purchase_order_id: draft.id, expected_revision: 1, supplier_id: 1, currency_code: 'usd', notes: 'commercial draft' }));
  assert.equal(updated.currency_code, 'USD'); assert.equal(updated.revision, 2);
  assert.throws(() => purchaseOrders.updateDraft(value, input('bad-revision', recommendation.id, { purchase_order_id: draft.id, expected_revision: 1, supplier_id: 1 })), /purchase_order_revision_conflict/);
  const approved = purchaseOrders.approvePurchaseOrder(value, { purchase_order_id: draft.id, expected_revision: 2, idempotency_key: 'approve', approved_by: 7 });
  assert.equal(approved.status, 'approved'); assert.equal(approved.lines[0].line_amount, 1.01); assert.equal(approved.revision, 3);
  assert.equal(purchaseOrders.approvePurchaseOrder(value, { purchase_order_id: draft.id, expected_revision: 2, idempotency_key: 'approve', approved_by: 7 }).status, 'approved');
  assert.throws(() => purchaseOrders.updateDraft(value, input('blocked-update', recommendation.id, { purchase_order_id: draft.id, expected_revision: 3, supplier_id: 1 })), /draft_purchase_order_required/);
  const issued = purchaseOrders.issuePurchaseOrder(value, { purchase_order_id: draft.id, expected_revision: 3, idempotency_key: 'issue', issued_by: 7 });
  assert.equal(issued.status, 'issued'); assert.equal(issued.revision, 4);
  const cancelled = purchaseOrders.cancelPurchaseOrder(value, { purchase_order_id: draft.id, expected_revision: 4, idempotency_key: 'cancel', reason: 'supplier withdrew', cancelled_by: 7 });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancellation_reason, 'supplier withdrew');
  assert.deepEqual({ ...projectMaterialCoverageV2(value), generated_at: null }, beforeProjection); assert.deepEqual(forbiddenCounts(value), before);
  const events = value.prepare('SELECT event_type,details_json FROM purchase_order_events_v2 WHERE purchase_order_id=? ORDER BY id').all(draft.id);
  assert.deepEqual(events.map(event => event.event_type), ['created','updated','approved','issued','cancelled']); assert.ok(JSON.parse(events[1].details_json).before.lines.length); assert.ok(JSON.parse(events[1].details_json).after.lines.length); value.close();
});

test('B5B2 recommendation quantity guard is atomic across split drafts and cancellation releases capacity', () => {
  const value = db(); const recommendation = seed(value);
  const first = purchaseOrders.createDraft(value, input('first', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 6, unit_price_per_kg: 1 }] }));
  const second = purchaseOrders.createDraft(value, input('second', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 4, unit_price_per_kg: 1 }] }));
  assert.ok(first.id && second.id); assert.throws(() => purchaseOrders.createDraft(value, input('exceeded', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 0.001, unit_price_per_kg: 1 }] })), /source_recommendation_quantity_exceeded/);
  const replay = purchaseOrders.createDraft(value, input('second', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 4, unit_price_per_kg: 1 }] })); assert.equal(replay.id, second.id);
  assert.throws(() => purchaseOrders.createDraft(value, input('second', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 3, unit_price_per_kg: 1 }] })), /idempotency_key_conflict/);
  purchaseOrders.cancelPurchaseOrder(value, { purchase_order_id: first.id, expected_revision: 1, idempotency_key: 'cancel-first', reason: 'replaced', cancelled_by: 7 });
  assert.ok(purchaseOrders.createDraft(value, input('replacement', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 6, unit_price_per_kg: 1 }] })).id); value.close();
});

test('B5B2 uses commercial two-decimal half-up rounding only for the final line amount', () => {
  assert.equal(purchaseOrders.halfUp('1', '1.005'), 1.01);
  assert.equal(purchaseOrders.halfUp('3.333', '2.5555'), 8.52);
  const value = db(); const recommendation = seed(value);
  assert.throws(() => purchaseOrders.createDraft(value, input('bad-line-amount', recommendation.id, { lines: [{ source_recommendation_id: recommendation.id, specification: { diameter: 12, material_type: 'coil' }, ordered_kg: 1, unit_price_per_kg: 1.005, line_amount: 1 }] })), /line_amount_mismatch/);
  value.close();
});
