'use strict';

const {
  CONTRACT_VERSION: SHAPE_SNAPSHOT_CONTRACT_VERSION,
  isShapeDataContractV2,
} = require('./shapeSnapshot');

const CANONICAL_SPEC_VERSION = 1;

const MATCHABILITY = Object.freeze({
  EXACT_MATCHABLE: 'exact_matchable',
  REVIEW_REQUIRED: 'review_required',
  UNMATCHABLE: 'unmatchable',
});

const REASON_ORDER = Object.freeze([
  'unsupported_shape_family',
  'unsupported_shape_type',
  'unsupported_3d_geometry',
  'shape_engine_unavailable',
  'invalid_shape_snapshot',
  'invalid_straight_geometry',
  'missing_geometry',
  'missing_material_grade',
  'invalid_material_grade',
  'missing_diameter',
  'missing_length',
  'missing_end_treatment',
  'invalid_physical_value',
  'unsupported_numeric_precision',
  'snapshot_legacy_conflict',
]);

const UNMATCHABLE_REASONS = new Set([
  'unsupported_shape_family',
  'unsupported_shape_type',
  'unsupported_3d_geometry',
  'shape_engine_unavailable',
]);

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function unwrapSnapshotInput(value) {
  const parsed = parseObject(value);
  if (!parsed) return { snapshot: null, builderReason: null, supplied: value !== null && value !== undefined };
  if (isObject(parsed.snapshot)) {
    return {
      snapshot: parsed.snapshot,
      builderReason: parsed.status === 'success' ? null : parsed.reason || null,
      supplied: true,
    };
  }
  if (parsed.status && !hasOwn(parsed, 'contractVersion')) {
    return {
      snapshot: null,
      builderReason: parsed.reason || null,
      supplied: true,
    };
  }
  return { snapshot: parsed, builderReason: null, supplied: true };
}

function normalizeMaterialGrade(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized || null;
}

function numericResult(value, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') return { kind: 'missing', value: null };
  if (typeof value === 'boolean') return { kind: 'invalid', value: null };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { kind: 'invalid', value: null };
  if (numeric < 0 || (!allowZero && numeric === 0)) return { kind: 'invalid', value: null };

  const scaled = numeric * 1000;
  const roundedScaled = Math.round(scaled);
  if (Math.abs(scaled - roundedScaled) > 1e-7) {
    return { kind: 'precision', value: null };
  }

  const normalized = roundedScaled / 1000;
  return { kind: 'ok', value: Object.is(normalized, -0) ? 0 : normalized };
}

function firstDefinedField(object, keys) {
  if (!isObject(object)) return { present: false, value: undefined };
  for (const key of keys) {
    if (hasOwn(object, key)) return { present: true, value: object[key] };
  }
  return { present: false, value: undefined };
}

function nestedData(object) {
  return isObject(object?.data) ? object.data : {};
}

function legacyField(legacyItem, keys) {
  const direct = firstDefinedField(legacyItem, keys);
  if (direct.present) return direct;
  return firstDefinedField(nestedData(legacyItem), keys);
}

function normalizeShapeType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeFamily(value) {
  return String(value || '').trim().toLowerCase();
}

function legacyShapeType(legacyItem) {
  return normalizeShapeType(
    legacyItem?.shapeType
      ?? legacyItem?.shape_type
      ?? legacyItem?.topology
  );
}

function legacyFamily(legacyItem) {
  return normalizeFamily(legacyItem?.family);
}

function is3dInput(snapshot, legacyItem) {
  const data = nestedData(snapshot);
  return Boolean(
    snapshot?.is3d
      ?? snapshot?.is_3d
      ?? data.is3d
      ?? data.is_3d
      ?? legacyItem?.is3d
      ?? legacyItem?.is_3d
  );
}

function addReason(reasons, code) {
  if (code && !reasons.includes(code)) reasons.push(code);
}

function orderedReasons(reasons) {
  return [...new Set(reasons)].sort((left, right) => {
    const leftIndex = REASON_ORDER.indexOf(left);
    const rightIndex = REASON_ORDER.indexOf(right);
    return (leftIndex < 0 ? REASON_ORDER.length : leftIndex)
      - (rightIndex < 0 ? REASON_ORDER.length : rightIndex)
      || left.localeCompare(right);
  });
}

