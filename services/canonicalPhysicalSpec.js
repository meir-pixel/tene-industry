'use strict';

const {
  CONTRACT_VERSION: SHAPE_SNAPSHOT_CONTRACT_VERSION,
  isShapeDataContractV2,
} = require('./shapeSnapshot');
const { strictNumericInput } = require('./shapeEngines/closedStirrupEngine');

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

const CLOSED_PHYSICAL_VALIDATION_ERRORS = new Set([
  'invalid_hook_length',
  'invalid_overlap_length',
  'conflicting_hook_length_aliases',
  'conflicting_overlap_length_aliases',
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

function collectLegacyPhysicalAliases(legacyItem, keys) {
  const values = [];
  for (const container of [legacyItem, nestedData(legacyItem)]) {
    if (!isObject(container)) continue;
    for (const key of keys) {
      if (!hasOwn(container, key)) continue;
      const value = container[key];
      if (value === null || value === undefined) continue;
      values.push(value);
    }
  }
  if (!values.length) {
    return {
      field: { present: false, value: undefined },
      kind: 'missing',
      conflict: false,
    };
  }

  const normalized = [];
  for (const value of values) {
    const parsed = strictNumericInput(value);
    if (!parsed.valid) {
      return {
        field: { present: false, value: undefined },
        kind: 'invalid',
        conflict: false,
      };
    }
    const physical = numericResult(parsed.value, { allowZero: true });
    if (physical.kind !== 'ok') {
      return {
        field: { present: false, value: undefined },
        kind: physical.kind,
        conflict: false,
      };
    }
    normalized.push(physical.value);
  }

  const conflict = normalized.some(value => value !== normalized[0]);
  return {
    field: conflict
      ? { present: false, value: undefined }
      : { present: true, value: normalized[0] },
    kind: conflict ? 'invalid' : 'ok',
    conflict,
  };
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

    const explicitLengthKeys = includeTopLevel
      ? ['lengthMm', 'length_mm', 'totalLengthMm', 'total_length_mm', 'length']
      : ['lengthMm', 'length_mm', 'length'];
    for (const key of explicitLengthKeys) {
      if (!hasOwn(container, key)) continue;
      const length = numericResult(container[key]);
      if (length.kind !== 'ok') return true;
      physicalLengths.push(length.value);
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

function buildClosedStirrupSpec({
  snapshot,
  legacyItem,
  materialGrade,
  snapshotPhysicalValidationFailure = false,
}) {
  const reasons = [];
  const discrepancies = [];
  const data = nestedData(snapshot);
  const inputPresence = isObject(snapshot?.validation?.inputPresence)
    ? snapshot.validation.inputPresence
    : {};
  const inputValidity = isObject(snapshot?.validation?.inputValidity)
    ? snapshot.validation.inputValidity
    : {};
  const inputConflict = isObject(snapshot?.validation?.inputConflict)
    ? snapshot.validation.inputConflict
    : {};

  if (snapshotPhysicalValidationFailure) addReason(reasons, 'invalid_physical_value');

  const snapshotFields = {
    widthMm: firstDefinedField(data, ['width']),
    heightMm: firstDefinedField(data, ['height']),
    diameterMm: firstDefinedField(data, ['diameter', 'diameterMm']),
    hookLengthMm: firstDefinedField(data, ['hookLength']),
    overlapLengthMm: firstDefinedField(data, ['overlapLength']),
  };
  const legacyHook = collectLegacyPhysicalAliases(
    legacyItem,
    ['hookLength', 'hookLengthMm', 'hook_length', 'hook_length_mm'],
  );
  const legacyOverlap = collectLegacyPhysicalAliases(
    legacyItem,
    ['overlapLength', 'overlapLengthMm', 'overlap_length', 'overlap_length_mm'],
  );
  const legacyFields = {
    widthMm: legacyField(legacyItem, ['width', 'widthMm', 'width_mm']),
    heightMm: legacyField(legacyItem, ['height', 'heightMm', 'height_mm']),
    diameterMm: legacyField(legacyItem, ['diameter', 'diameterMm', 'diameter_mm']),
    hookLengthMm: legacyHook.field,
    overlapLengthMm: legacyOverlap.field,
  };

  for (const [field, legacyAliasResult] of [
    ['hookLength', legacyHook],
    ['overlapLength', legacyOverlap],
  ]) {
    if (legacyAliasResult.kind === 'invalid') addReason(reasons, 'invalid_physical_value');
    if (legacyAliasResult.kind === 'precision') addReason(reasons, 'unsupported_numeric_precision');
    if (legacyAliasResult.conflict) {
      discrepancies.push({
        source: 'legacy_item',
        field,
        conflictType: 'conflicting_alias_values',
      });
    }
  }

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

  function endTreatmentResult(field, provenanceKey) {
    const presenceKnown = hasOwn(inputPresence, provenanceKey);
    const validityKnown = hasOwn(inputValidity, provenanceKey);
    if (inputConflict[provenanceKey] === true) {
      return { kind: 'invalid', value: null };
    }
    if (presenceKnown && inputPresence[provenanceKey] !== true) {
      return { kind: 'missing', value: null };
    }
    if (validityKnown && inputValidity[provenanceKey] !== true) {
      return { kind: 'invalid', value: null };
    }
    if (!field.present || field.value === null || field.value === undefined || field.value === '') {
      return { kind: 'missing', value: null };
    }
    const normalized = numericResult(field.value, { allowZero: true });
    if (normalized.kind === 'ok' && normalized.value === 0) {
      if (
        !presenceKnown
        || inputPresence[provenanceKey] !== true
        || !validityKnown
        || inputValidity[provenanceKey] !== true
      ) {
        return { kind: 'missing', value: null };
      }
    }
    return normalized;
  }

  const hook = endTreatmentResult(snapshotFields.hookLengthMm, 'hookLength');
  const overlap = endTreatmentResult(snapshotFields.overlapLengthMm, 'overlapLength');
  for (const field of ['hookLength', 'overlapLength']) {
    if (inputConflict[field] === true) {
      discrepancies.push({
        source: 'snapshot_input',
        field,
        conflictType: 'conflicting_alias_values',
      });
    }
  }
  if (hook.kind === 'missing' || overlap.kind === 'missing') addReason(reasons, 'missing_end_treatment');
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

  let snapshotPhysicalValidationFailure = false;
  if (snapshot) {
    const structurallyValid = (
      isShapeDataContractV2(snapshot)
      && Number(snapshot.contractVersion) === SHAPE_SNAPSHOT_CONTRACT_VERSION
      && isObject(snapshot.data)
      && isObject(snapshot.calculated)
      && isObject(snapshot.machineOutput)
      && isObject(snapshot.validation)
    );
    if (!structurallyValid) return resultFromReasons(['invalid_shape_snapshot']);

    const errorsPresent = hasOwn(snapshot.validation, 'errors');
    const errors = errorsPresent && Array.isArray(snapshot.validation.errors)
      ? snapshot.validation.errors
      : null;
    if (errorsPresent && !errors) return resultFromReasons(['invalid_shape_snapshot']);

    if (snapshot.validation.valid === true) {
      if (errors && errors.length > 0) return resultFromReasons(['invalid_shape_snapshot']);
    } else if (snapshot.validation.valid === false) {
      snapshotPhysicalValidationFailure = (
        normalizeShapeType(snapshot.shapeType) === 'closed_stirrup'
        && Array.isArray(errors)
        && errors.length > 0
        && errors.every(error => CLOSED_PHYSICAL_VALIDATION_ERRORS.has(error))
      );
      if (!snapshotPhysicalValidationFailure) {
        return resultFromReasons(['invalid_shape_snapshot']);
      }
    } else {
      return resultFromReasons(['invalid_shape_snapshot']);
    }
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
      return buildClosedStirrupSpec({
        snapshot,
        legacyItem,
        materialGrade: input.materialGrade,
        snapshotPhysicalValidationFailure,
      });
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
