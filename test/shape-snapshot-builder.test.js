'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildShapeSnapshotFromExternalCode,
  buildShapeSnapshotFromTemplate,
  normalizeExternalShapeInput,
  resolveShapeEngineForTemplate,
} = require('../services/shapeSnapshotBuilder');
const { isShapeDataContractV2 } = require('../services/shapeSnapshot');

function closedStirrupInput(overrides = {}) {
  return {
    sourceSystem: 'TASSA',
    externalShapeCode: '103',
    diameter: 8,
    data: {
      width: 950,
      height: 150,
      hookLength: 100,
      ...(overrides.data || {}),
    },
    source: {
      sourceDocumentId: 'doc_1',
      page: 2,
      rowNumber: 7,
      ...(overrides.source || {}),
    },
    ...overrides,
  };
}

function segmentLengths(snapshot) {
  return snapshot.geometry.segments.map(segment => segment.lengthMm);
}

test('TASSA 103 builds valid V2 snapshot', () => {
  const result = buildShapeSnapshotFromExternalCode(closedStirrupInput());

  assert.equal(result.status, 'success');
  assert.equal(isShapeDataContractV2(result.snapshot), true);
  assert.equal(result.snapshot.contractVersion, 2);
  assert.equal(result.snapshot.shapeType, 'closed_stirrup');
  assert.equal(result.snapshot.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(result.snapshot.templateUid, 'tpl_system_tassa_103');
  assert.equal(result.snapshot.templateVersion, 1);
  assert.equal(result.snapshot.source.externalShapeCode, '103');
  assert.equal(result.snapshot.source.sourceSystem, 'TASSA');
  assert.equal(result.snapshot.calculated.totalLengthMm, 2400);
  assert.equal(result.snapshot.validation.valid, true);
});

test('Smart2000 103 produces same geometry as TASSA 103', () => {
  const tassa = buildShapeSnapshotFromExternalCode(closedStirrupInput());
  const smart = buildShapeSnapshotFromExternalCode(closedStirrupInput({
    sourceSystem: 'Smart2000',
    source: { sourceSystem: 'Smart2000' },
  }));

  assert.equal(smart.status, 'success');
  assert.equal(smart.snapshot.calculated.totalLengthMm, tassa.snapshot.calculated.totalLengthMm);
  assert.deepEqual(segmentLengths(smart.snapshot), segmentLengths(tassa.snapshot));
  assert.equal(tassa.snapshot.source.sourceSystem, 'TASSA');
  assert.equal(smart.snapshot.source.sourceSystem, 'Smart2000');
});

test('Easybar X17 maps to same closed stirrup engine', () => {
  const result = buildShapeSnapshotFromExternalCode(closedStirrupInput({
    sourceSystem: 'Easybar',
    externalShapeCode: 'X17',
    source: { sourceSystem: 'Easybar' },
  }));

  assert.equal(result.status, 'success');
  assert.equal(result.snapshot.shapeType, 'closed_stirrup');
  assert.equal(result.snapshot.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(result.snapshot.calculated.totalLengthMm, 2400);
});

test('externalShapeCode alias normalization works', () => {
  const normalized = normalizeExternalShapeInput(closedStirrupInput());
  const result = buildShapeSnapshotFromExternalCode(closedStirrupInput());

  assert.equal(normalized.externalCode, '103');
  assert.equal(result.status, 'success');
});

test('unsupported external code does not throw', () => {
  const result = buildShapeSnapshotFromExternalCode({
    sourceSystem: 'TASSA',
    externalShapeCode: '999',
    diameter: 8,
    data: { width: 950, height: 150 },
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reason, 'unmapped_external_shape_code');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.includes('unmapped_external_shape_code'));
});

test('mapped shape without engine returns review', () => {
  const result = buildShapeSnapshotFromExternalCode({
    sourceSystem: 'TASSA',
    externalShapeCode: '225',
    diameter: 8,
    data: { width: 950, legLength: 150, returnLength: 100 },
  });

  assert.equal(result.status, 'requires_user_review');
  assert.equal(result.reason, 'shape_engine_not_available');
  assert.equal(result.shapeType, 'rounded_end_bar');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.includes('shape_engine_not_available'));
});

test('quantity is not copied into snapshot', () => {
  const result = buildShapeSnapshotFromExternalCode(closedStirrupInput({ quantity: 999 }));
  const snapshotJson = JSON.stringify(result.snapshot);

  assert.equal(result.status, 'success');
  assert.equal(Object.hasOwn(result.snapshot, 'quantity'), false);
  assert.equal(Object.hasOwn(result.snapshot.data, 'quantity'), false);
  assert.equal(snapshotJson.includes('"quantity"'), false);
});

test('external code does not affect geometry', () => {
  const tassa = buildShapeSnapshotFromExternalCode(closedStirrupInput());
  const easybar = buildShapeSnapshotFromExternalCode(closedStirrupInput({
    sourceSystem: 'Easybar',
    externalShapeCode: 'X17',
    source: { sourceSystem: 'Easybar' },
  }));

  assert.equal(easybar.snapshot.calculated.totalLengthMm, tassa.snapshot.calculated.totalLengthMm);
  assert.equal(easybar.snapshot.geometry.bends.length, tassa.snapshot.geometry.bends.length);
  assert.equal(easybar.snapshot.geometry.segments.length, tassa.snapshot.geometry.segments.length);
});

test('machine profiles placeholders exist', () => {
  const result = buildShapeSnapshotFromExternalCode(closedStirrupInput());

  assert.ok(result.snapshot.machineOutput.generic);
  assert.ok(result.snapshot.machineOutput.machineProfiles);
  assert.ok(result.snapshot.machineOutput.machineProfiles.MEP);
  assert.ok(result.snapshot.machineOutput.machineProfiles.PEDAX);
  assert.ok(result.snapshot.machineOutput.machineProfiles.SCHNELL);
});

test('builder does not import OCR DB routes or browser modules', () => {
  const modulePaths = Object.keys(require.cache).map(file => file.replace(/\\/g, '/'));

  assert.equal(modulePaths.some(file => file.endsWith('/services/steelDocumentParser.js')), false);
  assert.equal(modulePaths.some(file => file.endsWith('/services/intakeWorkflow.js')), false);
  assert.equal(modulePaths.some(file => file.includes('/routes/')), false);
  assert.equal(modulePaths.some(file => file.includes('/db/')), false);
  assert.equal(modulePaths.some(file => file.includes('/public/')), false);
});

test('buildShapeSnapshotFromTemplate builds through template engine path', () => {
  const result = buildShapeSnapshotFromTemplate({
    templateUid: 'tpl_system_tassa_103',
    diameter: 8,
    data: { width: 950, height: 150, hookLength: 100 },
    source: { sourceSystem: 'TASSA', externalShapeCode: '103' },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.engine, 'closedStirrupEngine');
  assert.equal(result.snapshot.calculated.totalLengthMm, 2400);
  assert.equal(isShapeDataContractV2(result.snapshot), true);
});

test('resolveShapeEngineForTemplate selects by shape type and internal shape code', () => {
  assert.equal(resolveShapeEngineForTemplate({
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
  }).name, 'closedStirrupEngine');
  assert.equal(resolveShapeEngineForTemplate({
    shapeType: 'straight_bar',
    internalShapeCode: 'straight_bar',
  }), null);
});
