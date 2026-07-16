'use strict';

let canonicalRebarKgPerMeter = null;
try {
  ({ rebarKgPerMeter: canonicalRebarKgPerMeter } = require('../../constants'));
} catch {
  canonicalRebarKgPerMeter = null;
}

const FAMILY = 'bars';
const SHAPE_TYPE = 'closed_stirrup';
const INTERNAL_SHAPE_CODE = 'closed_stirrup_rect_hook';
const CONTRACT_VERSION = 'SHAPE_DATA_CONTRACT_V2';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = numberOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  const number = numberOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

function strictNumericInput(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { valid: true, value }
      : { valid: false, value: null };
  }
  if (typeof value !== 'string') return { valid: false, value: null };
  const normalized = value.trim();
  if (!normalized) return { valid: false, value: null };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return { valid: false, value: null };
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric)
    ? { valid: true, value: numeric }
    : { valid: false, value: null };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function kgPerMeter(diameter) {
  if (typeof canonicalRebarKgPerMeter === 'function') return canonicalRebarKgPerMeter(diameter);
  return (Number(diameter) ** 2) / 162;
}

function cloneSource(source) {
  return source && typeof source === 'object' ? { ...source } : {};
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function classifyEndTreatmentInput(input, key) {
  const data = input?.data && typeof input.data === 'object' ? input.data : null;
  const values = [];
  if (hasOwn(data, key) && data[key] !== null && data[key] !== undefined) {
    values.push(data[key]);
  }
  if (hasOwn(input, key) && input[key] !== null && input[key] !== undefined) {
    values.push(input[key]);
  }
  const parsed = values.map(strictNumericInput);
  const allValid = parsed.length > 0 && parsed.every(candidate => candidate.valid);
  const conflict = allValid
    && parsed.some(candidate => candidate.value !== parsed[0].value);
  return {
    present: values.length > 0,
    valid: allValid && !conflict,
    conflict,
    value: allValid && !conflict ? parsed[0].value : null,
  };
}

function inputData(input = {}) {
  const data = input.data && typeof input.data === 'object' ? input.data : {};
  return {
    width: data.width ?? input.width,
    height: data.height ?? input.height,
    hookLength: data.hookLength ?? input.hookLength,
    overlapLength: data.overlapLength ?? input.overlapLength,
    diameter: data.diameter ?? input.diameter,
  };
}

function normalizeClosedStirrupInput(input = {}) {
  const data = inputData(input);
  const hookInput = classifyEndTreatmentInput(input, 'hookLength');
  const overlapInput = classifyEndTreatmentInput(input, 'overlapLength');
  const rawHookLength = hookInput.valid ? hookInput.value : null;
  const rawOverlapLength = overlapInput.valid ? overlapInput.value : null;
  const hasHookLength = rawHookLength !== null;
  const hasOverlapLength = rawOverlapLength !== null;
  const overlapLength = hasOverlapLength ? rawOverlapLength : null;
  const hookLength = hasHookLength ? rawHookLength : 0;

  return {
    family: FAMILY,
    shapeType: SHAPE_TYPE,
    internalShapeCode: INTERNAL_SHAPE_CODE,
    source: cloneSource(input.source),
    data: {
      width: numberOrNull(data.width),
      height: numberOrNull(data.height),
      hookLength,
      overlapLength,
      diameter: numberOrNull(data.diameter),
    },
    meta: {
      hasHookLength,
      hasOverlapLength,
      inputPresence: {
        hookLength: hookInput.present,
        overlapLength: overlapInput.present,
      },
      inputValidity: {
        hookLength: hookInput.valid,
        overlapLength: overlapInput.valid,
      },
      inputConflict: {
        hookLength: hookInput.conflict,
        overlapLength: overlapInput.conflict,
      },
    },
  };
}

function validateClosedStirrupInput(input = {}) {
  const normalized = normalizeClosedStirrupInput(input);
  const { data, meta, source } = normalized;
  const errors = [];
  const warnings = [];

  if (numberOrNull(inputData(input).width) === null) errors.push('missing_width');
  else if (positiveNumber(data.width) === null) errors.push('invalid_width');

  if (numberOrNull(inputData(input).height) === null) errors.push('missing_height');
  else if (positiveNumber(data.height) === null) errors.push('invalid_height');

  if (numberOrNull(inputData(input).diameter) === null) errors.push('missing_diameter');
  else if (positiveNumber(data.diameter) === null) errors.push('invalid_diameter');

  if (
    meta.inputValidity.hookLength
    && nonNegativeNumber(data.hookLength) === null
  ) {
    errors.push('invalid_hook_length');
  }
  if (
    meta.inputValidity.overlapLength
    && nonNegativeNumber(data.overlapLength) === null
  ) {
    errors.push('invalid_overlap_length');
  }
  if (meta.inputConflict.hookLength) errors.push('conflicting_hook_length_aliases');
  if (meta.inputConflict.overlapLength) errors.push('conflicting_overlap_length_aliases');

  if (!meta.hasHookLength && !meta.hasOverlapLength) warnings.push('hook_length_defaulted');
  if (meta.hasHookLength && meta.hasOverlapLength) warnings.push('both_hook_and_overlap_provided');
  if (source.externalShapeCode || source.externalCode) warnings.push('source_external_code_ignored_by_engine');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    inputPresence: {
      hookLength: meta.inputPresence.hookLength,
      overlapLength: meta.inputPresence.overlapLength,
    },
    inputValidity: {
      hookLength: meta.inputValidity.hookLength,
      overlapLength: meta.inputValidity.overlapLength,
    },
    inputConflict: {
      hookLength: meta.inputConflict.hookLength,
      overlapLength: meta.inputConflict.overlapLength,
    },
  };
}

