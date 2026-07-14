const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getMappingsByInternalShapeCode,
  getMappingsBySourceSystem,
  listExternalShapeMappings,
  resolveExternalShapeCode,
} = require('../services/externalShapeCodeMap');

test('external map resolves TASSA 103 to closed stirrup', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '103' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.shapeType, 'closed_stirrup');
  assert.equal(result.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(result.parameterMapping.A, 'width');
  assert.equal(result.template.shapeType, 'closed_stirrup');
});

test('external map resolves Smart2000 103 to closed stirrup', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'Smart2000', externalCode: '103' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.shapeType, 'closed_stirrup');
  assert.equal(result.internalShapeCode, 'closed_stirrup_rect_hook');
});

test('external map resolves TASSA 225 to rounded end bar', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '225' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.shapeType, 'rounded_end_bar');
  assert.equal(result.internalShapeCode, 'rounded_end_bar');
});

test('external map returns unknown for unsupported codes', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '999' });
  assert.equal(result.status, 'unmapped');
  assert.equal(result.shapeType, 'unknown');
  assert.equal(result.internalShapeCode, null);
  assert.equal(result.requiresUserReview, true);
});

test('same external code can be source-system dependent', () => {
  const tassa = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '103' });
  const smart = resolveExternalShapeCode({ sourceSystem: 'Smart2000', externalCode: '103' });
  assert.equal(tassa.sourceSystem, 'TASSA');
  assert.equal(smart.sourceSystem, 'Smart2000');
  assert.equal(tassa.internalShapeCode, smart.internalShapeCode);
});

test('Hebrew closed stirrup alias resolves without a numeric code', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'TASSA', label: 'חישוק' });
  assert.equal(result.status, 'mapped');
  assert.equal(result.shapeType, 'closed_stirrup');
  assert.equal(result.internalShapeCode, 'closed_stirrup_rect_hook');
});

test('resolveExternalShapeCode does not create snapshots or calculate weight', () => {
  const result = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '103' });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'shapeSnapshot'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'weightKg'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'calculated'), false);
});

test('external map exposes list and lookup helpers', () => {
  assert.ok(listExternalShapeMappings().length >= 6);
  assert.ok(getMappingsBySourceSystem('TASSA').some(mapping => mapping.externalCode === '103'));
  assert.ok(getMappingsByInternalShapeCode('closed_stirrup_rect_hook').length >= 2);
});
