'use strict';

const VALID_MATERIAL_TYPES = new Set(['coil', 'straight']);
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db, table) {
  if (!tableExists(db, table)) return new Set();
  return new Set(db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(table).map(row => row.name));
}

function strictPositiveNumber(value) {
  let normalized;
  if (typeof value === 'number') normalized = value;
  else if (typeof value === 'string' && DECIMAL_TEXT.test(value.trim())) normalized = Number(value.trim());
  else return null;
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function normalizeMaterialType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return VALID_MATERIAL_TYPES.has(normalized) ? normalized : null;
}

function validDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? normalized
    : null;
}

function generatedAt(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('clock must return a valid date');
  return date.toISOString();
}

function collectLegacyMaterialEvidence(db, row, schema) {
  const evidence = [];

  if (schema.reservations.has('item_id') && schema.reservations.has('order_id') && schema.reservations.has('material_type')) {
    const reservations = db.prepare(`
      SELECT id, material_type
      FROM inventory_reservations
      WHERE order_id=? AND item_id=?
      ORDER BY id ASC
    `).all(row.orderId, row.itemId);
    for (const reservation of reservations) {
      evidence.push({ source: 'inventory_reservation', sourceId: reservation.id, rawValue: reservation.material_type });
    }
  }

  if (row.batchId !== null && row.batchId !== undefined && schema.rawMaterial.has('id') && schema.rawMaterial.has('material_type')) {
    const lot = db.prepare('SELECT id, material_type FROM raw_material WHERE id=?').get(row.batchId);
    if (lot) evidence.push({ source: 'linked_raw_material_lot', sourceId: lot.id, rawValue: lot.material_type });
  }

  if (
    schema.usage.has('item_id') && schema.usage.has('order_id') && schema.usage.has('raw_material_id') &&
    schema.rawMaterial.has('id') && schema.rawMaterial.has('material_type')
  ) {
    const lots = db.prepare(`
      SELECT u.id AS usage_id, r.id AS raw_material_id, r.material_type
      FROM raw_material_usage u
      JOIN raw_material r ON r.id=u.raw_material_id
      WHERE u.order_id=? AND u.item_id=?
      ORDER BY u.id ASC, r.id ASC
    `).all(row.orderId, row.itemId);
    for (const lot of lots) {
      evidence.push({ source: 'raw_material_usage', sourceId: lot.usage_id, rawMaterialId: lot.raw_material_id, rawValue: lot.material_type });
    }
  }

  return evidence.map(entry => ({ ...entry, materialType: normalizeMaterialType(entry.rawValue) }));
}

function materialTypeAssessment(explicitValue, hasExplicitColumn, legacyEvidence) {
  if (hasExplicitColumn && explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
    const normalized = normalizeMaterialType(explicitValue);
    return normalized
      ? {
          candidate: normalized,
          evidence: { classification: 'explicit', authoritative: true, values: [normalized], sources: ['item'] },
          issue: null,
          ambiguous: false,
        }
      : {
          candidate: null,
          evidence: { classification: 'explicit', authoritative: true, values: [], sources: ['item'] },
          issue: 'invalid_material_type',
          ambiguous: false,
        };
  }

  const validValues = [...new Set(legacyEvidence.map(entry => entry.materialType).filter(Boolean))].sort();
  const hasInvalid = legacyEvidence.some(entry => entry.materialType === null);
  const sources = [...new Set(legacyEvidence.map(entry => entry.source))].sort();

  if (validValues.length > 1 || (validValues.length > 0 && hasInvalid)) {
    return {
      candidate: null,
      evidence: { classification: 'ambiguous_legacy_evidence', authoritative: false, values: validValues, sources },
      issue: 'conflicting_legacy_material_type_evidence',
      ambiguous: true,
    };
  }
  if (validValues.length === 1) {
    return {
      candidate: validValues[0],
      evidence: { classification: 'consistent_legacy_evidence', authoritative: false, values: validValues, sources },
      issue: 'material_type_not_explicit',
      ambiguous: false,
    };
  }
  if (legacyEvidence.length) {
    return {
      candidate: null,
      evidence: { classification: 'ambiguous_legacy_evidence', authoritative: false, values: [], sources },
      issue: 'invalid_legacy_material_type_evidence',
      ambiguous: true,
    };
  }
  return {
    candidate: null,
    evidence: { classification: 'missing', authoritative: false, values: [], sources: [] },
    issue: 'missing_material_type',
    ambiguous: false,
  };
}

