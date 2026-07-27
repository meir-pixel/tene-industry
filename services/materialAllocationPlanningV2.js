'use strict';

const crypto = require('node:crypto');

const SUPPORTED_MATERIAL_TYPES = new Set(['coil', 'straight']);

class MaterialAllocationPlanningError extends Error {
  constructor(code, message = code) { super(message); this.name = 'MaterialAllocationPlanningError'; this.code = code; }
}
const fail = code => { throw new MaterialAllocationPlanningError(code); };
const kg = value => Number(Number(value || 0).toFixed(3));
const positive = (value, code) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) fail(code); return kg(n); };
const stable = value => JSON.stringify(value, Object.keys(value).sort());
const fingerprint = value => crypto.createHash('sha256').update(stable(value)).digest('hex');

function activeRequirement(db, id) {
  const requirement = db.prepare(`SELECT * FROM material_requirements_v2 WHERE id=? AND status='open'`).get(id);
  if (!requirement) fail('open_material_requirement_required');
  if (Number(requirement.lifecycle_version) !== 2 || !SUPPORTED_MATERIAL_TYPES.has(requirement.material_type)) fail('unsupported_requirement');
  const order = db.prepare('SELECT inventory_lifecycle_version FROM orders WHERE id=?').get(requirement.order_id);
  if (!order || Number(order.inventory_lifecycle_version) !== 2) fail('lifecycle_v2_required');
  return requirement;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) fail('allocation_lines_required');
  const seen = new Set();
  return lines.map((line, index) => {
    const rawMaterialId = Number(line.raw_material_id ?? line.rawMaterialId);
    if (!Number.isSafeInteger(rawMaterialId) || rawMaterialId <= 0 || seen.has(rawMaterialId)) fail('invalid_allocation_lines');
    seen.add(rawMaterialId);
    return { rawMaterialId, allocatedKg: positive(line.allocated_kg ?? line.allocatedKg, 'invalid_allocated_kg'), sequence: index + 1 };
  });
}

function activeAllocatedForLot(db, rawMaterialId) {
  return kg(db.prepare(`SELECT COALESCE(SUM(l.allocated_kg),0) AS total
    FROM allocation_plan_lines_v2 l JOIN allocation_plans_v2 p ON p.id=l.allocation_plan_id
    WHERE l.raw_material_id=? AND l.status='active' AND p.status='active'`).get(rawMaterialId).total);
}

function suggestionRows(db, requirement) {
  return db.prepare(`SELECT r.*, COALESCE(SUM(l.allocated_kg),0) AS planned_kg
    FROM raw_material r
    LEFT JOIN allocation_plan_lines_v2 l ON l.raw_material_id=r.id AND l.status='active'
    LEFT JOIN allocation_plans_v2 p ON p.id=l.allocation_plan_id AND p.status='active'
    WHERE r.active=1 AND COALESCE(r.verification_status,'approved')='approved'
      AND r.diameter=? AND COALESCE(r.material_type,'coil')=?
    GROUP BY r.id ORDER BY date(COALESCE(r.received_date,r.created_at)) ASC, r.id ASC`).all(requirement.diameter, requirement.material_type);
}

function suggestFifoLots(db, { material_requirement_id }) {
  const requirement = activeRequirement(db, Number(material_requirement_id));
  let remaining = kg(requirement.required_kg);
  const lines = [];
  for (const row of suggestionRows(db, requirement)) {
    const free = kg(Number(row.weight_received || 0) - Number(row.weight_used || 0) - Number(row.weight_scrapped || 0) - Number(row.planned_kg || 0));
    const allocatedKg = kg(Math.min(Math.max(0, free), remaining));
    if (allocatedKg > 0) lines.push({ raw_material_id: row.id, allocated_kg: allocatedKg });
    remaining = kg(Math.max(0, remaining - allocatedKg));
  }
  return { material_requirement_id: requirement.id, requirement_uid: requirement.requirement_uid, required_kg: kg(requirement.required_kg), lines, uncovered_kg: remaining };
}

