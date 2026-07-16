const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveExternalShapeCode,
  registerLearnedMappingProvider,
} = require('../services/externalShapeCodeMap');
const { mapOcrItemToShapeSnapshot } = require('../services/ocrShapeSnapshotMapper');

test.afterEach(() => registerLearnedMappingProvider(null));

test('learned provider resolves a code missing from the built-in catalog', () => {
  registerLearnedMappingProvider((sourceSystem, externalCode) => (
    sourceSystem === 'TASSA' && externalCode === '777'
      ? { internal_shape_code: 'closed_stirrup_rect_hook', shape_type: 'closed_stirrup', label: 'learned 777', confidence: 'learned', parameter_mapping: '{}' }
      : null
  ));

  const mapping = resolveExternalShapeCode({ sourceSystem: 'tassa', externalCode: '777' });
  assert.equal(mapping.status, 'mapped');
  assert.equal(mapping.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(mapping.learned, true);
  assert.equal(mapping.requiresUserReview, false);
  assert.ok(mapping.template, 'learned mapping must resolve its shape template');
});

test('built-in catalog wins over the learned provider', () => {
  let providerCalls = 0;
  registerLearnedMappingProvider(() => {
    providerCalls += 1;
    return { internal_shape_code: 'straight_bar', shape_type: 'straight_bar' };
  });

  const mapping = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '103' });
  assert.equal(mapping.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(mapping.learned, undefined);
  assert.equal(providerCalls, 0, 'provider must not be consulted for built-in codes');
});

test('provider errors and invalid rows fall through to unmapped', () => {
  registerLearnedMappingProvider(() => { throw new Error('db unavailable'); });
  assert.equal(resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '999' }).status, 'unmapped');

  registerLearnedMappingProvider(() => ({ shape_type: 'closed_stirrup' }));
  assert.equal(resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '999' }).status, 'unmapped');
});

test('no provider registered keeps previous unmapped behavior', () => {
  registerLearnedMappingProvider(null);
  const mapping = resolveExternalShapeCode({ sourceSystem: 'TASSA', externalCode: '888' });
  assert.equal(mapping.status, 'unmapped');
  assert.equal(mapping.requiresUserReview, true);
});

test('learned code builds a full shape snapshot through the OCR mapper', () => {
  registerLearnedMappingProvider((sourceSystem, externalCode) => (
    externalCode === '888'
      ? { internal_shape_code: 'closed_stirrup_rect_hook', shape_type: 'closed_stirrup' }
      : null
  ));

  const result = mapOcrItemToShapeSnapshot({
    item: {
      sourceSystem: 'TASSA',
      externalShapeCode: '888',
      diameter: 8,
      width: 950,
      height: 150,
      hookLength: 100,
      quantity: 10,
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.reviewStatus, 'ready');
  assert.ok(result.shapeSnapshot);
});
