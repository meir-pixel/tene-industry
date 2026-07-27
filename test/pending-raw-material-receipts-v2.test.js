'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const receipts = require('../services/pendingRawMaterialReceiptV2');
const allocation = require('../services/materialAllocationPlanningV2');

function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); return value; }
function line(overrides = {}) { return { source_line_ref: '1', material_type: 'coil', diameter: 12, lot_number: 'HEAT-1', certificate_num: 'CERT-1', weight_received: 100, ...overrides }; }
test('draft receipt is separate from inventory and approval creates an approved lot', () => {
  const value = db(); value.prepare("INSERT INTO diameter_catalog (diameter_key,diameter_display,status) VALUES ('12','Ø12','active')").run();
  const draft = receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'draft-1', lines: [line()] });
  assert.equal(value.prepare('SELECT COUNT(*) AS n FROM raw_material').get().n, 0); assert.equal(draft.status, 'draft');
  const approved = receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-1', decided_by: 1 });
  assert.equal(approved.status, 'approved'); const lot = value.prepare('SELECT * FROM raw_material').get(); assert.equal(lot.verification_status, 'approved'); assert.equal(lot.weight_used, 0); value.close();
});
test('unmanaged specification creates a pending-verification lot that B2 cannot allocate', () => {
  const value = db();
  const draft = receipts.createDraft(value, { source_type: 'ocr', source_ref: 'doc-1', idempotency_key: 'ocr-1', lines: [line({ diameter: 5.5 })] });
  receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-ocr', decided_by: 1 });
  const lot = value.prepare('SELECT * FROM raw_material').get(); assert.equal(lot.verification_status, 'pending_verification');
  value.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,'B4-1',2)").run(); value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,5.5,10)').run();
  value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (1,'b4',1,1,2,5.5,'coil',10,'unknown','open','manual')").run();
  assert.throws(() => allocation.confirmAllocationPlan(value, { material_requirement_id: 1, idempotency_key: 'blocked', lines: [{ raw_material_id: lot.id, allocated_kg: 1 }] }), /invalid_allocation_lot/); value.close();
});
test('duplicate is a warning and requires explicit approval confirmation', () => {
  const value = db(); value.prepare("INSERT INTO diameter_catalog (diameter_key,diameter_display,status) VALUES ('12','Ø12','active')").run();
  value.prepare("INSERT INTO suppliers (id,name) VALUES (1,'S')").run(); value.prepare("INSERT INTO raw_material (diameter,material_type,supplier_id,lot_number,weight_received) VALUES (12,'coil',1,'HEAT-1',1)").run();
  const draft = receipts.createDraft(value, { source_type: 'purchase_order', supplier_id: 1, delivery_note_num: 'DN-1', idempotency_key: 'po-1', lines: [line()] });
  assert.throws(() => receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-duplicate', decided_by: 1 }), /duplicate_confirmation_required/);
  const approved = receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-duplicate-ok', confirm_duplicate: true, decided_by: 1 }); assert.equal(approved.status, 'approved'); value.close();
});
test('idempotent creation replay is safe and conflicting payload is rejected', () => {
  const value = db(); const first = receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'same', lines: [line()] });
  assert.equal(receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'same', lines: [line()] }).id, first.id);
  assert.throws(() => receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'same', lines: [line({ weight_received: 99 })] }), /idempotency_key_conflict/); value.close();
});
test('approval idempotency rejects a conflicting replay', () => {
  const value = db(); value.prepare("INSERT INTO diameter_catalog (diameter_key,diameter_display,status) VALUES ('12','Ø12','active')").run();
  const draft = receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'draft-approval', lines: [line()] });
  receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-once', decided_by: 1 });
  assert.equal(receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-once', decided_by: 1 }).status, 'approved');
  assert.throws(() => receipts.approveReceipt(value, { receipt_id: draft.id, idempotency_key: 'approve-once', confirm_duplicate: true, decided_by: 1 }), /idempotency_key_conflict/); value.close();
});

test('decision idempotency binds the action and decision payload', () => {
  const value = db();
  const draft = receipts.createDraft(value, { source_type: 'manual', idempotency_key: 'decision-draft', lines: [line()] });
  assert.equal(receipts.rejectReceipt(value, { receipt_id: draft.id, idempotency_key: 'decision-key', notes: 'certificate missing' }).status, 'rejected');
  assert.throws(() => receipts.rejectReceipt(value, { receipt_id: draft.id, idempotency_key: 'decision-key', notes: 'changed note' }), /idempotency_key_conflict/);
  assert.throws(() => receipts.cancelDraft(value, { receipt_id: draft.id, idempotency_key: 'decision-key', notes: 'certificate missing' }), /idempotency_key_conflict/);
  value.close();
});