function resultFromReasons(reasons, discrepancies = []) {
  const reasonCodes = orderedReasons(reasons);
  const status = reasonCodes.some(reason => UNMATCHABLE_REASONS.has(reason))
    ? MATCHABILITY.UNMATCHABLE
    : MATCHABILITY.REVIEW_REQUIRED;
  return {
    status,
    reasonCodes,
    canonicalSpec: null,
    validation: { discrepancies },
  };
}

function exactResult(canonicalSpec, discrepancies = []) {
  return {
    status: MATCHABILITY.EXACT_MATCHABLE,
    reasonCodes: [],
    canonicalSpec,
    validation: { discrepancies },
  };
}

function addNumericReason(reasons, result, missingReason) {
  if (result.kind === 'missing') addReason(reasons, missingReason);
  if (result.kind === 'invalid') addReason(reasons, 'invalid_physical_value');
  if (result.kind === 'precision') addReason(reasons, 'unsupported_numeric_precision');
}

function addDiscrepancy(discrepancies, field, snapshotValue, legacyValue) {
  discrepancies.push({ field, snapshotValue, legacyValue });
}

function compareNormalizedValues({
  discrepancies,
  reasons,
  field,
  snapshotField,
  legacyFieldValue,
  allowZero = false,
}) {
  if (!snapshotField.present || !legacyFieldValue.present) return;
  const snapshotResult = numericResult(snapshotField.value, { allowZero });
  const legacyResult = numericResult(legacyFieldValue.value, { allowZero });
  if (snapshotResult.kind === 'invalid' || legacyResult.kind === 'invalid') {
    addReason(reasons, 'invalid_physical_value');
    return;
  }
  if (snapshotResult.kind === 'precision' || legacyResult.kind === 'precision') {
    addReason(reasons, 'unsupported_numeric_precision');
    return;
  }
  if (snapshotResult.kind === 'missing' || legacyResult.kind === 'missing') return;
  if (snapshotResult.value !== legacyResult.value) {
    addDiscrepancy(discrepancies, field, snapshotResult.value, legacyResult.value);
    addReason(reasons, 'snapshot_legacy_conflict');
  }
}

function validateMaterialGrade({ materialGrade, snapshot, legacyItem, reasons, discrepancies }) {
  if (materialGrade !== null && materialGrade !== undefined && typeof materialGrade !== 'string') {
    addReason(reasons, 'invalid_material_grade');
    return null;
  }
  const grade = normalizeMaterialGrade(materialGrade);
  if (!grade) {
    addReason(reasons, 'missing_material_grade');
    return null;
  }

  const embeddedGrades = [
    firstDefinedField(nestedData(snapshot), ['materialGrade', 'material_grade', 'grade']),
    legacyField(legacyItem, ['materialGrade', 'material_grade', 'grade']),
  ].filter(field => field.present && field.value !== null && field.value !== undefined);

  for (const embedded of embeddedGrades) {
    if (typeof embedded.value !== 'string') {
      addReason(reasons, 'invalid_material_grade');
      continue;
    }
    const embeddedGrade = normalizeMaterialGrade(embedded.value);
    if (embeddedGrade && embeddedGrade !== grade) {
      addDiscrepancy(discrepancies, 'material.grade', grade, embeddedGrade);
      addReason(reasons, 'snapshot_legacy_conflict');
    }
  }
  return grade;
}