function confirmAllocationPlan(db, input = {}) {
  const requirementId = Number(input.material_requirement_id ?? input.materialRequirementId);
  const idempotencyKey = String(input.idempotency_key ?? input.idempotencyKey ?? '').trim();
  if (!Number.isSafeInteger(requirementId) || requirementId <= 0 || !idempotencyKey) fail('idempotency_key_required');
  const lines = normalizeLines(input.lines || []);
  const payload = { material_requirement_id: requirementId, lines: lines.map(({ rawMaterialId, allocatedKg }) => ({ rawMaterialId, allocatedKg })) };
  const payloadFingerprint = fingerprint(payload);
  const create = db.transaction(payloadInput => {
    const replay = db.prepare('SELECT * FROM allocation_plans_v2 WHERE idempotency_key=?').get(idempotencyKey);
    if (replay) {
      if (replay.payload_fingerprint !== payloadFingerprint) fail('idempotency_key_conflict');
      return getAllocationPlan(db, replay.id);
    }
    const requirement = activeRequirement(db, requirementId);
    const total = kg(lines.reduce((sum, line) => sum + line.allocatedKg, 0));
    if (total > kg(requirement.required_kg)) fail('allocation_exceeds_requirement');
    for (const line of lines) {
      const lot = db.prepare(`SELECT * FROM raw_material WHERE id=? AND active=1
        AND COALESCE(verification_status,'approved')='approved'`).get(line.rawMaterialId);
      if (!lot || Number(lot.diameter) !== Number(requirement.diameter) || String(lot.material_type || 'coil') !== requirement.material_type) fail('invalid_allocation_lot');
      const free = kg(Number(lot.weight_received || 0) - Number(lot.weight_used || 0) - Number(lot.weight_scrapped || 0) - activeAllocatedForLot(db, lot.id));
      if (line.allocatedKg > free) fail('over_allocation');
    }
    const result = db.prepare(`INSERT INTO allocation_plans_v2
      (plan_uid,idempotency_key,payload_fingerprint,material_requirement_id,requirement_uid,required_kg,source_revision,planned_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), idempotencyKey, payloadFingerprint, requirement.id,
      requirement.requirement_uid, kg(requirement.required_kg), requirement.source_revision ?? null, input.planned_by ?? input.plannedBy ?? null);
    const insertLine = db.prepare(`INSERT INTO allocation_plan_lines_v2
      (allocation_plan_id,raw_material_id,allocated_kg,allocation_sequence) VALUES (?,?,?,?)`);
    for (const line of lines) insertLine.run(result.lastInsertRowid, line.rawMaterialId, line.allocatedKg, line.sequence);
    return getAllocationPlan(db, result.lastInsertRowid);
  });
  return create.immediate(payload);
}

function getAllocationPlan(db, planId) {
  const plan = db.prepare('SELECT * FROM allocation_plans_v2 WHERE id=?').get(planId);
  if (!plan) return null;
  const lines = db.prepare(`SELECT raw_material_id,allocated_kg,status,allocation_sequence FROM allocation_plan_lines_v2
    WHERE allocation_plan_id=? ORDER BY allocation_sequence`).all(planId);
  const activeKg = kg(lines.filter(line => line.status === 'active').reduce((sum, line) => sum + Number(line.allocated_kg), 0));
  return { ...plan, lines, uncovered_kg: kg(Number(plan.required_kg) - activeKg) };
}

function releaseAllocationPlan(db, { allocation_plan_id, released_by, reason = 'released' } = {}) {
  const planId = Number(allocation_plan_id);
  const release = db.transaction(() => {
    const plan = db.prepare("SELECT * FROM allocation_plans_v2 WHERE id=? AND status='active'").get(planId);
    if (!plan) fail('active_allocation_plan_required');
    db.prepare("UPDATE allocation_plan_lines_v2 SET status='released',released_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE allocation_plan_id=? AND status='active'").run(planId);
    db.prepare("UPDATE allocation_plans_v2 SET status='released',released_by=?,released_at=CURRENT_TIMESTAMP,release_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(released_by ?? null, reason, planId);
    return getAllocationPlan(db, planId);
  });
  return release.immediate();
}

module.exports = { MaterialAllocationPlanningError, suggestFifoLots, confirmAllocationPlan, releaseAllocationPlan, getAllocationPlan };
