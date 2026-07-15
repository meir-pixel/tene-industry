const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mapOcrItemToShapeSnapshot,
  extractOcrShapeSource,
  extractOcrShapeParameters,
  buildRequiresShapeReviewResult,
} = require('../services/ocrShapeSnapshotMapper');

function closedStirrupItem(overrides = {}) {
  return {
    sourceSystem: 'TASSA',
    externalShapeCode: '103',
    diameter: 8,
    width: 950,
    height: 150,
    hookLength: 100,
    ...overrides,
  };
}

test('TASSA external stirrup code builds valid Shape V2 snapshot', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ quantity: 20 }),
    source: { sourceDocumentId: 'doc_1', page: 2, rowNumber: 7 },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.reviewStatus, 'ready');
  assert.equal(result.requiresShapeEdit, false);
  assert.equal(result.shapeSnapshot.shapeType, 'closed_stirrup');
  assert.equal(result.shapeSnapshot.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(result.shapeSnapshot.calculated.totalLengthMm, 2400);
  assert.equal(result.shapeSnapshot.validation.valid, true);
});

test('externalCode alias works', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ externalShapeCode: undefined, externalCode: '103' }),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.shapeSnapshot.shapeType, 'closed_stirrup');
});

test('shapeCode alias works', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ externalShapeCode: undefined, shapeCode: '103' }),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.shapeSnapshot.internalShapeCode, 'closed_stirrup_rect_hook');
});

test('missing external shape code returns not applicable', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: { sourceSystem: 'TASSA', diameter: 8, width: 950, height: 150 },
  });

  assert.equal(result.status, 'not_applicable');
  assert.equal(result.reason, 'missing_external_shape_code');
});

test('external code without source system requires review', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ sourceSystem: undefined }),
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reason, 'missing_source_system');
  assert.equal(result.requiresShapeEdit, true);
  assert.equal(result.validation.valid, false);
});

test('unsupported external code requires review', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ externalShapeCode: '999' }),
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reason, 'unmapped_external_shape_code');
  assert.equal(result.requiresShapeEdit, true);
});

test('mapped shape without engine requires review', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: {
      sourceSystem: 'TASSA',
      externalShapeCode: '225',
      diameter: 8,
      width: 950,
      legLength: 150,
      returnLength: 100,
    },
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reason, 'shape_engine_not_available');
  assert.equal(result.requiresShapeEdit, true);
});

test('missing width for mapped stirrup requires review', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ width: undefined }),
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.includes('missing_width'));
});

test('quantity is not copied to snapshot', () => {
  const result = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ quantity: 999 }),
  });

  assert.equal(result.status, 'success');
  assert.equal(Object.hasOwn(result.shapeSnapshot, 'quantity'), false);
  assert.equal(Object.hasOwn(result.shapeSnapshot.data, 'quantity'), false);
});

test('external code does not affect geometry', () => {
  const tassa = mapOcrItemToShapeSnapshot({ item: closedStirrupItem() });
  const easybar = mapOcrItemToShapeSnapshot({
    item: closedStirrupItem({ sourceSystem: 'Easybar', externalShapeCode: 'X17' }),
  });

  assert.equal(tassa.status, 'success');
  assert.equal(easybar.status, 'success');
  assert.equal(tassa.shapeSnapshot.calculated.totalLengthMm, easybar.shapeSnapshot.calculated.totalLengthMm);
  assert.equal(
    tassa.shapeSnapshot.machineOutput.generic.segments.length,
    easybar.shapeSnapshot.machineOutput.generic.segments.length
  );
});

test('data fields take priority over flat aliases', () => {
  const parameters = extractOcrShapeParameters({
    item: {
      diameter: 6,
      width: 1,
      height: 1,
      hookLength: 1,
      data: { diameter: 8, width: 950, height: 150, hookLength: 100 },
    },
  });

  assert.equal(parameters.diameter, 8);
  assert.deepEqual(parameters.data, {
    width: 950,
    height: 150,
    hookLength: 100,
    overlapLength: undefined,
  });
});

test('document profile can provide source system when present', () => {
  const source = extractOcrShapeSource({
    item: {
      externalShapeCode: '103',
      documentProfile: 'tassa_easybar_bending_schedule',
    },
  });

  assert.equal(source.sourceSystem, 'TASSA');
  assert.equal(source.externalShapeCode, '103');
});

test('review result helper returns existing review shape', () => {
  const result = buildRequiresShapeReviewResult('missing_source_system');

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reviewStatus, 'requires_shape_edit');
  assert.equal(result.requiresShapeEdit, true);
  assert.deepEqual(result.validation.errors, ['missing_source_system']);
});