function segment(role, lengthMm, bendAfterDeg) {
  const cleanBend = bendAfterDeg === null || bendAfterDeg === undefined ? null : Number(bendAfterDeg);
  return {
    role,
    length_mm: Number(lengthMm),
    lengthMm: Number(lengthMm),
    angle_deg: cleanBend,
    bendAfterDeg: cleanBend,
  };
}

function buildSegments(data) {
  const width = Number(data.width) || 0;
  const height = Number(data.height) || 0;
  const overlapLength = data.overlapLength !== null ? Number(data.overlapLength) : null;
  const hookLength = Number(data.hookLength) || 0;

  if (overlapLength !== null && overlapLength > 0) {
    return [
      segment('overlap', overlapLength, 90),
      segment('side_height_1', height, 90),
      segment('side_width_1', width, 90),
      segment('side_height_2', height, 90),
      segment('side_width_2', width, null),
    ];
  }

  if (hookLength > 0) {
    return [
      segment('hook_start', hookLength, 90),
      segment('side_height_1', height, 90),
      segment('side_width_1', width, 90),
      segment('side_height_2', height, 90),
      segment('side_width_2', width, 90),
      segment('hook_end', hookLength, null),
    ];
  }

  return [
    segment('side_width_1', width, 90),
    segment('side_height_1', height, 90),
    segment('side_width_2', width, 90),
    segment('side_height_2', height, null),
  ];
}

function buildBends() {
  return Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    angleDeg: 90,
    angle_deg: 90,
    bendAfterDeg: 90,
  }));
}

function calculateClosedStirrupLength(input = {}) {
  const normalized = normalizeClosedStirrupInput(input);
  const { data } = normalized;
  const width = Number(data.width) || 0;
  const height = Number(data.height) || 0;
  const overlapLength = data.overlapLength !== null ? Number(data.overlapLength) : null;
  const hookLength = Number(data.hookLength) || 0;
  return overlapLength !== null
    ? (2 * width) + (2 * height) + overlapLength
    : (2 * width) + (2 * height) + (2 * hookLength);
}

function calculateClosedStirrupGeometry(input = {}) {
  const normalized = normalizeClosedStirrupInput(input);
  const segments = buildSegments(normalized.data);
  const bends = buildBends();
  return {
    closed: true,
    family: FAMILY,
    shapeType: SHAPE_TYPE,
    internalShapeCode: INTERNAL_SHAPE_CODE,
    width: normalized.data.width,
    height: normalized.data.height,
    hookLength: normalized.data.hookLength,
    overlapLength: normalized.data.overlapLength,
    segments,
    bends,
  };
}

function buildPreviewData(data) {
  const labels = [
    { key: 'width', value: data.width, unit: 'mm' },
    { key: 'height', value: data.height, unit: 'mm' },
  ];
  if (data.overlapLength !== null) labels.push({ key: 'overlapLength', value: data.overlapLength, unit: 'mm' });
  else labels.push({ key: 'hookLength', value: data.hookLength, unit: 'mm' });
  return {
    type: SHAPE_TYPE,
    width: data.width,
    height: data.height,
    hookLength: data.hookLength,
    overlapLength: data.overlapLength,
    labels,
  };
}

function buildClosedStirrupMachineOutput(inputOrGeometry = {}) {
  const geometry = Array.isArray(inputOrGeometry.segments)
    ? inputOrGeometry
    : calculateClosedStirrupGeometry(inputOrGeometry);
  return {
    generic: {
      family: FAMILY,
      shapeType: SHAPE_TYPE,
      internalShapeCode: INTERNAL_SHAPE_CODE,
      closed: true,
      segments: geometry.segments,
      bends: geometry.bends,
    },
    machineProfiles: {},
  };
}

function buildClosedStirrupShape(input = {}) {
  const normalized = normalizeClosedStirrupInput(input);
  const validation = validateClosedStirrupInput(input);
  const geometry = calculateClosedStirrupGeometry(input);
  const totalLengthMm = calculateClosedStirrupLength(input);
  const weightKg = validation.valid
    ? round((totalLengthMm / 1000) * kgPerMeter(normalized.data.diameter), 3)
    : 0;

  return {
    contractVersion: CONTRACT_VERSION,
    family: FAMILY,
    shapeType: SHAPE_TYPE,
    internalShapeCode: INTERNAL_SHAPE_CODE,
    source: normalized.source,
    data: {
      width: normalized.data.width,
      height: normalized.data.height,
      hookLength: normalized.data.hookLength,
      overlapLength: normalized.data.overlapLength,
      diameter: normalized.data.diameter,
    },
    geometry,
    calculated: {
      totalLengthMm,
      bendCount: 4,
      weightKg,
    },
    validation,
    previewData: buildPreviewData(normalized.data),
    machineOutput: buildClosedStirrupMachineOutput(geometry),
  };
}

module.exports = {
  buildClosedStirrupShape,
  validateClosedStirrupInput,
  calculateClosedStirrupGeometry,
  calculateClosedStirrupLength,
  buildClosedStirrupMachineOutput,
  strictNumericInput,
};
