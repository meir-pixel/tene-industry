'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { projectMaterialCoverageV2 } = require('../services/materialCoverageProjectionV2');

function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); return value; }
function requirement(value, id, { diameter = 12, material = 'coil', required = 1000, status = 'open', lifecycle = 2 } = {}) {
  value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(id, `O-${id}`, lifecycle);
  value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,?,?)').run(id,id,diameter,required);
  value.prepare('INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`R-${id}`,id,id,lifecycle,diameter,material,required,'unknown',status,'manual','r1');
}
function lot(value, id, { diameter = 12, material = 'coil', received = 0, used = 0, scrapped = 0, verification = 'approved', active = 1, catalog = null, exception = 0 } = {}) {
  value.prepare('INSERT INTO raw_material (id,diameter,material_type,weight_received,weight_used,weight_scrapped,verification_status,active,catalog_item_id,spec_exception) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,diameter,material,received,used,scrapped,verification,active,catalog,exception);
}
function group(result, diameter = 12, material = 'coil') { return result.groups.find(row => row.diameter === diameter && row.material_type === material); }

test('B5A computes group-only cover, gaps and remains read-only', () => {
  const value = db(); requirement(value, 1); lot(value, 1, { received: 400 }); const before = value.totalChanges;
  const result = projectMaterialCoverageV2(value); const row = group(result);
  assert.equal(value.totalChanges, before); assert.equal(result.projection, 'material_coverage_v2'); assert.equal(result.mode, 'read_only'); assert.equal(result.is_procurement_instruction, false);
  assert.equal(row.demand.unallocated_demand_kg, 1000); assert.equal(row.approved_inventory.v2_candidate_cover_kg, 400); assert.equal(row.approved_inventory.v2_gap_kg, 600);
  assert.equal(row.identity_is_partial, true); assert.match(row.identity_warning, /does not validate/); assert.equal(Object.hasOwn(row.requirements[0], 'candidate_cover_kg'), false); value.close();
});

test('B5A prevents double cover, separates V1 reservations and does not mix coil with straight', () => {
  const value = db(); requirement(value,1,{required:400}); requirement(value,2,{required:400}); requirement(value,3,{required:400}); requirement(value,4,{material:'straight',required:200}); lot(value,1,{received:500}); lot(value,2,{material:'straight',received:100});
  value.prepare("INSERT INTO inventory_reservations (order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (1,1,12,'coil',300,'active')").run();
  const result = projectMaterialCoverageV2(value); const coil = group(result); const straight = group(result,12,'straight');
  assert.equal(coil.demand.unallocated_demand_kg,1200); assert.equal(coil.approved_inventory.v2_candidate_cover_kg,500); assert.equal(coil.approved_inventory.v2_gap_kg,700); assert.equal(coil.legacy_reservations.conservative_free_kg,200); assert.equal(coil.legacy_reservations.conservative_gap_kg,1000);
  assert.equal(straight.approved_inventory.v2_gap_kg,100); value.close();
});

test('B5A tracks allocation, consumption and reversal without assigning free stock', () => {
  const value = db(); requirement(value,1,{required:100}); lot(value,1,{received:100});
  value.prepare("INSERT INTO allocation_plans_v2 (id,plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,source_revision,spec_diameter,spec_material_type,status) VALUES (1,'p','k','f',1,'R-1',100,'r1',12,'coil','active')").run();
  value.prepare("INSERT INTO allocation_plan_lines_v2 (id,allocation_plan_id,raw_material_id,allocated_kg,status,allocation_sequence) VALUES (1,1,1,100,'active',1)").run();
  value.prepare("INSERT INTO material_consumption_events_v2 (id,event_uid,event_type,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,order_id,item_id,approved_by) VALUES (1,'e1','consumption','e1','f',1,'R-1',1,1,1),(2,'e2','reversal','e2','f',1,'R-1',1,1,1)").run();
  value.prepare("INSERT INTO material_consumption_event_lines_v2 (consumption_event_id,allocation_plan_id,allocation_plan_line_id,raw_material_id,consumed_kg) VALUES (1,1,1,1,40),(2,1,1,1,10)").run();
  const req = group(projectMaterialCoverageV2(value)).requirements[0]; assert.equal(req.confirmed_consumed_kg,30); assert.equal(req.remaining_required_kg,70); assert.equal(req.allocated_remaining_kg,70); assert.equal(req.unallocated_demand_kg,0); value.close();
});

test('B5A excludes pending material, reports drafts and legacy PO as non-coverage', () => {
  const value = db(); requirement(value,1); lot(value,1,{received:300,verification:'pending_verification'});
  value.prepare("INSERT INTO pending_raw_material_receipts_v2 (id,receipt_uid,status,source_type,idempotency_key,payload_fingerprint) VALUES (1,'x','draft','manual','d','f')").run();
  value.prepare("INSERT INTO pending_raw_material_receipt_lines_v2 (receipt_id,source_line_ref,material_type,diameter,weight_received) VALUES (1,'1','coil',12,200)").run();
  value.prepare("INSERT INTO purchase_orders (po_num,diameter,material_type,quantity_ton,received_weight,status) VALUES ('PO-1',12,'coil',.5,100,'ordered')").run();
  const row = group(projectMaterialCoverageV2(value)); assert.equal(row.approved_inventory.physical_kg,0); assert.equal(row.pending_verification.weight_kg,300); assert.equal(row.pending_receipts.weight_kg,200); assert.equal(row.pending_receipts.receipt_count,1); assert.equal(row.legacy_purchase_orders[0].legacy_reported_remaining_kg,400); assert.equal(row.legacy_purchase_orders[0].counted_as_coverage,false); assert.equal(row.approved_inventory.v2_gap_kg,1000); value.close();
});

test('B5A emits invalid, negative, cancelled allocation and unclassified reservation anomalies', () => {
  const value = db(); requirement(value,1,{status:'cancelled'}); lot(value,1,{received:10,used:20,catalog:null});
  value.prepare("INSERT INTO allocation_plans_v2 (id,plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,status) VALUES (1,'p','k','f',1,'R-1',100,'active')").run(); value.prepare("INSERT INTO allocation_plan_lines_v2 (allocation_plan_id,raw_material_id,allocated_kg,status,allocation_sequence) VALUES (1,1,1,'active',1)").run();
  value.prepare("INSERT INTO inventory_reservations (order_id,diameter,material_type,reserved_kg,status) VALUES (1,12,NULL,1,'active')").run();
  const result = projectMaterialCoverageV2(value); const codes = [...result.global_anomalies,...group(result).anomalies].map(x=>x.code); assert.ok(codes.includes('negative_lot_available_weight')); assert.ok(codes.includes('approved_lot_incomplete_spec')); assert.ok(codes.includes('cancelled_requirement_has_active_allocation')); assert.ok(codes.includes('legacy_reservation_unclassified')); value.close();
});

test('B5A keeps draft lines and inactive pending lots outside coverage', () => {
  const value = db(); requirement(value,1); lot(value,1,{received:50,verification:'pending_verification'}); lot(value,2,{received:500,verification:'pending_verification',active:0});
  value.prepare("INSERT INTO pending_raw_material_receipts_v2 (id,receipt_uid,status,source_type,idempotency_key,payload_fingerprint) VALUES (1,'r','draft','manual','k','f')").run();
  value.prepare("INSERT INTO pending_raw_material_receipt_lines_v2 (receipt_id,source_line_ref,material_type,diameter,weight_received) VALUES (1,'1','coil',12,20),(1,'2','coil',12,30)").run();
  const row = group(projectMaterialCoverageV2(value)); assert.deepEqual(row.pending_receipts,{ weight_kg:50, receipt_count:1, line_count:2, counted_as_coverage:false, operational_state:'pending_approval' }); assert.equal(row.pending_verification.weight_kg,50); assert.equal(row.pending_verification.lot_count,1); assert.equal(row.approved_inventory.physical_kg,0); value.close();
});

test('B5A reports over-consumption, allocation excess and conservative legacy gap', () => {
  const value = db(); requirement(value,1,{required:100}); lot(value,1,{received:100});
  value.prepare("INSERT INTO allocation_plans_v2 (id,plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,status) VALUES (1,'p','k','f',1,'R-1',100,'active')").run(); value.prepare("INSERT INTO allocation_plan_lines_v2 (id,allocation_plan_id,raw_material_id,allocated_kg,status,allocation_sequence) VALUES (1,1,1,50,'active',1)").run();
  value.prepare("INSERT INTO material_consumption_events_v2 (id,event_uid,event_type,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,order_id,item_id,approved_by) VALUES (1,'e','consumption','e','f',1,'R-1',1,1,1)").run(); value.prepare("INSERT INTO material_consumption_event_lines_v2 (consumption_event_id,allocation_plan_id,allocation_plan_line_id,raw_material_id,consumed_kg) VALUES (1,1,1,1,120)").run();
  value.prepare("INSERT INTO inventory_reservations (order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (1,1,12,'coil',200,'active')").run();
  const row = group(projectMaterialCoverageV2(value)); const codes=[...row.anomalies,...row.requirements[0].anomalies].map(x=>x.code); assert.equal(row.requirements[0].confirmed_consumed_kg,120); assert.equal(row.requirements[0].remaining_required_kg,0); assert.equal(row.requirements[0].allocated_remaining_kg,0); assert.ok(codes.includes('requirement_overconsumed')); assert.ok(codes.includes('allocation_consumed_exceeds_allocated')); assert.equal(row.legacy_reservations.conservative_free_kg,0); assert.ok(codes.includes('legacy_reservation_exceeds_v2_free_stock')); value.close();
});

test('B5A projection is stable across insertion order and rejects non-V2 identities', () => {
  const build = reverse => { const value=db(); const ids=reverse?[3,2,1]:[1,2,3]; for(const id of ids) requirement(value,id,{required:10}); for(const id of ids) lot(value,id,{received:10}); value.pragma('foreign_keys=OFF'); value.pragma('ignore_check_constraints=ON'); value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (99,'bad',1,99,1,0,'bent',5,'unknown','open','manual')").run(); return value; };
  const first=build(false), second=build(true); const normalize=result=>({ ...result, generated_at:null }); assert.deepEqual(normalize(projectMaterialCoverageV2(first)),normalize(projectMaterialCoverageV2(second))); assert.ok(projectMaterialCoverageV2(first).global_anomalies.some(x=>x.code==='invalid_requirement_identity')); first.close(); second.close();
});
