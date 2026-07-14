'use strict';

const { getShapeTemplateByInternalCode } = require('./shapeTemplateRegistry');

const SOURCE_SYSTEM_ALIASES = Object.freeze({
  tassa: 'TASSA',
  tassa2: 'TASSA',
  smart2000: 'Smart2000',
  smart: 'Smart2000',
  easybar: 'Easybar',
});

const EXTERNAL_SHAPE_MAPPINGS = Object.freeze([
  Object.freeze({
    sourceSystem: 'TASSA',
    externalCode: '100',
    shapeType: 'straight_bar',
    internalShapeCode: 'straight_bar',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'length' }),
  }),
  Object.freeze({
    sourceSystem: 'TASSA',
    externalCode: '103',
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'width', B: 'height', C: 'hookLength' }),
  }),
  Object.freeze({
    sourceSystem: 'TASSA',
    externalCode: '225',
    shapeType: 'rounded_end_bar',
    internalShapeCode: 'rounded_end_bar',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'width', B: 'legLength', C: 'returnLength', R: 'radius' }),
  }),
  Object.freeze({
    sourceSystem: 'Smart2000',
    externalCode: '100',
    shapeType: 'straight_bar',
    internalShapeCode: 'straight_bar',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'length' }),
  }),
  Object.freeze({
    sourceSystem: 'Smart2000',
    externalCode: '103',
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'width', B: 'height', C: 'hookLength' }),
  }),
  Object.freeze({
    sourceSystem: 'Smart2000',
    externalCode: '225',
    shapeType: 'rounded_end_bar',
    internalShapeCode: 'rounded_end_bar',
    confidence: 'high',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'width', B: 'legLength', C: 'returnLength', R: 'radius' }),
  }),
  Object.freeze({
    sourceSystem: 'Easybar',
    externalCode: 'X17',
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
    confidence: 'medium',
    status: 'mapped',
    version: 1,
    parameterMapping: Object.freeze({ A: 'width', B: 'height', C: 'hookLength' }),
  }),
]);

const ALIASES = Object.freeze([
  Object.freeze({ label: 'חישוק', shapeType: 'closed_stirrup', internalShapeCode: 'closed_stirrup_rect_hook', confidence: 'medium' }),
  Object.freeze({ label: 'סטיראפ', shapeType: 'closed_stirrup', internalShapeCode: 'closed_stirrup_rect_hook', confidence: 'medium' }),
  Object.freeze({ label: 'מוט ישר', shapeType: 'straight_bar', internalShapeCode: 'straight_bar', confidence: 'medium' }),
  Object.freeze({ label: 'קצה מעוגל', shapeType: 'rounded_end_bar', internalShapeCode: 'rounded_end_bar', confidence: 'medium' }),
]);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparable(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSourceSystem(value) {
  const raw = normalizeText(value);
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SOURCE_SYSTEM_ALIASES[key] || raw;
}

function normalizeExternalCode(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const numeric = text.match(/\b\d{2,4}\b/);
  if (numeric) return numeric[0];
  return text.toUpperCase();
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function withTemplate(mapping) {
  if (!mapping || mapping.status !== 'mapped') return mapping;
  return { ...mapping, template: getShapeTemplateByInternalCode(mapping.internalShapeCode) };
}

function unmappedResult({ sourceSystem, externalCode, label }) {
  return {
    sourceSystem: normalizeSourceSystem(sourceSystem),
    externalCode: normalizeExternalCode(externalCode),
    label: normalizeText(label),
    shapeType: 'unknown',
    internalShapeCode: null,
    confidence: 'none',
    status: 'unmapped',
    requiresUserReview: true,
  };
}

function listExternalShapeMappings() {
  return EXTERNAL_SHAPE_MAPPINGS.map(clone);
}

function getMappingsBySourceSystem(sourceSystem) {
  const source = normalizeSourceSystem(sourceSystem);
  return EXTERNAL_SHAPE_MAPPINGS.filter(mapping => mapping.sourceSystem === source).map(clone);
}

function getMappingsByInternalShapeCode(internalShapeCode) {
  const code = normalizeText(internalShapeCode);
  return EXTERNAL_SHAPE_MAPPINGS.filter(mapping => mapping.internalShapeCode === code).map(clone);
}

function resolveAlias({ sourceSystem, externalCode, label }) {
  const aliasText = normalizeComparable(label || externalCode);
  if (!aliasText) return null;
  const alias = ALIASES.find(entry => normalizeComparable(entry.label) === aliasText);
  if (!alias) return null;
  return {
    sourceSystem: normalizeSourceSystem(sourceSystem),
    externalCode: normalizeExternalCode(externalCode),
    label: normalizeText(label),
    shapeType: alias.shapeType,
    internalShapeCode: alias.internalShapeCode,
    confidence: alias.confidence,
    status: 'mapped',
    requiresUserReview: false,
    parameterMapping: {},
  };
}

function resolveExternalShapeCode(input = {}) {
  const sourceSystem = normalizeSourceSystem(input.sourceSystem);
  const externalCode = normalizeExternalCode(input.externalCode);
  const exact = EXTERNAL_SHAPE_MAPPINGS.find(mapping =>
    mapping.sourceSystem === sourceSystem && mapping.externalCode === externalCode
  );
  if (exact) return withTemplate(clone(exact));

  const alias = resolveAlias(input);
  if (alias) return withTemplate(alias);

  return unmappedResult(input);
}

module.exports = {
  resolveExternalShapeCode,
  listExternalShapeMappings,
  getMappingsBySourceSystem,
  getMappingsByInternalShapeCode,
};
