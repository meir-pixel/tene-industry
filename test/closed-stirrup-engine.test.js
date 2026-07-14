'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildClosedStirrupShape,
  validateClosedStirrupInput,
  calculateClosedStirrupGeometry,
  calculateClosedStirrupLength,
  buildClosedStirrupMachineOutput,
} = require('../services/shapeEngines/closedStirrupEngine');

function baseInput(overrides = {}) {
  const merged = {
    family: 'bars',
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
    diameter: 8,
    data: {
      width: 950,
      height: 150,
      hookLength: 100,
      overlapLength: null,
      ...(overrides.data || {}),
    },
    source: {
      sourceSystem: 'TASSA',
      externalShapeCode: '103',
      ...(overrides.source || {}),
    },
    ...overrides,
  };
  merged.data = {
    width: 950,
    height: 150,
    hookLength: 100,
    overlapLength: null,
    ...(overrides.data || {}),
  };
  return merged;
}

test('valid closed stirrup calculates length', () => {
  const shape = buildClosedStirrupShape(baseInput());

  assert.equal(shape.validation.valid, true);
  assert.equal(shape.calculated.totalLengthMm, 2400);
  assert.equal(shape.calculated.bendCount, 4);
  assert.ok(shape.calculated.weightKg > 0);
  assert.equal(shape.family, 'bars');
  assert.equal(shape.shapeType, 'closed_stirrup');
  assert.equal(shape.internalShapeCode, 'closed_stirrup_rect_hook');
});

test('uses overlapLength instead of two hooks', () => {
  const shape = buildClosedStirrupShape(baseInput({
    data: { overlapLength: 250 },
  }));

  assert.equal(shape.calculated.totalLengthMm, (2 * 950) + (2 * 150) + 250);
  assert.ok(shape.validation.warnings.includes('both_hook_and_overlap_provided'));
  assert.equal(shape.geometry.segments[0].role, 'overlap');
});

test('missing width invalid', () => {
  const validation = validateClosedStirrupInput(baseInput({ data: { width: undefined } }));

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('missing_width'));
});

test('missing diameter invalid', () => {
  const validation = validateClosedStirrupInput({
    data: { width: 950, height: 150, hookLength: 100 },
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('missing_diameter'));
});

test('no quantity in output', () => {
  const shape = buildClosedStirrupShape({ ...baseInput(), quantity: 50 });

  assert.equal(Object.prototype.hasOwnProperty.call(shape, 'quantity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(shape.data, 'quantity'), false);
  assert.equal(JSON.stringify(shape).includes('"quantity"'), false);
});

test('source external code does not affect geometry', () => {
  const fromTassa = buildClosedStirrupShape(baseInput({
    source: { sourceSystem: 'TASSA', externalShapeCode: '103' },
  }));
  const fromEasybar = buildClosedStirrupShape(baseInput({
    source: { sourceSystem: 'Easybar', externalShapeCode: 'X17' },
  }));

  assert.equal(fromTassa.calculated.totalLengthMm, fromEasybar.calculated.totalLengthMm);
  assert.deepEqual(fromTassa.geometry, fromEasybar.geometry);
  assert.ok(fromTassa.validation.warnings.includes('source_external_code_ignored_by_engine'));
  assert.ok(fromEasybar.validation.warnings.includes('source_external_code_ignored_by_engine'));
});

test('segments include hooks and rectangle', () => {
  const geometry = calculateClosedStirrupGeometry(baseInput());
  const roles = geometry.segments.map(segment => segment.role);

  assert.ok(roles.includes('hook_start'));
  assert.ok(roles.includes('side_width_1'));
  assert.ok(roles.includes('side_height_1'));
  assert.ok(roles.includes('hook_end'));
  assert.equal(geometry.bends.length, 4);
  assert.equal(geometry.bends.every(bend => bend.angleDeg === 90), true);
});

test('machineOutput generic exists', () => {
  const machineOutput = buildClosedStirrupMachineOutput(baseInput());

  assert.equal(machineOutput.generic.shapeType, 'closed_stirrup');
  assert.equal(machineOutput.generic.internalShapeCode, 'closed_stirrup_rect_hook');
  assert.equal(Array.isArray(machineOutput.generic.segments), true);
  assert.equal(Array.isArray(machineOutput.generic.bends), true);
  assert.deepEqual(machineOutput.machineProfiles, {});
});

test('previewData exists', () => {
  const shape = buildClosedStirrupShape(baseInput());

  assert.equal(shape.previewData.type, 'closed_stirrup');
  assert.ok(shape.previewData.labels.some(label => label.key === 'width' && label.value === 950));
  assert.ok(shape.previewData.labels.some(label => label.key === 'height' && label.value === 150));
});

test('engine imports without OCR, catalog, routes, db, or browser dependencies', () => {
  const modulePaths = Object.keys(require.cache).map(file => file.replace(/\\/g, '/'));

  assert.equal(modulePaths.some(file => file.endsWith('/services/steelDocumentParser.js')), false);
  assert.equal(modulePaths.some(file => file.endsWith('/services/intakeWorkflow.js')), false);
  assert.equal(modulePaths.some(file => file.endsWith('/services/shapeCatalog.js')), false);
  assert.equal(modulePaths.some(file => file.includes('/routes/')), false);
  assert.equal(modulePaths.some(file => file.includes('/db/')), false);
});

test('calculateClosedStirrupLength handles default hook length as zero', () => {
  const length = calculateClosedStirrupLength({
    diameter: 8,
    data: { width: 950, height: 150 },
  });

  assert.equal(length, 2200);
});
