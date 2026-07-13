const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SHAPE_CATALOG,
  getShapeTemplateByCode,
  getShapeTemplateByType,
  isSupportedShapeType,
  listShapeTemplates,
  normalizeShapeCode,
  validateShapeTemplateInput,
} = require('../services/shapeCatalog');

test('shape catalog maps initial external shape codes', () => {
  assert.equal(getShapeTemplateByCode('100').shapeType, 'straight_bar');
  assert.equal(getShapeTemplateByCode('103').shapeType, 'closed_stirrup');
  assert.equal(getShapeTemplateByCode('225').shapeType, 'rounded_end_bar');
});

test('shape catalog resolves Hebrew aliases for closed stirrup', () => {
  assert.equal(getShapeTemplateByCode('חישוק').shapeType, 'closed_stirrup');
  assert.equal(getShapeTemplateByCode('סטיראפ').shapeType, 'closed_stirrup');
});

test('shape catalog normalizes external shape code text', () => {
  assert.equal(normalizeShapeCode("מס' צורה 103"), '103');
  assert.equal(normalizeShapeCode('shape 100'), '100');
});

test('shape catalog returns null for unsupported codes without throwing', () => {
  assert.equal(normalizeShapeCode('999'), null);
  assert.equal(getShapeTemplateByCode('999'), null);
  assert.doesNotThrow(() => getShapeTemplateByCode('999'));
});

test('shape catalog validates required straight bar parameters', () => {
  const result = validateShapeTemplateInput('straight_bar', {});
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingParameters, ['length']);
});

test('shape catalog validates required closed stirrup parameters', () => {
  const result = validateShapeTemplateInput('closed_stirrup', {});
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingParameters, ['width', 'height']);
});

test('shape catalog accepts optional closed stirrup hook length default', () => {
  const template = getShapeTemplateByType('closed_stirrup');
  const hook = template.parameters.find(parameter => parameter.name === 'hookLength');
  assert.equal(hook.required, false);
  assert.equal(hook.defaultValue, 100);
  assert.deepEqual(validateShapeTemplateInput('closed_stirrup', { width: 300, height: 600 }).missingParameters, []);
});

test('shape catalog lists at least the phase one templates', () => {
  assert.ok(listShapeTemplates().length >= 3);
});

test('shape catalog has no duplicate external shape codes', () => {
  const codes = SHAPE_CATALOG.map(template => template.externalShapeCode);
  assert.equal(new Set(codes).size, codes.length);
});

test('shape catalog exposes supported canonical shape types', () => {
  assert.equal(isSupportedShapeType('straight_bar'), true);
  assert.equal(isSupportedShapeType('mesh_rectangular'), true);
  assert.equal(isSupportedShapeType('missing_shape'), false);
});