function buildMaterialRequirementShadowReport(db, { clock } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');
  const report = {
    generatedAt: generatedAt(clock),
    lifecycleVersion: 2,
    mode: 'shadow_read_only',
    rows: [],
  };

  const orderColumns = tableColumns(db, 'orders');
  const itemColumns = tableColumns(db, 'items');
  if (!orderColumns.has('id') || !itemColumns.has('id')) return report;

  const palletColumns = tableColumns(db, 'pallets');
  const schema = {
    reservations: tableColumns(db, 'inventory_reservations'),
    rawMaterial: tableColumns(db, 'raw_material'),
    usage: tableColumns(db, 'raw_material_usage'),
  };

  const hasDirectOrder = itemColumns.has('order_id');
  const hasPalletOrder = itemColumns.has('pallet_id') && palletColumns.has('id') && palletColumns.has('order_id');
  if (!hasDirectOrder && !hasPalletOrder) return report;

  const orderExpression = hasDirectOrder && hasPalletOrder
    ? 'COALESCE(i.order_id, p.order_id)'
    : (hasDirectOrder ? 'i.order_id' : 'p.order_id');
  const palletJoin = hasPalletOrder ? 'LEFT JOIN pallets p ON p.id=i.pallet_id' : '';
  const lifecycleFilter = orderColumns.has('inventory_lifecycle_version')
    ? 'AND COALESCE(o.inventory_lifecycle_version, 1)=1'
    : '';
  const select = [
    'o.id AS order_id',
    orderColumns.has('order_num') ? 'o.order_num' : 'NULL AS order_num',
    orderColumns.has('delivery_date') ? 'o.delivery_date' : 'NULL AS delivery_date',
    orderColumns.has('priority') ? 'o.priority' : 'NULL AS priority',
    'i.id AS item_id',
    itemColumns.has('diameter') ? 'i.diameter' : 'NULL AS diameter',
    itemColumns.has('total_weight') ? 'i.total_weight' : 'NULL AS total_weight',
    itemColumns.has('material_type') ? 'i.material_type AS explicit_material_type' : 'NULL AS explicit_material_type',
    itemColumns.has('batch_id') ? 'i.batch_id' : 'NULL AS batch_id',
  ];

  const rows = db.prepare(`
    SELECT ${select.join(', ')}
    FROM items i
    ${palletJoin}
    JOIN orders o ON o.id=${orderExpression}
    WHERE 1=1 ${lifecycleFilter}
    ORDER BY o.id ASC, i.id ASC
  `).all();

  for (const sourceRow of rows) {
    const row = {
      orderId: Number(sourceRow.order_id),
      itemId: Number(sourceRow.item_id),
      orderNumber: sourceRow.order_num ?? null,
      batchId: sourceRow.batch_id ?? null,
    };
    const issues = [];
    const diameter = strictPositiveNumber(sourceRow.diameter);
    const requiredKg = strictPositiveNumber(sourceRow.total_weight);
    if (diameter === null) issues.push(sourceRow.diameter === null || sourceRow.diameter === undefined ? 'missing_diameter' : 'invalid_diameter');
    if (requiredKg === null) issues.push(sourceRow.total_weight === null || sourceRow.total_weight === undefined ? 'missing_required_kg' : 'invalid_required_kg');

    const legacyEvidence = collectLegacyMaterialEvidence(db, row, schema);
    const material = materialTypeAssessment(sourceRow.explicit_material_type, itemColumns.has('material_type'), legacyEvidence);
    if (material.issue) issues.push(material.issue);

    const needByDate = validDate(sourceRow.delivery_date);
    const needBySource = needByDate ? 'order_delivery_date' : 'unknown';
    if (!needByDate) issues.push(sourceRow.delivery_date ? 'invalid_need_by_date' : 'missing_need_by_date');

    const blockingIssues = issues.filter(issue => issue !== 'missing_need_by_date');
    const readiness = material.ambiguous
      ? 'ambiguous'
      : (blockingIssues.length ? 'incomplete' : 'ready');

    report.rows.push({
      orderId: row.orderId,
      itemId: row.itemId,
      orderNumber: row.orderNumber,
      diameterCandidate: diameter,
      requiredKgCandidate: requiredKg,
      materialTypeCandidate: material.candidate,
      materialTypeEvidence: material.evidence,
      legacyMaterialTypeEvidence: legacyEvidence,
      needByDate,
      needBySource,
      priority: sourceRow.priority ?? null,
      readiness,
      issues,
      v2AllocatedKg: requiredKg === null ? null : 0,
      v2CurrentlyUnallocatedKg: requiredKg,
      procurementShortageKg: null,
      procurementStatus: 'not_calculated_in_b1',
    });
  }

  return report;
}

module.exports = {
  buildMaterialRequirementShadowReport,
};
