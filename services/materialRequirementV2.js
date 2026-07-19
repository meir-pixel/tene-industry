'use strict';

const MATERIAL_REQUIREMENT_STATUS = Object.freeze({
  OPEN: 'open',
  CANCELLED: 'cancelled',
  SUPERSEDED: 'superseded',
});

const MATERIAL_REQUIREMENT_SOURCE = Object.freeze({
  ORDER_ITEM: 'order_item',
  MANUAL: 'manual',
  IMPORT: 'import',
});

const MATERIAL_REQUIREMENT_NEED_BY_SOURCE = Object.freeze({
  MANUAL_OVERRIDE: 'manual_override',
  PLANNED_PRODUCTION: 'planned_production',
  ORDER_DELIVERY_DATE: 'order_delivery_date',
  UNKNOWN: 'unknown',
});

const ALLOWED_MATERIAL_TYPES = new Set(['coil', 'straight']);
const ALLOWED_STATUSES = new Set(Object.values(MATERIAL_REQUIREMENT_STATUS));
const ALLOWED_SOURCES = new Set(Object.values(MATERIAL_REQUIREMENT_SOURCE));
const ALLOWED_NEED_BY_SOURCES = new Set(Object.values(MATERIAL_REQUIREMENT_NEED_BY_SOURCE));
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

class MaterialRequirementValidationError extends Error {
  constructor(code, message, details = null) {
    super(message || code);
    this.name = 'MaterialRequirementValidationError';
    this.code = code;
    this.statusCode = 400;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MaterialRequirementValidationError(code, message, details);
}

function normalizePositiveNumber(value, field) {
  let normalized;
  if (typeof value === 'number') {
    normalized = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !DECIMAL_TEXT.test(trimmed)) fail(`invalid_${field}`);
    normalized = Number(trimmed);
  } else {
    fail(`invalid_${field}`);
  }
  if (!Number.isFinite(normalized) || normalized <= 0) fail(`invalid_${field}`);
  return normalized;
}

function normalizePositiveInteger(value, field) {
  const normalized = normalizePositiveNumber(value, field);
  if (!Number.isSafeInteger(normalized)) fail(`invalid_${field}`);
  return normalized;
}

function normalizeRequiredString(value, field) {
  if (typeof value !== 'string') fail(`invalid_${field}`);
  const normalized = value.trim();
  if (!normalized) fail(`invalid_${field}`);
  return normalized;
}

function normalizeOptionalString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`invalid_${field}`);
  const normalized = value.trim();
  return normalized || null;
}

function normalizeEnum(value, field, allowed) {
  const normalized = normalizeRequiredString(value, field).toLowerCase();
  if (!allowed.has(normalized)) fail(`invalid_${field}`);
  return normalized;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail('invalid_need_by_date');
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) fail('invalid_need_by_date');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) fail('invalid_need_by_date');
  return normalized;
}

function normalizeMaterialRequirementInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input)) {
    fail('invalid_requirement_input');
  }

  const needByDate = normalizeDate(input.need_by_date ?? input.needByDate);
  const needBySource = normalizeEnum(
    input.need_by_source ?? input.needBySource,
    'need_by_source',
    ALLOWED_NEED_BY_SOURCES
  );
  if (needByDate === null && needBySource !== MATERIAL_REQUIREMENT_NEED_BY_SOURCE.UNKNOWN) {
    fail('need_by_source_without_date');
  }
  if (needByDate !== null && needBySource === MATERIAL_REQUIREMENT_NEED_BY_SOURCE.UNKNOWN) {
    fail('need_by_date_without_provenance');
  }

  return {
    requirement_uid: normalizeRequiredString(input.requirement_uid ?? input.requirementUid, 'requirement_uid'),
    order_id: normalizePositiveInteger(input.order_id ?? input.orderId, 'order_id'),
    item_id: normalizePositiveInteger(input.item_id ?? input.itemId, 'item_id'),
    lifecycle_version: input.lifecycle_version === undefined && input.lifecycleVersion === undefined
      ? 2
      : normalizePositiveInteger(input.lifecycle_version ?? input.lifecycleVersion, 'lifecycle_version'),
    diameter: normalizePositiveNumber(input.diameter, 'diameter'),
    material_type: normalizeEnum(input.material_type ?? input.materialType, 'material_type', ALLOWED_MATERIAL_TYPES),
    required_kg: normalizePositiveNumber(input.required_kg ?? input.requiredKg, 'required_kg'),
    need_by_date: needByDate,
    need_by_source: needBySource,
    priority_snapshot: normalizeOptionalString(input.priority_snapshot ?? input.prioritySnapshot, 'priority_snapshot'),
    status: input.status === undefined
      ? MATERIAL_REQUIREMENT_STATUS.OPEN
      : normalizeEnum(input.status, 'status', ALLOWED_STATUSES),
    source: normalizeEnum(input.source, 'source', ALLOWED_SOURCES),
    source_revision: normalizeOptionalString(input.source_revision ?? input.sourceRevision, 'source_revision'),
  };
}

function comparableRequirement(row) {
  return {
    requirement_uid: row.requirement_uid,
    order_id: Number(row.order_id),
    item_id: Number(row.item_id),
    lifecycle_version: Number(row.lifecycle_version),
    diameter: Number(row.diameter),
    material_type: row.material_type,
    required_kg: Number(row.required_kg),
    need_by_date: row.need_by_date ?? null,
    need_by_source: row.need_by_source,
    priority_snapshot: row.priority_snapshot ?? null,
    status: row.status,
    source: row.source,
    source_revision: row.source_revision ?? null,
  };
}

