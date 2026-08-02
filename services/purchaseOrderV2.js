'use strict';

const crypto = require('node:crypto');

class PurchaseOrderV2Error extends Error { constructor(code) { super(code); this.name = 'PurchaseOrderV2Error'; this.code = code; } }
const fail = code => { throw new PurchaseOrderV2Error(code); };
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fingerprint = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const kg = value => Number(Number(value).toFixed(3));
const text = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const id = value => { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; };
const currency = value => { const code = String(value ?? 'ILS').trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(code)) fail('invalid_currency_code'); return code; };
const expectedRevision = value => { const revision = Number(value); if (!Number.isSafeInteger(revision) || revision < 1) fail('expected_revision_required'); return revision; };
const positiveKg = value => { const number = Number(value); if (!Number.isFinite(number) || number <= 0) fail('invalid_ordered_kg'); return kg(number); };
const price = value => { const number = Number(value); if (!Number.isFinite(number) || number < 0) fail('invalid_unit_price_per_kg'); return number; };
function decimalParts(value) {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) fail('invalid_line_amount');
  const [integer, fraction = ''] = raw.split('.');
  return { digits: BigInt(`${integer}${fraction}`), scale: fraction.length };
}
function halfUp(left, right) {
  const a = decimalParts(left); const b = decimalParts(right); const product = a.digits * b.digits; const scale = a.scale + b.scale;
  if (scale <= 2) return Number(product * (10n ** BigInt(2 - scale))) / 100;
  const divisor = 10n ** BigInt(scale - 2); const quotient = product / divisor; const remainder = product % divisor;
  return Number(quotient + (remainder * 2n >= divisor ? 1n : 0n)) / 100;
}

