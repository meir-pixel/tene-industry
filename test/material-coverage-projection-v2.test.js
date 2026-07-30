'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { projectMaterialCoverageV2, anomalySort } = require('../services/materialCoverageProjectionV2');

function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); return value; }
function withIgnoredCheckConstraints(value, action) {
  value.pragma('ignore_check_constraints=ON');
  try { return action(); } finally { value.pragma('ignore_check_constraints=OFF'); }
}
function ignoresCheckConstraints(value) { return value.pragma('ignore_check_constraints', { simple: true }) === 1; }
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

test('B5A excludes a valid-identity requirement whose order is lifecycle V1', () => {
  const value = db(); value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(1, 'V1-1', 1); value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,?,?)').run(1, 1, 12, 90);
  value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (1,'V1-R',1,1,2,12,'coil',90,'unknown','open','manual')").run(); requirement(value, 2, { lifecycle: 2, required: 40 });
  const result = projectMaterialCoverageV2(value); const row = group(result);
  assert.deepEqual(row.requirements.map(entry => entry.requirement_id), [2]); assert.equal(row.demand.remaining_required_kg, 40);
  assert.equal(result.global_anomalies.some(entry => entry.requirement_id === 1), false); value.close();
});

test('B5A excludes bent V2 demand without mixing it into coil or straight', () => {
  const value = db(); requirement(value, 1, { required: 40 });
  value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(2, 'BENT-2', 2);
  value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,?,?)').run(2, 2, 12, 70);
  withIgnoredCheckConstraints(value, () => value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (2,'BENT-2',2,2,2,12,'bent',70,'unknown','open','manual')").run());
  const result = projectMaterialCoverageV2(value); assert.equal(group(result).demand.remaining_required_kg, 40); assert.equal(group(result, 12, 'straight'), undefined);
  assert.deepEqual(result.global_anomalies.filter(entry => entry.code === 'invalid_requirement_identity').map(entry => entry.requirement_id), [2]); value.close();
});

test('B5A restores ignored check constraints after a fixture failure', () => {
  const value = db(); assert.equal(ignoresCheckConstraints(value), false);
  assert.throws(() => withIgnoredCheckConstraints(value, () => { throw new Error('fixture failure'); }), /fixture failure/);
  assert.equal(ignoresCheckConstraints(value), false);
  value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(1, 'CHECKS-1', 2);
  value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,?,?)').run(1, 1, 12, 10);
  assert.throws(() => value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (1,'BAD',1,1,2,12,'bent',10,'unknown','open','manual')").run()); value.close();
});

test('B5A anomaly sort keeps numeric source IDs in numeric order', () => {
  const anomalies = [{ code:'same', requirement_id:10 }, { code:'same', requirement_id:2 }].sort(anomalySort);
  assert.deepEqual(anomalies.map(anomaly => anomaly.requirement_id), [2,10]); assert.notEqual(anomalySort(anomalies[0], anomalies[1]), 0);
});

test('B5A anomaly sort distinguishes same-code requirement anomalies', () => {
  const anomalies = [{ code:'requirement_overconsumed', requirement_id:10 }, { code:'requirement_overconsumed', requirement_id:2 }].sort(anomalySort);
  assert.deepEqual(anomalies.map(anomaly => anomaly.requirement_id), [2,10]); assert.equal(anomalies.length, 2); assert.notEqual(anomalySort(anomalies[0], anomalies[1]), 0);
});

test('B5A anomaly sort orders global and group traceability deterministically', () => {
  const anomalies = [{ code:'same', source_type:'group', diameter:12, material_type:'coil' }, { code:'same', source_type:'global', scope:'all' }].sort(anomalySort);
  assert.deepEqual(anomalies.map(anomaly => anomaly.source_type), ['global','group']);
});

test('B5A anomaly sort uses canonical serialization only as the final tie-breaker', () => {
  const equivalentLeft = { code:'same', source_type:'group', detail:{ b:1, a:2 } }; const equivalentRight = { source_type:'group', detail:{ a:2, b:1 }, code:'same' };
  const distinct = [{ code:'same', source_type:'group', detail:{ key:'b' } }, { code:'same', source_type:'group', detail:{ key:'a' } }].sort(anomalySort);
  assert.equal(anomalySort(equivalentLeft, equivalentRight), 0); assert.deepEqual(distinct.map(anomaly => anomaly.detail.key), ['a','b']);
});

test('B5A keeps legacy reservations out of V2 requirements and V2 gap', () => {
  const value = db(); value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(1, 'LEGACY-ONLY', 1);
  value.prepare("INSERT INTO inventory_reservations (id,order_id,diameter,material_type,reserved_kg,status) VALUES (1,1,12,'coil',25,'active')").run();
  let row = group(projectMaterialCoverageV2(value)); assert.deepEqual(row.requirements, []); assert.equal(row.demand.remaining_required_kg, 0); assert.equal(row.demand.unallocated_demand_kg, 0); assert.equal(row.legacy_reservations.active_reserved_kg, 25);
  requirement(value, 2, { required: 100 }); row = group(projectMaterialCoverageV2(value)); assert.deepEqual(row.requirements.map(entry => entry.requirement_id), [2]); assert.equal(row.approved_inventory.v2_gap_kg, 100); assert.equal(row.legacy_reservations.active_reserved_kg, 25); assert.equal(row.legacy_reservations.conservative_gap_kg, 100); value.close();
});

