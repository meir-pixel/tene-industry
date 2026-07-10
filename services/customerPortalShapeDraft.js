'use strict';

const crypto = require('crypto');
const { VALID_DIAMETERS, rebarKgPerMeter } = require('../constants');
const {
  buildFullShapeSnapshot,
  isShapeDataContractV2,
  parseJsonObject,
} = require('./shapeSnapshot');

const ALLOWED_FAMILIES = new Set(['bars']);
const SHAPE_TYPE_ALIASES = Object.freeze({
  straight: 'straight_bar',
  straight_bar: 'straight_bar',
  bar: 'straight_bar',
  l: 'l_bar',
  l_bar: 'l_bar',
  u: 'u_bar',
  u_bar: 'u_bar',
  stirrup: 'stirrup',
  stirrups: 'stirrup',
  custom: 'custom_bar',
  custom_bar: 'custom_bar',
});

function portalDraftError(message, code = 'invalid_shape_draft', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function cleanText(value, fallback = '') {
  const text = String(value ?? fallback ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\bon[a-z]+\s*=\s*\S+/gi, '')
    .replace(/script/gi, '')
    .replace(/\bjavascript\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 240);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value, fieldName) {
  const n = numberOrNull(value);
  if (n === null || n <= 0) throw portalDraftError(`${fieldName} must be positive`);
  return n;
}

function normalizeQuantity(value) {
  const n = Math.round(Number(value ?? 1));
  if (!Number.isFinite(n) || n < 1) throw portalDraftError('quantity must be positive');
  if (n > 100000) throw portalDraftError('quantity is too large');
  return n;
}

function normalizeDiameter(value) {
  const diameter = positiveNumber(value, 'diameter');
  const allowed = Array.isArray(VALID_DIAMETERS) ? VALID_DIAMETERS.map(Number) : [];
  if (allowed.length && !allowed.includes(diameter)) {
    throw portalDraftError('diameter is not supported', 'unsupported_diameter');
  }
  return diameter;
}

function normalizeAngle(value, fallback = null) {
  const n = numberOrNull(value);
  if (n === null) return fallback;
  if (n < -360 || n > 360) throw portalDraftError('angle is out of range');
  return n;
}

function normalizeSides(values, expectedCount = null) {
  if (!Array.isArray(values)) throw portalDraftError('sides are required');
  const sides = values.map((value, index) => positiveNumber(value, `side ${index + 1}`));
  if (expectedCount !== null && sides.length !== expectedCount) {
    throw portalDraftError(`expected ${expectedCount} sides`);
  }
  if (!sides.length) throw portalDraftError('at least one side is required');
  if (sides.length > 12) throw portalDraftError('too many sides');
  return sides;
}

function shapeTypeLabel(shapeType) {
  switch (shapeType) {
    case 'straight_bar': return '׳׳•׳˜ ׳™׳©׳¨';
    case 'l_bar': return 'L';
    case 'u_bar': return 'U';
    case 'stirrup': return '׳—׳™׳©׳•׳§';
    default: return '׳¦׳•׳¨׳”';
  }
}

function normalizeShapeType(value) {
  const key = String(value || 'straight_bar').trim().toLowerCase();
  const shapeType = SHAPE_TYPE_ALIASES[key];
  if (!shapeType) throw portalDraftError('shape type is not supported', 'unsupported_shape_type');
  return shapeType;
}

function draftInput(input = {}) {
  const draft = input.shapeDraft && typeof input.shapeDraft === 'object' ? input.shapeDraft : input;
  const data = draft.data && typeof draft.data === 'object' ? draft.data : {};
  return { draft, data };
}

function normalizeDraftGeometry(input = {}) {
  const { draft, data } = draftInput(input);
  const family = String(draft.family || input.family || 'bars');
  if (!ALLOWED_FAMILIES.has(family)) {
    throw portalDraftError('shape family is not supported', 'unsupported_shape_family');
  }
  const shapeType = normalizeShapeType(draft.shapeType || input.shapeType || input.shapeName || input.shape_name);

  if (shapeType === 'straight_bar') {
    const length = positiveNumber(data.A ?? data.a ?? data.length ?? data.lengthMm ?? data.sides?.[0] ?? input.length, 'length');
    return { family, shapeType, sides: [length], angles: [] };
  }

  if (shapeType === 'l_bar') {
    const sides = normalizeSides(data.sides || [data.A ?? data.a, data.B ?? data.b], 2);
    const angle = normalizeAngle(data.angle ?? data.angles?.[0], 90);
    return { family, shapeType, sides, angles: [angle] };
  }

  if (shapeType === 'u_bar') {
    const sides = normalizeSides(data.sides || [data.A ?? data.a, data.B ?? data.b, data.C ?? data.c], 3);
    const angles = [
      normalizeAngle(data.angleA ?? data.angles?.[0], 90),
      normalizeAngle(data.angleB ?? data.angles?.[1], 90),
    ];
    return { family, shapeType, sides, angles };
  }

  if (shapeType === 'stirrup') {
    const width = positiveNumber(data.width ?? data.W ?? data.w ?? data.sides?.[0], 'width');
    const height = positiveNumber(data.height ?? data.H ?? data.h ?? data.sides?.[1], 'height');
    const overlap = numberOrNull(data.overlap ?? data.overlapMm);
    const sides = overlap && overlap > 0 ? [width, height, width, height, overlap] : [width, height, width, height];
    const angles = sides.slice(0, -1).map(() => 90);
    return { family, shapeType, sides, angles };
  }

  const sides = normalizeSides(data.sides || input.sides);
  const rawAngles = Array.isArray(data.angles) ? data.angles : (Array.isArray(input.angles) ? input.angles : []);
  const angles = sides.slice(0, -1).map((_, index) => normalizeAngle(rawAngles[index], index < rawAngles.length ? null : 180));
  return { family, shapeType, sides, angles };
}

function segmentsFromSides(sides, angles) {
  return sides.map((length, index) => ({
    length_mm: length,
    angle_deg: index < sides.length - 1 ? normalizeAngle(angles[index], null) : null,
  }));
}

function buildDimsText(sides, angles) {
  const sideLabels = sides.map((length, index) => `${String.fromCharCode(65 + index)}=${Math.round(length)}`);
  const angleLabels = angles
    .filter(angle => Number.isFinite(Number(angle)) && Math.abs(Number(angle)) > 0.001 && Math.abs(Number(angle) - 180) > 0.001)
    .map(angle => `${Math.round(Number(angle) * 10) / 10}\u00b0`);
  return [...sideLabels, ...angleLabels].join(' \u00b7 ');
}

function buildShapePreview(shapeType, sides, angles) {
  const title = shapeTypeLabel(shapeType);
  const dims = buildDimsText(sides, angles);
  return `<svg viewBox="0 0 180 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title} ${dims}">
    <rect x="1" y="1" width="178" height="78" rx="8" fill="#fff" stroke="#d8e2ef"/>
    <text x="90" y="21" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#25364d">${title}</text>
    <text x="90" y="53" text-anchor="middle" font-family="Arial" font-size="10" fill="#526070">${dims}</text>
  </svg>`;
}

function validatePortalShapeDraft(input = {}, ctx = {}) {
  if (ctx && ctx.canCreateOrders === false) {
    throw portalDraftError('portal user cannot create orders', 'portal_order_create_forbidden', 403);
  }
  const { data } = draftInput(input);
  const geometry = normalizeDraftGeometry(input);
  const diameter = normalizeDiameter(input.diameter ?? data.diameter ?? data.diameterMm);
  const quantity = normalizeQuantity(input.quantity ?? input.qty);
  return { ...geometry, diameter, quantity };
}

function buildPortalShapeDraft(input = {}, ctx = {}) {
  const normalized = validatePortalShapeDraft(input, ctx);
  const elementName = cleanText(input.elementName ?? input.struct_element ?? input.shapeName, shapeTypeLabel(normalized.shapeType));
  const note = cleanText(input.note ?? input.noteForCustomer, '');
  const totalLengthMm = normalized.sides.reduce((sum, length) => sum + length, 0);
  const weightPerUnit = (totalLengthMm / 1000) * rebarKgPerMeter(normalized.diameter);
  const totalWeight = weightPerUnit * normalized.quantity;
  const bendCount = normalized.angles.filter(angle => Number.isFinite(Number(angle)) && Math.abs(Number(angle) - 180) > 0.001).length;
  const segments = segmentsFromSides(normalized.sides, normalized.angles);
  const shapeId = cleanText(input.shapeId || `portal-${normalized.shapeType}-${crypto.createHash('sha1').update(JSON.stringify({ sides: normalized.sides, angles: normalized.angles, diameter: normalized.diameter })).digest('hex').slice(0, 10)}`);
  const displayName = elementName || shapeTypeLabel(normalized.shapeType);
  const snapshot = buildFullShapeSnapshot({
    shapeVersion: 1,
    shapeId,
    shapeType: normalized.shapeType,
    family: normalized.family,
    source: 'customer-portal',
    displayName,
    data: {
      diameter: normalized.diameter,
      sides: normalized.sides,
      angles: normalized.angles,
      segments,
      shapeType: normalized.shapeType,
    },
    calculated: {
      totalLengthMm,
      weightKg: weightPerUnit,
      bendCount,
    },
    machineOutput: {
      generic: {
        family: normalized.family,
        shapeType: normalized.shapeType,
        diameter: normalized.diameter,
        totalLengthMm,
        weightKg: weightPerUnit,
        bendCount,
        segments,
      },
    },
    validation: { valid: true, warnings: [], errors: [] },
  });
  if (!isShapeDataContractV2(snapshot)) {
    throw portalDraftError('shape snapshot is invalid', 'invalid_shape_snapshot');
  }
  return {
    ...normalized,
    elementName,
    note,
    shapeId,
    shapeName: displayName,
    shapeSnapshot: snapshot,
    shapeSnapshotJson: JSON.stringify(snapshot),
    segments,
    segmentsJson: JSON.stringify(segments),
    totalLengthMm,
    weightPerUnit,
    totalWeight,
    shapeDimsText: buildDimsText(normalized.sides, normalized.angles),
    shapePreview: buildShapePreview(normalized.shapeType, normalized.sides, normalized.angles),
  };
}

function portalShapeDraftToOrderItem(input = {}, ctx = {}) {
  const draft = buildPortalShapeDraft(input, ctx);
  return {
    shapeId: draft.shapeId,
    shapeName: draft.shapeName,
    elementName: draft.elementName,
    note: draft.note,
    diameter: draft.diameter,
    quantity: draft.quantity,
    segments: draft.segmentsJson,
    sides: draft.sides,
    angles: draft.angles,
    totalLengthMm: draft.totalLengthMm,
    weightPerUnit: draft.weightPerUnit,
    totalWeight: draft.totalWeight,
    shapeSnapshot: draft.shapeSnapshot,
    shapeSnapshotJson: draft.shapeSnapshotJson,
    shapeDimsText: draft.shapeDimsText,
    shapePreview: draft.shapePreview,
    publicItem: {
      itemNum: ctx.itemIndex || null,
      elementName: draft.elementName,
      shapeName: draft.shapeName,
      shapePreview: draft.shapePreview,
      shapeDimsText: draft.shapeDimsText,
      diameter: draft.diameter,
      quantity: draft.quantity,
      lengthM: +(draft.totalLengthMm / 1000).toFixed(3),
      totalLengthM: +((draft.totalLengthMm * draft.quantity) / 1000).toFixed(3),
      weightKg: +draft.totalWeight.toFixed(3),
      noteForCustomer: draft.note,
    },
  };
}

function parsePortalShapeSnapshot(value) {
  const snapshot = parseJsonObject(value);
  return isShapeDataContractV2(snapshot) ? snapshot : null;
}

module.exports = {
  buildPortalShapeDraft,
  validatePortalShapeDraft,
  portalShapeDraftToOrderItem,
  parsePortalShapeSnapshot,
};


