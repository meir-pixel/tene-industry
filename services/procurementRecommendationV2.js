'use strict';

const crypto = require('node:crypto');
const { projectMaterialCoverageV2 } = require('./materialCoverageProjectionV2');

class ProcurementRecommendationError extends Error { constructor(code) { super(code); this.name = 'ProcurementRecommendationError'; this.code = code; } }
const fail = code => { throw new ProcurementRecommendationError(code); };
const kg = value => Number(Number(value || 0).toFixed(3));
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fingerprint = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const positive = (value, code) => { const number = Number(value); if (!Number.isFinite(number) || number <= 0) fail(code); return kg(number); };
const normalizeText = value => value === undefined || value === null || value === '' ? null : String(value).trim() || null;

function specFromRequirement(requirement) {
  return { diameter: Number(requirement.diameter), material_type: requirement.material_type, supply_form: requirement.material_type, grade: null, standard_code: null, nominal_length_mm: null };
}
function normalizedSpec(input = {}) {
  const diameter = Number(input.diameter);
  const materialType = normalizeText(input.material_type ?? input.materialType ?? input.supply_form ?? input.supplyForm);
  if (!Number.isFinite(diameter) || diameter <= 0 || !['coil', 'straight'].includes(materialType)) fail('invalid_specification');
  return { diameter, material_type: materialType, supply_form: materialType, grade: normalizeText(input.grade), standard_code: normalizeText(input.standard_code ?? input.standardCode), nominal_length_mm: input.nominal_length_mm ?? input.nominalLengthMm ?? null };
}
function sameSpec(left, right) {
  return Number(left.diameter) === Number(right.diameter) && left.material_type === right.material_type &&
    normalizeText(left.grade) === normalizeText(right.grade) && normalizeText(left.standard_code) === normalizeText(right.standard_code) &&
    String(left.nominal_length_mm ?? '') === String(right.nominal_length_mm ?? '');
}
function sameRequirementIdentity(left, right) {
  return Number(left.diameter) === Number(right.diameter) && left.material_type === right.material_type;
}
function projectionSnapshot(db, spec) {
  const projection = projectMaterialCoverageV2(db);
  return projection.groups.filter(group => Number(group.diameter) === Number(spec.diameter) && group.material_type === spec.material_type);
}
function openRequirement(db, id) {
  const requirement = db.prepare("SELECT r.* FROM material_requirements_v2 r JOIN orders o ON o.id=r.order_id WHERE r.id=? AND r.status='open' AND r.lifecycle_version=2 AND o.inventory_lifecycle_version=2").get(id);
  if (!requirement || !['coil', 'straight'].includes(requirement.material_type)) fail('open_lifecycle_v2_requirement_required');
  return requirement;
}
function normalizeLinks(db, links, recommendedKg, spec) {
  if (!Array.isArray(links) || !links.length) fail('requirement_links_required');
  const seen = new Set(); let total = 0;
  const normalized = links.map(link => {
    const id = Number(link.material_requirement_id ?? link.materialRequirementId);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) fail('invalid_requirement_links'); seen.add(id);
    const requirement = openRequirement(db, id); const amount = positive(link.recommended_kg ?? link.recommendedKg, 'invalid_recommended_kg');
    if (amount > kg(requirement.required_kg) || !sameRequirementIdentity(spec, specFromRequirement(requirement))) fail('requirement_specification_mismatch');
    total = kg(total + amount);
    return { requirement, amount, spec: specFromRequirement(requirement) };
  });
  if (total !== recommendedKg) fail('recommendation_link_total_mismatch');
  return normalized;
}
function getRecommendation(db, id, { projectFreshness = true } = {}) {
  const row = db.prepare('SELECT * FROM procurement_recommendations_v2 WHERE id=?').get(Number(id)); if (!row) return null;
  const links = db.prepare('SELECT * FROM procurement_recommendation_requirement_links_v2 WHERE recommendation_id=? ORDER BY id').all(row.id);
  const events = db.prepare('SELECT * FROM procurement_recommendation_events_v2 WHERE recommendation_id=? ORDER BY id').all(row.id);
  const stale = projectFreshness && isStale(db, row, links);
  return { ...row, spec_snapshot: JSON.parse(row.spec_snapshot_json), coverage_snapshot: JSON.parse(row.coverage_snapshot_json), links: links.map(link => ({ ...link, spec_snapshot: JSON.parse(link.spec_snapshot_json) })), events, projected_freshness_status: stale ? 'stale' : row.freshness_status };
}
function isStale(db, row, links) {
  const spec = JSON.parse(row.spec_snapshot_json);
  if (stable(projectionSnapshot(db, spec)) !== row.coverage_snapshot_json) return true;
  return links.some(link => {
    const requirement = db.prepare('SELECT * FROM material_requirements_v2 WHERE id=?').get(link.material_requirement_id);
    if (!requirement || requirement.status !== 'open' || Number(requirement.lifecycle_version) !== 2) return true;
    return requirement.requirement_uid !== link.requirement_uid || (requirement.source_revision ?? null) !== (link.requirement_revision_snapshot ?? null) || Number(requirement.required_kg) !== Number(link.required_kg_snapshot) || !sameRequirementIdentity(spec, specFromRequirement(requirement));
  });
}
function replayEvent(db, key, payload) {
  const event = db.prepare('SELECT * FROM procurement_recommendation_events_v2 WHERE idempotency_key=?').get(key);
  if (!event) return null;
  if (event.payload_fingerprint !== fingerprint(payload)) fail('idempotency_key_conflict');
  return getRecommendation(db, event.recommendation_id);
}
function event(db, recommendationId, type, key, payload, actorId, details) {
  db.prepare('INSERT INTO procurement_recommendation_events_v2 (recommendation_id,event_type,idempotency_key,payload_fingerprint,actor_id,details_json) VALUES (?,?,?,?,?,?)').run(recommendationId, type, key, fingerprint(payload), actorId ?? null, JSON.stringify(details));
}
function markStale(db, row, links, actorId = null) {
  if (!isStale(db, row, links)) return false;
  if (row.freshness_status === 'stale') return true;
  db.prepare("UPDATE procurement_recommendations_v2 SET freshness_status='stale',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  event(db, row.id, 'stale_detected', `stale:${row.id}:${row.updated_at}`, { action: 'stale_detected', recommendation_id: row.id, snapshot: row.coverage_snapshot_json }, actorId, { reason: 'source_snapshot_changed' });
  return true;
}
function createDraft(db, input = {}) {
  const key = String(input.idempotency_key ?? input.idempotencyKey ?? '').trim(); if (!key) fail('idempotency_key_required');
  const spec = normalizedSpec(input.specification ?? input.spec ?? input); const recommendedKg = positive(input.recommended_kg ?? input.recommendedKg, 'invalid_recommended_kg');
  const payload = { action: 'create', catalog_item_id: Number(input.catalog_item_id ?? input.catalogItemId) || null, spec, recommended_kg: recommendedKg, links: input.links };
  const tx = db.transaction(() => {
    const replay = db.prepare('SELECT * FROM procurement_recommendations_v2 WHERE idempotency_key=?').get(key);
    if (replay) { if (replay.payload_fingerprint !== fingerprint(payload)) fail('idempotency_key_conflict'); return getRecommendation(db, replay.id); }
    const catalogItemId = payload.catalog_item_id;
    let identity = catalogItemId ? 'complete' : 'partial';
    if (catalogItemId) { const item = db.prepare("SELECT * FROM catalog_items WHERE id=? AND item_kind='raw_material' AND active=1").get(catalogItemId); if (!item) fail('catalog_item_not_found'); if (!sameSpec(spec, { diameter: Number(item.diameter_key), material_type: item.supply_form, grade: item.steel_grade, standard_code: item.standard_code, nominal_length_mm: item.nominal_length_mm })) fail('catalog_item_specification_mismatch'); }
    const links = normalizeLinks(db, input.links, recommendedKg, spec); const coverage = stable(projectionSnapshot(db, spec));
    const result = db.prepare('INSERT INTO procurement_recommendations_v2 (recommendation_uid,catalog_item_id,spec_snapshot_json,spec_identity_status,recommended_kg,coverage_snapshot_json,idempotency_key,payload_fingerprint,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), catalogItemId, stable(spec), identity, recommendedKg, coverage, key, fingerprint(payload), input.created_by ?? input.createdBy ?? null);
    const insert = db.prepare('INSERT INTO procurement_recommendation_requirement_links_v2 (recommendation_id,material_requirement_id,requirement_uid,requirement_revision_snapshot,required_kg_snapshot,recommended_kg,spec_snapshot_json) VALUES (?,?,?,?,?,?,?)');
    for (const link of links) insert.run(result.lastInsertRowid, link.requirement.id, link.requirement.requirement_uid, link.requirement.source_revision ?? null, link.requirement.required_kg, link.amount, stable(link.spec));
    event(db, result.lastInsertRowid, 'created', `create:${key}`, { action: 'created', payload }, input.created_by ?? input.createdBy ?? null, { recommended_kg: recommendedKg });
    return getRecommendation(db, result.lastInsertRowid);
  }); return tx.immediate();
}
function refreshDraft(db, input = {}) {
  const id = Number(input.recommendation_id ?? input.recommendationId); const key = String(input.idempotency_key ?? input.idempotencyKey ?? '').trim(); if (!id || !key) fail('idempotency_key_required');
  const payload = { action: 'refresh', recommendation_id: id, specification: input.specification ?? input.spec, recommended_kg: input.recommended_kg ?? input.recommendedKg, links: input.links };
  const tx = db.transaction(() => {
    const replay = replayEvent(db, key, payload); if (replay) return replay;
    const row = db.prepare("SELECT * FROM procurement_recommendations_v2 WHERE id=? AND status='draft'").get(id); if (!row) fail('draft_recommendation_required');
    const spec = normalizedSpec(input.specification ?? input.spec ?? JSON.parse(row.spec_snapshot_json)); const amount = positive(input.recommended_kg ?? input.recommendedKg, 'invalid_recommended_kg'); const links = normalizeLinks(db, input.links, amount, spec); const coverage = stable(projectionSnapshot(db, spec));
    db.prepare("UPDATE procurement_recommendations_v2 SET spec_snapshot_json=?,recommended_kg=?,coverage_snapshot_json=?,freshness_status='current',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(stable(spec), amount, coverage, id);
    db.prepare('DELETE FROM procurement_recommendation_requirement_links_v2 WHERE recommendation_id=?').run(id);
    const insert = db.prepare('INSERT INTO procurement_recommendation_requirement_links_v2 (recommendation_id,material_requirement_id,requirement_uid,requirement_revision_snapshot,required_kg_snapshot,recommended_kg,spec_snapshot_json) VALUES (?,?,?,?,?,?,?)');
    for (const link of links) insert.run(id, link.requirement.id, link.requirement.requirement_uid, link.requirement.source_revision ?? null, link.requirement.required_kg, link.amount, stable(link.spec));
    event(db, id, 'refreshed', key, payload, input.refreshed_by ?? input.refreshedBy ?? null, { recommended_kg: amount }); return getRecommendation(db, id);
  }); return tx.immediate();
}
function transition(db, input, next) {
  const id = Number(input.recommendation_id ?? input.recommendationId); const key = String(input.idempotency_key ?? input.idempotencyKey ?? '').trim(); if (!id || !key) fail('idempotency_key_required');
  const payload = { action: next, recommendation_id: id, notes: input.notes ?? null };
  const preflight = db.transaction(() => {
    const row = db.prepare("SELECT * FROM procurement_recommendations_v2 WHERE id=? AND status='draft'").get(id); if (!row) return false;
    const links = db.prepare('SELECT * FROM procurement_recommendation_requirement_links_v2 WHERE recommendation_id=? ORDER BY id').all(id);
    return markStale(db, row, links, input.decided_by ?? input.decidedBy ?? null);
  });
  if (preflight.immediate()) fail('recommendation_stale');
  const tx = db.transaction(() => {
    const replay = replayEvent(db, key, payload); if (replay) return replay;
    const row = db.prepare("SELECT * FROM procurement_recommendations_v2 WHERE id=? AND status='draft'").get(id); if (!row) fail('draft_recommendation_required');
    db.prepare("UPDATE procurement_recommendations_v2 SET status=?,approved_by=?,decision_notes=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next, input.decided_by ?? input.decidedBy ?? null, input.notes ?? null, id);
    event(db, id, next, key, payload, input.decided_by ?? input.decidedBy ?? null, {}); return getRecommendation(db, id);
  }); return tx.immediate();
}
function reconcileRecommendation(db, input = {}) {
  const id = Number(input.recommendation_id ?? input.recommendationId); const key = String(input.idempotency_key ?? input.idempotencyKey ?? '').trim(); if (!id || !key) fail('idempotency_key_required'); const payload = { action: 'reconcile', recommendation_id: id };
  const tx = db.transaction(() => { const replay = replayEvent(db, key, payload); if (replay) return replay; const row = db.prepare('SELECT * FROM procurement_recommendations_v2 WHERE id=?').get(id); if (!row) fail('recommendation_not_found'); const links = db.prepare('SELECT * FROM procurement_recommendation_requirement_links_v2 WHERE recommendation_id=? ORDER BY id').all(id); const stale = markStale(db, row, links, input.reconciled_by ?? input.reconciledBy ?? null); event(db, id, 'updated', key, payload, input.reconciled_by ?? input.reconciledBy ?? null, { stale }); return getRecommendation(db, id); }); return tx.immediate();
}
function listRecommendations(db) { return db.prepare('SELECT id FROM procurement_recommendations_v2 ORDER BY id DESC').all().map(row => getRecommendation(db, row.id)); }
module.exports = { ProcurementRecommendationError, createDraft, refreshDraft, approveRecommendation: (db, input) => transition(db, input, 'approved'), rejectRecommendation: (db, input) => transition(db, input, 'rejected'), cancelRecommendation: (db, input) => transition(db, input, 'cancelled'), reconcileRecommendation, getRecommendation, listRecommendations };