function specification(input = {}) {
  const diameter = Number(input.diameter);
  const materialType = text(input.material_type ?? input.materialType ?? input.supply_form ?? input.supplyForm);
  if (!Number.isFinite(diameter) || diameter <= 0 || !['coil', 'straight'].includes(materialType)) fail('invalid_specification');
  const nominalLength = input.nominal_length_mm ?? input.nominalLengthMm ?? null;
  if (nominalLength !== null && nominalLength !== '' && (!Number.isFinite(Number(nominalLength)) || Number(nominalLength) <= 0)) fail('invalid_nominal_length_mm');
  return { diameter, material_type: materialType, supply_form: materialType, grade: text(input.grade), standard_code: text(input.standard_code ?? input.standardCode), nominal_length_mm: nominalLength === null || nominalLength === '' ? null : Number(nominalLength) };
}
function sameSpec(left, right) {
  return Number(left.diameter) === Number(right.diameter) && left.material_type === right.material_type &&
    text(left.grade) === text(right.grade) && text(left.standard_code) === text(right.standard_code) &&
    String(left.nominal_length_mm ?? '') === String(right.nominal_length_mm ?? '');
}
function supplier(db, supplierId, required = false) {
  if (!supplierId) { if (required) fail('supplier_required'); return null; }
  const row = db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(supplierId);
  if (!row) fail('active_supplier_required');
  return supplierId;
}
function normalizeLines(db, rows) {
  if (!Array.isArray(rows) || !rows.length) fail('purchase_order_lines_required');
  return rows.map((row, index) => {
    const spec = specification(row.specification ?? row.spec ?? row);
    const catalogItemId = id(row.catalog_item_id ?? row.catalogItemId);
    if (catalogItemId) {
      const item = db.prepare("SELECT * FROM catalog_items WHERE id=? AND item_kind='raw_material' AND active=1").get(catalogItemId);
      if (!item) fail('catalog_item_not_found');
      if (!sameSpec(spec, { diameter: Number(item.diameter_key), material_type: item.supply_form, grade: item.steel_grade, standard_code: item.standard_code, nominal_length_mm: item.nominal_length_mm })) fail('catalog_item_specification_mismatch');
    }
    const recommendationId = row.source_recommendation_id ?? row.sourceRecommendationId ?? null;
    if (recommendationId !== null && recommendationId !== undefined && !id(recommendationId)) fail('invalid_source_recommendation');
    const orderedKg = positiveKg(row.ordered_kg ?? row.orderedKg);
    const unitPricePerKg = price(row.unit_price_per_kg ?? row.unitPricePerKg);
    const suppliedAmount = row.line_amount ?? row.lineAmount;
    if (suppliedAmount !== undefined && suppliedAmount !== null && Number(suppliedAmount) !== halfUp(orderedKg, unitPricePerKg)) fail('line_amount_mismatch');
    return { line_sequence: index + 1, catalog_item_id: catalogItemId, source_recommendation_id: id(recommendationId), spec, ordered_kg: orderedKg, unit_price_per_kg: unitPricePerKg };
  });
}
function sourceRecommendation(db, recommendationId) {
  const row = db.prepare('SELECT * FROM procurement_recommendations_v2 WHERE id=?').get(recommendationId);
  if (!row || row.status !== 'approved') fail('source_recommendation_not_approved');
  if (row.freshness_status !== 'current') fail('source_recommendation_stale');
  return row;
}
function guardRecommendationQuantity(db, lines, excludePurchaseOrderId = null) {
  const requested = new Map();
  for (const line of lines) {
    if (!line.source_recommendation_id) continue;
    requested.set(line.source_recommendation_id, kg((requested.get(line.source_recommendation_id) || 0) + line.ordered_kg));
  }
  for (const [recommendationId, orderedKg] of requested) {
    const recommendation = sourceRecommendation(db, recommendationId);
    const recommendationSpec = JSON.parse(recommendation.spec_snapshot_json);
    if (lines.filter(line => line.source_recommendation_id === recommendationId).some(line => !sameSpec(line.spec ?? JSON.parse(line.spec_snapshot_json), recommendationSpec))) fail('source_recommendation_specification_mismatch');
    const existing = db.prepare(`SELECT COALESCE(SUM(l.ordered_kg),0) AS kg
      FROM purchase_order_lines_v2 l JOIN purchase_orders_v2 po ON po.id=l.purchase_order_id
      WHERE l.source_recommendation_id=? AND po.status <> 'cancelled' AND po.id <> COALESCE(?, -1)`).get(recommendationId, excludePurchaseOrderId).kg;
    if (kg(Number(existing) + orderedKg) > kg(recommendation.recommended_kg)) fail('source_recommendation_quantity_exceeded');
  }
}
function linesFor(db, purchaseOrderId) { return db.prepare('SELECT * FROM purchase_order_lines_v2 WHERE purchase_order_id=? ORDER BY line_sequence,id').all(purchaseOrderId); }
function auditSnapshot(row, lines) {
  return {
    header: { id: row.id, po_uid: row.po_uid, supplier_id: row.supplier_id ?? null, currency_code: row.currency_code, status: row.status, revision: Number(row.revision), notes: row.notes ?? null, cancellation_reason: row.cancellation_reason ?? null },
    lines: lines.map(line => ({ line_uid: line.line_uid, line_sequence: Number(line.line_sequence), catalog_item_id: line.catalog_item_id ?? null, source_recommendation_id: line.source_recommendation_id ?? null, spec_snapshot: JSON.parse(line.spec_snapshot_json), ordered_kg: Number(line.ordered_kg), unit_price_per_kg: Number(line.unit_price_per_kg), line_amount: line.line_amount === null ? null : Number(line.line_amount) })),
  };
}
function getPurchaseOrder(db, purchaseOrderId) {
  const row = db.prepare('SELECT * FROM purchase_orders_v2 WHERE id=?').get(Number(purchaseOrderId));
  if (!row) return null;
  const lines = linesFor(db, row.id); const events = db.prepare('SELECT * FROM purchase_order_events_v2 WHERE purchase_order_id=? ORDER BY id').all(row.id);
  return { ...row, lines: auditSnapshot(row, lines).lines, events };
}
function replayEvent(db, key, payload) {
  const row = db.prepare('SELECT * FROM purchase_order_events_v2 WHERE idempotency_key=?').get(key);
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint(payload)) fail('idempotency_key_conflict');
  return getPurchaseOrder(db, row.purchase_order_id);
}
function event(db, purchaseOrderId, type, key, payload, actorId, details) {
  db.prepare('INSERT INTO purchase_order_events_v2 (purchase_order_id,event_type,idempotency_key,payload_fingerprint,actor_id,details_json) VALUES (?,?,?,?,?,?)').run(purchaseOrderId, type, key, fingerprint(payload), actorId ?? null, JSON.stringify(details));
}
function insertLines(db, purchaseOrderId, lines) {
  const insert = db.prepare('INSERT INTO purchase_order_lines_v2 (line_uid,purchase_order_id,line_sequence,catalog_item_id,source_recommendation_id,spec_snapshot_json,ordered_kg,unit_price_per_kg) VALUES (?,?,?,?,?,?,?,?)');
  for (const line of lines) insert.run(crypto.randomUUID(), purchaseOrderId, line.line_sequence, line.catalog_item_id, line.source_recommendation_id, stable(line.spec), line.ordered_kg, line.unit_price_per_kg);
}
function createDraft(db, input = {}) {
  const key = text(input.idempotency_key ?? input.idempotencyKey); if (!key) fail('idempotency_key_required');
  const suppliedSupplier = input.supplier_id ?? input.supplierId;
  const supplierId = suppliedSupplier === undefined || suppliedSupplier === null ? null : id(suppliedSupplier); if (suppliedSupplier !== undefined && suppliedSupplier !== null && !supplierId) fail('invalid_supplier_id');
  const lines = normalizeLines(db, input.lines); const payload = { action: 'create', supplier_id: supplierId, currency_code: currency(input.currency_code ?? input.currencyCode), notes: text(input.notes), lines };
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM purchase_orders_v2 WHERE idempotency_key=?').get(key);
    if (existing) { if (existing.payload_fingerprint !== fingerprint(payload)) fail('idempotency_key_conflict'); return getPurchaseOrder(db, existing.id); }
    supplier(db, supplierId); guardRecommendationQuantity(db, lines);
    const result = db.prepare('INSERT INTO purchase_orders_v2 (po_uid,supplier_id,currency_code,notes,idempotency_key,payload_fingerprint,created_by) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), supplierId, payload.currency_code, payload.notes, key, fingerprint(payload), input.created_by ?? input.createdBy ?? null);
    insertLines(db, result.lastInsertRowid, lines); const after = getPurchaseOrder(db, result.lastInsertRowid);
    event(db, result.lastInsertRowid, 'created', `create:${key}`, { action: 'created', payload }, input.created_by ?? input.createdBy ?? null, { after: auditSnapshot(after, linesFor(db, after.id)) });
    return after;
  }); return tx.immediate();
}
function updateDraft(db, input = {}) {
  const purchaseOrderId = id(input.purchase_order_id ?? input.purchaseOrderId); const key = text(input.idempotency_key ?? input.idempotencyKey); if (!purchaseOrderId || !key) fail('idempotency_key_required');
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM purchase_orders_v2 WHERE id=?').get(purchaseOrderId); if (!row) fail('purchase_order_not_found');
    const revision = expectedRevision(input.expected_revision ?? input.expectedRevision); const lines = normalizeLines(db, input.lines); const supplierRaw = input.supplier_id ?? input.supplierId;
    const supplierId = supplierRaw === undefined ? row.supplier_id : id(supplierRaw); if (supplierRaw !== undefined && supplierRaw !== null && !supplierId) fail('invalid_supplier_id');
    const payload = { action: 'update', purchase_order_id: purchaseOrderId, expected_revision: revision, supplier_id: supplierId, currency_code: currency(input.currency_code ?? input.currencyCode ?? row.currency_code), notes: input.notes === undefined ? row.notes ?? null : text(input.notes), lines };
    const replay = replayEvent(db, key, payload); if (replay) return replay;
    if (row.status !== 'draft') fail('draft_purchase_order_required');
    if (Number(row.revision) !== revision) fail('purchase_order_revision_conflict'); supplier(db, supplierId); guardRecommendationQuantity(db, lines, purchaseOrderId);
    const before = auditSnapshot(row, linesFor(db, purchaseOrderId)); db.prepare('DELETE FROM purchase_order_lines_v2 WHERE purchase_order_id=?').run(purchaseOrderId);
    db.prepare('UPDATE purchase_orders_v2 SET supplier_id=?,currency_code=?,notes=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(supplierId, payload.currency_code, payload.notes, purchaseOrderId); insertLines(db, purchaseOrderId, lines);
    const afterRow = db.prepare('SELECT * FROM purchase_orders_v2 WHERE id=?').get(purchaseOrderId); const afterLines = linesFor(db, purchaseOrderId); event(db, purchaseOrderId, 'updated', key, payload, input.updated_by ?? input.updatedBy ?? null, { before, after: auditSnapshot(afterRow, afterLines) });
    return getPurchaseOrder(db, purchaseOrderId);
  }); return tx.immediate();
}
function transition(db, input = {}, next) {
  const purchaseOrderId = id(input.purchase_order_id ?? input.purchaseOrderId); const key = text(input.idempotency_key ?? input.idempotencyKey); if (!purchaseOrderId || !key) fail('idempotency_key_required');
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM purchase_orders_v2 WHERE id=?').get(purchaseOrderId); if (!row) fail('purchase_order_not_found');
    const revision = expectedRevision(input.expected_revision ?? input.expectedRevision); const payload = { action: next, purchase_order_id: purchaseOrderId, expected_revision: revision, reason: text(input.reason ?? input.cancellation_reason ?? input.cancellationReason) };
    const replay = replayEvent(db, key, payload); if (replay) return replay;
    if (Number(row.revision) !== revision) fail('purchase_order_revision_conflict'); const lines = linesFor(db, purchaseOrderId); const before = auditSnapshot(row, lines);
    if (next === 'approved') {
      if (row.status !== 'draft') fail('purchase_order_approval_requires_draft'); supplier(db, row.supplier_id, true); currency(row.currency_code); guardRecommendationQuantity(db, lines, purchaseOrderId);
      for (const line of lines) db.prepare('UPDATE purchase_order_lines_v2 SET line_amount=? WHERE id=?').run(halfUp(line.ordered_kg, line.unit_price_per_kg), line.id);
      db.prepare("UPDATE purchase_orders_v2 SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.approved_by ?? input.approvedBy ?? null, purchaseOrderId);
    } else if (next === 'issued') {
      if (row.status !== 'approved') fail('purchase_order_issue_requires_approved'); supplier(db, row.supplier_id, true); currency(row.currency_code);
      db.prepare("UPDATE purchase_orders_v2 SET status='issued',issued_by=?,issued_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.issued_by ?? input.issuedBy ?? null, purchaseOrderId);
    } else {
      if (!['draft','approved','issued'].includes(row.status)) fail('purchase_order_cancellation_not_allowed'); if (!payload.reason) fail('cancellation_reason_required');
      db.prepare("UPDATE purchase_orders_v2 SET status='cancelled',cancellation_reason=?,cancelled_by=?,cancelled_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(payload.reason, input.cancelled_by ?? input.cancelledBy ?? null, purchaseOrderId);
    }
    const afterRow = db.prepare('SELECT * FROM purchase_orders_v2 WHERE id=?').get(purchaseOrderId); const afterLines = linesFor(db, purchaseOrderId); event(db, purchaseOrderId, next, key, payload, input[`${next}_by`] ?? input.actor_id ?? input.actorId ?? null, { before, after: auditSnapshot(afterRow, afterLines) });
    return getPurchaseOrder(db, purchaseOrderId);
  }); return tx.immediate();
}
function listPurchaseOrders(db) { return db.prepare('SELECT id FROM purchase_orders_v2 ORDER BY id DESC').all().map(row => getPurchaseOrder(db, row.id)); }
module.exports = { PurchaseOrderV2Error, createDraft, updateDraft, approvePurchaseOrder: (db, input) => transition(db, input, 'approved'), issuePurchaseOrder: (db, input) => transition(db, input, 'issued'), cancelPurchaseOrder: (db, input) => transition(db, input, 'cancelled'), getPurchaseOrder, listPurchaseOrders, halfUp };