function parseGeometryArray(value, { allowJson = false } = {}) {
  if (Array.isArray(value)) return value;
  if (!allowJson || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function meaningfulBend(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number' || typeof value === 'string') {
    const numeric = Number(value);
    return !Number.isFinite(numeric) || numeric !== 0;
  }
  if (!isObject(value)) return true;
  const field = firstDefinedField(value, [
    'angle',
    'angleDeg',
    'angle_deg',
    'bendAfterDeg',
    'bend_after_deg',
  ]);
  return field.present ? meaningfulBend(field.value) : true;
}

function segmentLengthValue(segment) {
  if (isObject(segment)) {
    const field = firstDefinedField(segment, ['lengthMm', 'length_mm', 'length']);
    return field.present ? numericResult(field.value) : { kind: 'missing', value: null };
  }
  return numericResult(segment);
}

function straightGeometryInvalid(source, { allowJson = false, includeTopLevel = false } = {}) {
  if (!source) return false;
  const containers = [nestedData(source)];
  if (isObject(source.geometry)) containers.push(source.geometry);
  if (includeTopLevel && isObject(source)) containers.push(source);
  const physicalLengths = [];

  for (const container of containers) {
    for (const key of ['sides', 'segments']) {
      if (!hasOwn(container, key)) continue;
      const entries = parseGeometryArray(container[key], { allowJson });
      if (!entries || entries.length !== 1) return true;
      const length = segmentLengthValue(entries[0]);
      if (length.kind !== 'ok') return true;
      physicalLengths.push(length.value);
      if (key === 'segments' && isObject(entries[0])) {
        const bend = firstDefinedField(entries[0], [
          'angle',
          'angleDeg',
          'angle_deg',
          'bendAfterDeg',
          'bend_after_deg',
        ]);
        if (bend.present && meaningfulBend(bend.value)) return true;
      }
    }

    for (const key of ['angles', 'bends']) {
      if (!hasOwn(container, key)) continue;
      const bends = parseGeometryArray(container[key], { allowJson });
      if (!bends || bends.some(meaningfulBend)) return true;
    }
  }

  return physicalLengths.some(length => length !== physicalLengths[0]);
}

function straightLengthField(snapshot) {
  const data = nestedData(snapshot);
  if (Array.isArray(data.sides)) {
    const angles = Array.isArray(data.angles) ? data.angles : [];
    if (data.sides.length === 1 && angles.length === 0) {
      return { present: true, value: data.sides[0] };
    }
  }
  if (Array.isArray(data.segments) && data.segments.length === 1) {
    const segment = data.segments[0];
    if (isObject(segment)) {
      return firstDefinedField(segment, ['lengthMm', 'length_mm', 'length']);
    }
    return { present: true, value: segment };
  }
  return firstDefinedField(data, ['lengthMm', 'length_mm', 'length']);
}

function legacyStraightLengthField(legacyItem) {
  const explicit = legacyField(legacyItem, [
    'lengthMm',
    'length_mm',
    'totalLengthMm',
    'total_length_mm',
    'length',
  ]);
  if (explicit.present) return explicit;

  const segments = legacyItem?.segments;
  const parsedSegments = Array.isArray(segments)
    ? segments
    : typeof segments === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(segments);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  if (parsedSegments.length !== 1) return { present: false, value: undefined };
  const segment = parsedSegments[0];
  return isObject(segment)
    ? firstDefinedField(segment, ['lengthMm', 'length_mm', 'length'])
    : { present: true, value: segment };
}

function buildStraightSpec({ snapshot, legacyItem, materialGrade }) {
  const reasons = [];
  const discrepancies = [];
  if (
    straightGeometryInvalid(snapshot)
    || straightGeometryInvalid(legacyItem, { allowJson: true, includeTopLevel: true })
  ) {
    addReason(reasons, 'invalid_straight_geometry');
  }
  const data = nestedData(snapshot);
  const snapshotDiameter = firstDefinedField(data, ['diameter', 'diameterMm']);
  const legacyDiameter = legacyField(legacyItem, ['diameter', 'diameterMm', 'diameter_mm']);
  const snapshotLength = straightLengthField(snapshot);
  const legacyLength = legacyStraightLengthField(legacyItem);

  compareNormalizedValues({
    discrepancies,
    reasons,
    field: 'diameterMm',
    snapshotField: snapshotDiameter,
    legacyFieldValue: legacyDiameter,
  });
  compareNormalizedValues({
    discrepancies,
    reasons,
    field: 'geometry.lengthMm',
    snapshotField: snapshotLength,
    legacyFieldValue: legacyLength,
  });

  const diameterSource = snapshotDiameter.present ? snapshotDiameter : legacyDiameter;
  const lengthSource = snapshotLength.present ? snapshotLength : legacyLength;
  const diameter = numericResult(diameterSource.value);
  const length = numericResult(lengthSource.value);
  addNumericReason(reasons, diameter, 'missing_diameter');
  addNumericReason(reasons, length, 'missing_length');

  const grade = validateMaterialGrade({
    materialGrade,
    snapshot,
    legacyItem,
    reasons,
    discrepancies,
  });

  if (reasons.length) return resultFromReasons(reasons, discrepancies);
  return exactResult({
    canonicalSpecVersion: CANONICAL_SPEC_VERSION,
    family: 'bars',
    topology: 'straight',
    material: { grade },
    diameterMm: diameter.value,
    geometry: { lengthMm: length.value },
  }, discrepancies);
}

function buildClosedStirrupSpec({ snapshot, legacyItem, materialGrade }) {
  const reasons = [];
  const discrepancies = [];
  const data = nestedData(snapshot);
  const inputPresence = isObject(snapshot?.validation?.inputPresence)
    ? snapshot.validation.inputPresence
    : {};

  const snapshotFields = {
    widthMm: firstDefinedField(data, ['width']),
    heightMm: firstDefinedField(data, ['height']),
    diameterMm: firstDefinedField(data, ['diameter', 'diameterMm']),
    hookLengthMm: firstDefinedField(data, ['hookLength']),
    overlapLengthMm: firstDefinedField(data, ['overlapLength']),
  };
  const legacyFields = {
    widthMm: legacyField(legacyItem, ['width', 'widthMm', 'width_mm']),
    heightMm: legacyField(legacyItem, ['height', 'heightMm', 'height_mm']),
    diameterMm: legacyField(legacyItem, ['diameter', 'diameterMm', 'diameter_mm']),
    hookLengthMm: legacyField(legacyItem, ['hookLength', 'hookLengthMm', 'hook_length', 'hook_length_mm']),
    overlapLengthMm: legacyField(legacyItem, ['overlapLength', 'overlapLengthMm', 'overlap_length', 'overlap_length_mm']),
  };

  for (const [field, allowZero] of [
    ['widthMm', false],
    ['heightMm', false],
    ['diameterMm', false],
    ['hookLengthMm', true],
    ['overlapLengthMm', true],
  ]) {
    compareNormalizedValues({
      discrepancies,
      reasons,
      field: field.startsWith('width') || field.startsWith('height') || field.includes('Length')
        ? `geometry.${field}`
        : field,
      snapshotField: snapshotFields[field],
      legacyFieldValue: legacyFields[field],
      allowZero,
    });
  }

  const width = numericResult(snapshotFields.widthMm.value);
  const height = numericResult(snapshotFields.heightMm.value);
  const diameter = numericResult(snapshotFields.diameterMm.value);
  addNumericReason(reasons, width, 'missing_geometry');
  addNumericReason(reasons, height, 'missing_geometry');
  addNumericReason(reasons, diameter, 'missing_diameter');

  function endTreatmentIsUsable(field, presenceKey) {
    if (!field.present || field.value === null || field.value === undefined || field.value === '') return false;
    const normalized = numericResult(field.value, { allowZero: true });
    if (normalized.kind === 'ok' && normalized.value === 0) {
      return inputPresence[presenceKey] === true;
    }
    return true;
  }

  const hookIsExplicit = endTreatmentIsUsable(snapshotFields.hookLengthMm, 'hookLength');
  const overlapIsExplicit = endTreatmentIsUsable(snapshotFields.overlapLengthMm, 'overlapLength');

  if (!hookIsExplicit || !overlapIsExplicit) addReason(reasons, 'missing_end_treatment');

  const hook = hookIsExplicit
    ? numericResult(snapshotFields.hookLengthMm.value, { allowZero: true })
    : { kind: 'missing', value: null };
  const overlap = overlapIsExplicit
    ? numericResult(snapshotFields.overlapLengthMm.value, { allowZero: true })
    : { kind: 'missing', value: null };
  if (hook.kind === 'invalid' || overlap.kind === 'invalid') addReason(reasons, 'invalid_physical_value');
  if (hook.kind === 'precision' || overlap.kind === 'precision') addReason(reasons, 'unsupported_numeric_precision');

  const grade = validateMaterialGrade({
    materialGrade,
    snapshot,
    legacyItem,
    reasons,
    discrepancies,
  });

  if (reasons.length) return resultFromReasons(reasons, discrepancies);
  return exactResult({
    canonicalSpecVersion: CANONICAL_SPEC_VERSION,
    family: 'bars',
    topology: 'closed_stirrup',
    material: { grade },
    diameterMm: diameter.value,
    geometry: {
      widthMm: width.value,
      heightMm: height.value,
      hookLengthMm: hook.value,
      overlapLengthMm: overlap.value,
    },
  }, discrepancies);
}

function unsupportedSnapshotResult(snapshot, builderReason) {
  if (builderReason === 'shape_engine_not_available') {
    return resultFromReasons(['shape_engine_unavailable']);
  }
  if (builderReason) {
    return resultFromReasons(['unsupported_shape_type']);
  }
  if (!snapshot) return null;
  if (normalizeFamily(snapshot.family) !== 'bars') {
    return resultFromReasons(['unsupported_shape_family']);
  }
  if (is3dInput(snapshot, null)) {
    return resultFromReasons(['unsupported_3d_geometry']);
  }
  return resultFromReasons(['unsupported_shape_type']);
}

function buildCanonicalPhysicalSpec(input = {}) {
  const snapshotInput = unwrapSnapshotInput(input.shapeSnapshot);
  const snapshot = snapshotInput.snapshot;
  const legacyItem = parseObject(input.legacyItem);
  const snapshotType = normalizeShapeType(snapshot?.shapeType);
  const snapshotFamily = normalizeFamily(snapshot?.family);
  const legacyType = legacyShapeType(legacyItem);
  const legacyItemFamily = legacyFamily(legacyItem);

  if (snapshotInput.builderReason) {
    return unsupportedSnapshotResult(snapshot, snapshotInput.builderReason);
  }

  if (snapshotInput.supplied && !snapshot) {
    return resultFromReasons(['invalid_shape_snapshot']);
  }

  if (
    snapshot
    && (
      !isShapeDataContractV2(snapshot)
      || Number(snapshot.contractVersion) !== SHAPE_SNAPSHOT_CONTRACT_VERSION
      || !isObject(snapshot.data)
      || !isObject(snapshot.calculated)
      || !isObject(snapshot.machineOutput)
      || !isObject(snapshot.validation)
      || snapshot.validation.valid === false
    )
  ) {
    return resultFromReasons(['invalid_shape_snapshot']);
  }

  if (is3dInput(snapshot, legacyItem)) {
    return resultFromReasons(['unsupported_3d_geometry']);
  }

  if (snapshot) {
    if (snapshotFamily !== 'bars') return resultFromReasons(['unsupported_shape_family']);

    if (legacyItemFamily && legacyItemFamily !== 'bars') {
      return resultFromReasons(['snapshot_legacy_conflict'], [{
        field: 'family',
        snapshotValue: snapshotFamily,
        legacyValue: legacyItemFamily,
      }]);
    }

    if (snapshotType === 'straight_bar') {
      if (legacyType && legacyType !== 'straight_bar') {
        return resultFromReasons(['snapshot_legacy_conflict'], [{
          field: 'topology',
          snapshotValue: 'straight',
          legacyValue: legacyType,
        }]);
      }
      return buildStraightSpec({ snapshot, legacyItem, materialGrade: input.materialGrade });
    }

    if (snapshotType === 'closed_stirrup') {
      if (legacyType && !['closed_stirrup', 'stirrup'].includes(legacyType)) {
        return resultFromReasons(['snapshot_legacy_conflict'], [{
          field: 'topology',
          snapshotValue: 'closed_stirrup',
          legacyValue: legacyType,
        }]);
      }
      return buildClosedStirrupSpec({ snapshot, legacyItem, materialGrade: input.materialGrade });
    }

    return unsupportedSnapshotResult(snapshot, null);
  }

  if (legacyItem) {
    if (legacyItemFamily && legacyItemFamily !== 'bars') {
      return resultFromReasons(['unsupported_shape_family']);
    }
    if (legacyType === 'straight_bar') {
      return buildStraightSpec({ snapshot: null, legacyItem, materialGrade: input.materialGrade });
    }
    if (['closed_stirrup', 'stirrup'].includes(legacyType)) {
      return resultFromReasons(['shape_engine_unavailable']);
    }
    if (legacyType) return resultFromReasons(['unsupported_shape_type']);
  }

  if (snapshotInput.supplied) return resultFromReasons(['missing_geometry']);
  return resultFromReasons(['missing_geometry']);
}

module.exports = {
  CANONICAL_SPEC_VERSION,
  MATCHABILITY,
  buildCanonicalPhysicalSpec,
};