test('B5A has a total anomaly order and a full deterministic projection fixture', () => {
  const build = reverse => {
    const value = db(); const ordered = rows => reverse ? [...rows].reverse() : rows;
    for (const [id, lifecycle] of ordered([[1, 2], [2, 2], [3, 2], [99, 2]])) value.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,?)').run(id, `O-${id}`, lifecycle);
    for (const [id, diameter, total] of ordered([[1, 12, 100], [2, 12, 200], [3, 14, 50], [99, 12, 1]])) value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,?,?)').run(id, id, diameter, total);
    for (const [id, diameter, material, required] of ordered([[1, 12, 'coil', 100], [2, 12, 'coil', 200], [3, 14, 'straight', 50]])) value.prepare('INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, `R-${id}`, id, id, 2, diameter, material, required, 'unknown', 'open', 'manual', 'r1');
    withIgnoredCheckConstraints(value, () => value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source) VALUES (99,'R-BENT',99,99,2,12,'bent',1,'unknown','open','manual')").run());
    for (const [id, diameter, material, received, used, verification, catalog] of ordered([[1,12,'coil',100,0,'approved',null],[2,12,'coil',30,0,'pending_verification',null],[3,14,'straight',80,0,'approved',null],[4,12,'coil',10,20,'approved',null],[5,12,'coil',5,0,'approved',null]])) lot(value,id,{diameter,material,received,used,verification,catalog});
    for (const [id, requirementId, required, diameter, material] of ordered([[1,1,100,12,'coil'],[2,2,200,12,'coil']])) value.prepare('INSERT INTO allocation_plans_v2 (id,plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,source_revision,spec_diameter,spec_material_type,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,`P-${id}`,`K-${id}`,`F-${id}`,requirementId,`R-${requirementId}`,required,'r1',diameter,material,'active');
    for (const [id, planId, lotId, amount] of ordered([[1,1,1,40],[2,2,1,30]])) value.prepare('INSERT INTO allocation_plan_lines_v2 (id,allocation_plan_id,raw_material_id,allocated_kg,status,allocation_sequence) VALUES (?,?,?,?,?,?)').run(id,planId,lotId,amount,'active',id);
    for (const [id, type, requirementId] of ordered([[1,'consumption',1],[2,'reversal',1],[3,'consumption',2]])) value.prepare('INSERT INTO material_consumption_events_v2 (id,event_uid,event_type,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,order_id,item_id,approved_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,`E-${id}`,type,`EK-${id}`,`EF-${id}`,requirementId,`R-${requirementId}`,requirementId,requirementId,1);
    for (const [id, eventId, planId, lineId, amount] of ordered([[1,1,1,1,50],[2,2,1,1,5],[3,3,2,2,40]])) value.prepare('INSERT INTO material_consumption_event_lines_v2 (id,consumption_event_id,allocation_plan_id,allocation_plan_line_id,raw_material_id,consumed_kg) VALUES (?,?,?,?,?,?)').run(id,eventId,planId,lineId,1,amount);
    for (const [id, uid, material] of ordered([[1,'D-1','coil'],[2,'D-2','straight']])) value.prepare('INSERT INTO pending_raw_material_receipts_v2 (id,receipt_uid,status,source_type,idempotency_key,payload_fingerprint) VALUES (?,?,?,?,?,?)').run(id,uid,'draft','manual',`DK-${id}`,`DF-${id}`);
    for (const [id, receiptId, sourceLine, material, diameter, weight] of ordered([[1,1,'1','coil',12,20],[2,1,'2','coil',12,10],[3,2,'1','straight',14,5]])) value.prepare('INSERT INTO pending_raw_material_receipt_lines_v2 (id,receipt_id,source_line_ref,material_type,diameter,weight_received) VALUES (?,?,?,?,?,?)').run(id,receiptId,sourceLine,material,diameter,weight);
    for (const [id, material, reserved] of ordered([[1,'coil',15],[2,null,1]])) value.prepare('INSERT INTO inventory_reservations (id,order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (?,?,?,?,?,?,?)').run(id,1,1,12,material,reserved,'active');
    for (const [id, po, quantity] of ordered([[1,'PO-1',0.1],[2,'PO-2',0.2]])) value.prepare('INSERT INTO purchase_orders (id,po_num,diameter,material_type,quantity_ton,received_weight,status) VALUES (?,?,?,?,?,?,?)').run(id,po,12,'coil',quantity,0,'ordered');
    return value;
  };
  const first = build(false); const second = build(true); const normalize = result => ({ ...result, generated_at: null }); const firstProjection = projectMaterialCoverageV2(first); const secondProjection = projectMaterialCoverageV2(second);
  assert.deepEqual(normalize(firstProjection), normalize(secondProjection)); const coil = group(firstProjection); assert.equal(coil.requirements.length, 2); assert.equal(coil.legacy_purchase_orders.length, 2); assert.equal(coil.pending_receipts.line_count, 2); assert.ok(coil.requirements.every(entry => entry.anomalies.some(anomaly => anomaly.code === 'allocation_consumed_exceeds_allocated'))); assert.deepEqual(coil.anomalies.filter(anomaly => anomaly.code === 'approved_lot_incomplete_spec').map(anomaly => anomaly.raw_material_id), [1,4,5]); assert.deepEqual(coil.anomalies.filter(anomaly => anomaly.code === 'legacy_po_possible_overlap').map(anomaly => anomaly.purchase_order_id), [1,2]); assert.ok(firstProjection.global_anomalies.some(anomaly => anomaly.code === 'invalid_requirement_identity')); assert.ok(firstProjection.global_anomalies.some(anomaly => anomaly.code === 'legacy_reservation_unclassified'));
  const unordered = [{ code:'same', source_type:'group', diameter:14 }, { code:'same', source_type:'group', diameter:12 }]; assert.notEqual(anomalySort(unordered[0], unordered[1]), 0); assert.deepEqual(unordered.sort(anomalySort).map(anomaly => anomaly.diameter), [12,14]); first.close(); second.close();
});