function sameRequirement(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

function databasePositiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function resolveItemOrderOwnership({ directOrderId, palletId, palletOrderId } = {}) {
  const direct = databasePositiveInteger(directOrderId);
  const pallet = databasePositiveInteger(palletOrderId);
  const normalizedPalletId = databasePositiveInteger(palletId);

  if (direct !== null && pallet !== null) {
    if (direct !== pallet) {
      return {
        status: 'conflict',
        orderId: null,
        directOrderId: direct,
        palletId: normalizedPalletId,
        palletOrderId: pallet,
      };
    }
    return {
      status: 'consistent',
      orderId: direct,
      directOrderId: direct,
      palletId: normalizedPalletId,
      palletOrderId: pallet,
    };
  }
  if (direct !== null) {
    return {
      status: 'direct',
      orderId: direct,
      directOrderId: direct,
      palletId: normalizedPalletId,
      palletOrderId: null,
    };
  }
  if (pallet !== null) {
    return {
      status: 'pallet',
      orderId: pallet,
      directOrderId: null,
      palletId: normalizedPalletId,
      palletOrderId: pallet,
    };
  }
  return {
    status: 'missing',
    orderId: null,
    directOrderId: null,
    palletId: normalizedPalletId,
    palletOrderId: null,
  };
}

function ownershipConflictDetails(itemId, requestedOrderId, ownership) {
  return {
    itemId,
    requestedOrderId,
    directOrderId: ownership.directOrderId,
    palletId: ownership.palletId,
    palletOrderId: ownership.palletOrderId,
  };
}

function createMaterialRequirementV2(db, input) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('invalid_database');
  }
  const normalized = normalizeMaterialRequirementInput(input);
  if (normalized.lifecycle_version !== 2) fail('invalid_lifecycle_version');

  const create = db.transaction(payload => {
    const order = db.prepare('SELECT id, inventory_lifecycle_version FROM orders WHERE id=?')
      .get(payload.order_id);
    if (!order) fail('order_not_found');
    if (databasePositiveInteger(order.inventory_lifecycle_version) !== 2) fail('order_not_lifecycle_v2');

    const item = db.prepare(`
      SELECT i.id,
             i.order_id AS direct_order_id,
             i.pallet_id,
             p.order_id AS pallet_order_id
      FROM items i
      LEFT JOIN pallets p ON p.id=i.pallet_id
      WHERE i.id=?
    `).get(payload.item_id);
    if (!item) fail('item_not_found');
    const ownership = resolveItemOrderOwnership({
      directOrderId: item.direct_order_id,
      palletId: item.pallet_id,
      palletOrderId: item.pallet_order_id,
    });
    if (ownership.status === 'conflict') {
      fail('item_order_ownership_conflict', 'item order ownership conflict', ownershipConflictDetails(item.id, payload.order_id, ownership));
    }
    if (ownership.orderId !== payload.order_id) fail('item_order_mismatch');

    const replay = db.prepare('SELECT * FROM material_requirements_v2 WHERE requirement_uid=?')
      .get(payload.requirement_uid);
    if (replay) {
      if (sameRequirement(comparableRequirement(replay), payload)) return replay;
      fail('requirement_uid_conflict');
    }

    const current = db.prepare(`
      SELECT id FROM material_requirements_v2
      WHERE order_id=? AND item_id=? AND status='open'
    `).get(payload.order_id, payload.item_id);
    if (current && payload.status === MATERIAL_REQUIREMENT_STATUS.OPEN) {
      fail('current_requirement_exists');
    }

    let result;
    try {
      result = db.prepare(`
        INSERT INTO material_requirements_v2
          (requirement_uid, order_id, item_id, lifecycle_version, diameter, material_type,
           required_kg, need_by_date, need_by_source, priority_snapshot, status, source, source_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        payload.requirement_uid,
        payload.order_id,
        payload.item_id,
        payload.lifecycle_version,
        payload.diameter,
        payload.material_type,
        payload.required_kg,
        payload.need_by_date,
        payload.need_by_source,
        payload.priority_snapshot,
        payload.status,
        payload.source,
        payload.source_revision
      );
    } catch (error) {
      if (/idx_material_requirements_v2_current_item|UNIQUE constraint failed: material_requirements_v2\.order_id/i.test(String(error.message))) {
        fail('current_requirement_exists');
      }
      if (/material_requirements_v2\.requirement_uid/i.test(String(error.message))) {
        fail('requirement_uid_conflict');
      }
      throw error;
    }
    return db.prepare('SELECT * FROM material_requirements_v2 WHERE id=?').get(result.lastInsertRowid);
  });

  return create.immediate(normalized);
}

function getMaterialRequirementV2ByItem(db, { order_id, orderId, item_id, itemId } = {}) {
  const normalizedOrderId = normalizePositiveInteger(order_id ?? orderId, 'order_id');
  const normalizedItemId = normalizePositiveInteger(item_id ?? itemId, 'item_id');
  return db.prepare(`
    SELECT * FROM material_requirements_v2
    WHERE order_id=? AND item_id=? AND status='open'
    ORDER BY id ASC
    LIMIT 1
  `).get(normalizedOrderId, normalizedItemId) || null;
}

function listMaterialRequirementsV2ForOrder(db, orderId) {
  const normalizedOrderId = normalizePositiveInteger(orderId, 'order_id');
  return db.prepare(`
    SELECT * FROM material_requirements_v2
    WHERE order_id=?
    ORDER BY item_id ASC, id ASC
  `).all(normalizedOrderId);
}

module.exports = {
  MATERIAL_REQUIREMENT_STATUS,
  MATERIAL_REQUIREMENT_SOURCE,
  MATERIAL_REQUIREMENT_NEED_BY_SOURCE,
  MaterialRequirementValidationError,
  resolveItemOrderOwnership,
  normalizeMaterialRequirementInput,
  createMaterialRequirementV2,
  getMaterialRequirementV2ByItem,
  listMaterialRequirementsV2ForOrder,
};
