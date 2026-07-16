'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CANONICAL_SPEC_VERSION,
  MATCHABILITY,
  buildCanonicalPhysicalSpec,
} = require('../services/canonicalPhysicalSpec');
const {
  stableCanonicalStringify,
  buildPhysicalSpecFingerprint,
} = require('../services/physicalSpecFingerprint');
const { buildShapeSnapshotFromExternalCode } = require('../services/shapeSnapshotBuilder');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function straightSnapshot(overrides = {}) {
  const data = {
    sides: [6000],
    angles: [],
    diameter: 12,
    ...(overrides.data || {}),
  };
  return {
    contractVersion: 2,
    shapeVersion: 1,
    shapeId: 'straight-source-a',
    shapeType: 'straight_bar',
    family: 'bars',
    source: { sourceSystem: 'manual', externalShapeCode: 'SOURCE-A' },
    displayName: 'source display name',
    data,
    calculated: {
      totalLengthMm: 6000,
      weightKg: 5.328,
      ...(overrides.calculated || {}),
    },
    machineOutput: { generic: {}, machineProfiles: {} },
    validation: { valid: true, errors: [], warnings: [] },
    ...overrides,
    data,
  };
}

function closedStirrupResult({
  sourceSystem = 'TASSA',
  externalShapeCode = '103',
  width = 300,
  height = 500,
  diameter = 8,
  hookLength = 80,
  overlapLength = 0,
} = {}) {
  return buildShapeSnapshotFromExternalCode({
    sourceSystem,
    externalShapeCode,
    diameter,
    data: { width, height, hookLength, overlapLength },
    source: {
      sourceSystem,
      externalShapeCode,
      sourceDocumentId: `${sourceSystem}-document`,
    },
  });
}

function closedStirrupResultFromData(data, {
  sourceSystem = 'TASSA',
  externalShapeCode = '103',
  diameter = 8,
} = {}) {
  return buildShapeSnapshotFromExternalCode({
    sourceSystem,
    externalShapeCode,
    diameter,
    data,
    source: { sourceSystem, externalShapeCode },
  });
}

function buildResult(input) {
  const result = buildCanonicalPhysicalSpec(input);
  return {
    result,
    fingerprint: buildPhysicalSpecFingerprint(result),
  };
}

test('valid straight bar with explicit grade is exact_matchable', () => {
  const { result, fingerprint } = buildResult({
    shapeSnapshot: straightSnapshot(),
    materialGrade: ' b500b ',
  });

  assert.equal(result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.deepEqual(result.canonicalSpec, {
    canonicalSpecVersion: CANONICAL_SPEC_VERSION,
    family: 'bars',
    topology: 'straight',
    material: { grade: 'B500B' },
    diameterMm: 12,
    geometry: { lengthMm: 6000 },
  });
  assert.match(fingerprint, /^physical-spec:v1:sha256:[a-f0-9]{64}$/);
});

test('valid single-segment straight geometry remains exact-matchable', () => {
  const { result, fingerprint } = buildResult({
    shapeSnapshot: straightSnapshot({
      data: {
        sides: [6000],
        segments: [{ lengthMm: 6000, bendAfterDeg: 0 }],
        angles: [0],
        diameter: 12,
      },
    }),
    materialGrade: 'B500B',
  });

  assert.equal(result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(result.canonicalSpec.geometry.lengthMm, 6000);
  assert.match(fingerprint, /^physical-spec:v1:sha256:[a-f0-9]{64}$/);
});

test('bent or multi-segment geometry cannot masquerade as straight', () => {
  const cases = [
    {
      shapeSnapshot: straightSnapshot({
        data: {
          sides: [100, 200],
          angles: [90],
          diameter: 12,
          lengthMm: 300,
        },
      }),
    },
    {
      legacyItem: {
        family: 'bars',
        shapeType: 'straight_bar',
        diameter: 12,
        total_length_mm: 300,
        segments: JSON.stringify([
          { lengthMm: 100, bendAfterDeg: 90 },
          { lengthMm: 200, bendAfterDeg: null },
        ]),
      },
    },
    {
      shapeSnapshot: straightSnapshot({
        data: {
          segments: [{ bendAfterDeg: null }],
          angles: [],
          diameter: 12,
          lengthMm: 300,
        },
      }),
    },
  ];

  for (const input of cases) {
    const { result, fingerprint } = buildResult({ ...input, materialGrade: 'B500B' });
    assert.equal(result.status, MATCHABILITY.REVIEW_REQUIRED);
    assert.ok(result.reasonCodes.includes('invalid_straight_geometry'));
    assert.equal(result.canonicalSpec, null);
    assert.equal(fingerprint, null);
  }
});

test('straight physical changes alter fingerprints', () => {
  const base = buildResult({ shapeSnapshot: straightSnapshot(), materialGrade: 'B500B' }).fingerprint;
  const length = buildResult({
    shapeSnapshot: straightSnapshot({ data: { sides: [6100], angles: [], diameter: 12 } }),
    materialGrade: 'B500B',
  }).fingerprint;
  const diameter = buildResult({
    shapeSnapshot: straightSnapshot({ data: { sides: [6000], angles: [], diameter: 16 } }),
    materialGrade: 'B500B',
  }).fingerprint;
  const grade = buildResult({ shapeSnapshot: straightSnapshot(), materialGrade: 'B500C' }).fingerprint;

  assert.notEqual(base, length);
  assert.notEqual(base, diameter);
  assert.notEqual(base, grade);
});

test('straight bar can use an explicit legacy straight length', () => {
  const { result } = buildResult({
    legacyItem: {
      family: 'bars',
      shapeType: 'straight_bar',
      diameter: 10,
      total_length_mm: 1250,
    },
    materialGrade: 'B500B',
  });

  assert.equal(result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(result.canonicalSpec.geometry.lengthMm, 1250);
});

test('missing straight physical fields return review_required without fingerprints', () => {
  const snapshotWithoutDiameter = straightSnapshot();
  delete snapshotWithoutDiameter.data.diameter;
  const missingGrade = buildResult({ shapeSnapshot: straightSnapshot(), materialGrade: ' ' });
  const missingDiameter = buildResult({
    shapeSnapshot: snapshotWithoutDiameter,
    materialGrade: 'B500B',
  });
  const missingLength = buildResult({
    shapeSnapshot: straightSnapshot({ data: { sides: [], angles: [], diameter: 12 } }),
    materialGrade: 'B500B',
  });

  assert.equal(missingGrade.result.status, MATCHABILITY.REVIEW_REQUIRED);
  assert.deepEqual(missingGrade.result.reasonCodes, ['missing_material_grade']);
  assert.equal(missingGrade.fingerprint, null);
  assert.ok(missingDiameter.result.reasonCodes.includes('missing_diameter'));
  assert.equal(missingDiameter.fingerprint, null);
  assert.ok(missingLength.result.reasonCodes.includes('missing_length'));
  assert.equal(missingLength.fingerprint, null);
});

test('invalid and non-finite physical values never create fingerprints', () => {
  for (const diameter of [-12, Infinity, NaN]) {
    const { result, fingerprint } = buildResult({
      shapeSnapshot: straightSnapshot({ data: { sides: [6000], angles: [], diameter } }),
      materialGrade: 'B500B',
    });
    assert.equal(result.status, MATCHABILITY.REVIEW_REQUIRED);
    assert.ok(result.reasonCodes.includes('invalid_physical_value'));
    assert.equal(fingerprint, null);
  }
});

test('numeric precision supports 0.001 without silently rounding greater precision', () => {
  const acceptedA = buildResult({
    legacyItem: { family: 'bars', shapeType: 'straight_bar', diameter: 7.5, lengthMm: 1000.125 },
    materialGrade: 'B500B',
  });
  const acceptedB = buildResult({
    legacyItem: { family: 'bars', shapeType: 'straight_bar', diameter: 7.500, lengthMm: 1000.1250 },
    materialGrade: 'B500B',
  });
  const rejected = buildResult({
    legacyItem: { family: 'bars', shapeType: 'straight_bar', diameter: 7.5001, lengthMm: 1000 },
    materialGrade: 'B500B',
  });

  assert.equal(acceptedA.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(acceptedA.fingerprint, acceptedB.fingerprint);
  assert.equal(rejected.result.status, MATCHABILITY.REVIEW_REQUIRED);
  assert.deepEqual(rejected.result.reasonCodes, ['unsupported_numeric_precision']);
  assert.equal(rejected.fingerprint, null);
});

test('stable serialization ignores object key order and rejects unsupported values', () => {
  assert.equal(
    stableCanonicalStringify({ b: 2, a: { d: 4, c: 3 } }),
    stableCanonicalStringify({ a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.equal(stableCanonicalStringify({ zero: -0 }), '{"zero":0}');
  assert.throws(() => stableCanonicalStringify({ missing: undefined }), /not supported/);
  assert.throws(() => stableCanonicalStringify({ invalid: Infinity }), /non-finite/);
  assert.throws(() => stableCanonicalStringify({ callback() {} }), /not supported/);
  assert.throws(() => stableCanonicalStringify({ symbol: Symbol('x') }), /not supported/);
  assert.throws(() => stableCanonicalStringify(Array(1)), /sparse arrays/);
  assert.throws(() => stableCanonicalStringify({ [Symbol('key')]: 'value' }), /symbol keys/);

  const withExtra = [1, 2];
  withExtra.extra = 3;
  assert.throws(() => stableCanonicalStringify(withExtra), /extra array properties/);

  const withSymbol = [1, 2];
  withSymbol[Symbol('x')] = 3;
  assert.throws(() => stableCanonicalStringify(withSymbol), /symbol keys/);
  assert.equal(stableCanonicalStringify([1, 2]), '[1,2]');
});

test('material grade accepts only normalized primitive strings', () => {
  const normalized = buildResult({
    shapeSnapshot: straightSnapshot(),
    materialGrade: '  b500b   high  ',
  });
  assert.equal(normalized.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(normalized.result.canonicalSpec.material.grade, 'B500B HIGH');

  const blank = buildResult({ shapeSnapshot: straightSnapshot(), materialGrade: '   ' });
  assert.deepEqual(blank.result.reasonCodes, ['missing_material_grade']);

  for (const materialGrade of [500, false, {}, ['B500B'], new String('B500B')]) {
    const { result, fingerprint } = buildResult({
      shapeSnapshot: straightSnapshot(),
      materialGrade,
    });
    assert.equal(result.status, MATCHABILITY.REVIEW_REQUIRED);
    assert.ok(result.reasonCodes.includes('invalid_material_grade'));
    assert.equal(result.canonicalSpec, null);
    assert.equal(fingerprint, null);
  }
});

test('straight traceability and calculated values do not affect physical fingerprint', () => {
  const base = straightSnapshot();
  const changed = clone(base);
  changed.source = { sourceSystem: 'another-system', externalShapeCode: 'OTHER' };
  changed.shapeId = 'another-random-uuid';
  changed.templateUid = 'another-template';
  changed.templateVersion = 99;
  changed.internalShapeCode = 'another-internal-code';
  changed.calculated.weightKg = 999;
  changed.calculated.totalLengthMm = 123;

  const first = buildResult({ shapeSnapshot: base, materialGrade: 'B500B' });
  const second = buildResult({ shapeSnapshot: changed, materialGrade: 'B500B' });
  assert.equal(first.fingerprint, second.fingerprint);
});

test('conflicting snapshot and legacy physical fields require review', () => {
  const { result, fingerprint } = buildResult({
    shapeSnapshot: straightSnapshot(),
    legacyItem: {
      family: 'bars',
      shapeType: 'straight_bar',
      diameter: 12,
      total_length_mm: 6100,
    },
    materialGrade: 'B500B',
  });

  assert.equal(result.status, MATCHABILITY.REVIEW_REQUIRED);
  assert.ok(result.reasonCodes.includes('snapshot_legacy_conflict'));
  assert.deepEqual(result.validation.discrepancies[0], {
    field: 'geometry.lengthMm',
    snapshotValue: 6000,
    legacyValue: 6100,
  });
  assert.equal(fingerprint, null);
});

test('existing TASSA 103 and Easybar X17 builders produce the same physical fingerprint', () => {
  const tassa = closedStirrupResult();
  const easybar = closedStirrupResult({
    sourceSystem: 'Easybar',
    externalShapeCode: 'X17',
  });
  assert.equal(tassa.status, 'success');
  assert.equal(easybar.status, 'success');

  const tassaPhysical = buildResult({ shapeSnapshot: tassa.snapshot, materialGrade: 'B500B' });
  const easybarPhysical = buildResult({ shapeSnapshot: easybar.snapshot, materialGrade: 'B500B' });

  assert.equal(tassaPhysical.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(easybarPhysical.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(tassaPhysical.fingerprint, easybarPhysical.fingerprint);
  assert.deepEqual(tassaPhysical.result.canonicalSpec.geometry, {
    widthMm: 300,
    heightMm: 500,
    hookLengthMm: 80,
    overlapLengthMm: 0,
  });
});

test('closed-stirrup physical changes alter fingerprints', () => {
  const fingerprint = overrides => buildResult({
    shapeSnapshot: closedStirrupResult(overrides).snapshot,
    materialGrade: 'B500B',
  }).fingerprint;
  const base = fingerprint({});

  for (const overrides of [
    { width: 301 },
    { height: 501 },
    { diameter: 10 },
    { hookLength: 81 },
    { overlapLength: 20 },
  ]) {
    assert.notEqual(base, fingerprint(overrides));
  }
});

test('closed stirrup requires explicit hook and overlap fields', () => {
  const missingHookBuilder = closedStirrupResultFromData({
    width: 300,
    height: 500,
    overlapLength: 50,
  });
  assert.equal(missingHookBuilder.status, 'success');
  assert.equal(missingHookBuilder.snapshot.data.hookLength, 0);
  assert.deepEqual(missingHookBuilder.snapshot.validation.inputPresence, {
    hookLength: false,
    overlapLength: true,
  });
  const missingHook = buildResult({
    shapeSnapshot: missingHookBuilder.snapshot,
    materialGrade: 'B500B',
  });
  assert.equal(missingHook.result.status, MATCHABILITY.REVIEW_REQUIRED);
  assert.ok(missingHook.result.reasonCodes.includes('missing_end_treatment'));
  assert.equal(missingHook.fingerprint, null);

  const explicitZeroHookBuilder = closedStirrupResultFromData({
    width: 300,
    height: 500,
    hookLength: 0,
    overlapLength: 0,
  });
  assert.deepEqual(explicitZeroHookBuilder.snapshot.validation.inputPresence, {
    hookLength: true,
    overlapLength: true,
  });
  const explicitZeroHook = buildResult({
    shapeSnapshot: explicitZeroHookBuilder.snapshot,
    materialGrade: 'B500B',
  });
  assert.equal(explicitZeroHook.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(explicitZeroHook.result.canonicalSpec.geometry.hookLengthMm, 0);

  const missingOverlapBuilder = closedStirrupResultFromData({
    width: 300,
    height: 500,
    hookLength: 80,
  });
  assert.deepEqual(missingOverlapBuilder.snapshot.validation.inputPresence, {
    hookLength: true,
    overlapLength: false,
  });
  const missingOverlap = buildResult({
    shapeSnapshot: missingOverlapBuilder.snapshot,
    materialGrade: 'B500B',
  });
  assert.equal(missingOverlap.result.status, MATCHABILITY.REVIEW_REQUIRED);
  assert.ok(missingOverlap.result.reasonCodes.includes('missing_end_treatment'));
  assert.equal(missingOverlap.fingerprint, null);

  const explicitZeroOverlap = buildResult({
    shapeSnapshot: closedStirrupResultFromData({
      width: 300,
      height: 500,
      hookLength: 80,
      overlapLength: 0,
    }).snapshot,
    materialGrade: 'B500B',
  });
  assert.equal(explicitZeroOverlap.result.status, MATCHABILITY.EXACT_MATCHABLE);
  assert.equal(explicitZeroOverlap.result.canonicalSpec.geometry.overlapLengthMm, 0);
});

test('closed-stirrup source and software identifiers remain outside identity', () => {
  const firstSnapshot = closedStirrupResult().snapshot;
  const secondSnapshot = clone(firstSnapshot);
  secondSnapshot.source = { sourceSystem: 'Other', externalShapeCode: 'OTHER' };
  secondSnapshot.shapeId = 'shape-random-b';
  secondSnapshot.templateUid = 'template-b';
  secondSnapshot.templateVersion = 88;
  secondSnapshot.internalShapeCode = 'routing-only';
  secondSnapshot.calculated.weightKg = 777;
  secondSnapshot.calculated.totalLengthMm = 99999;

  const first = buildResult({ shapeSnapshot: firstSnapshot, materialGrade: 'B500B' });
  const second = buildResult({ shapeSnapshot: secondSnapshot, materialGrade: 'B500B' });
  assert.equal(first.fingerprint, second.fingerprint);
});

test('invalid supplied Shape V2 snapshots require review even with valid legacy fallback', () => {
  const validLegacyItem = {
    family: 'bars',
    shapeType: 'straight_bar',
    diameter: 12,
    total_length_mm: 6000,
  };
  const wrongVersion = straightSnapshot({ contractVersion: 999 });
  const missingVersion = straightSnapshot();
  delete missingVersion.contractVersion;
  const malformed = straightSnapshot();
  delete malformed.calculated;
  const validationFailed = straightSnapshot({
    validation: { valid: false, errors: ['source_invalid'], warnings: [] },
  });

  for (const shapeSnapshot of [wrongVersion, missingVersion, malformed, validationFailed]) {
    const { result, fingerprint } = buildResult({
      shapeSnapshot,
      legacyItem: validLegacyItem,
      materialGrade: 'B500B',
    });
    assert.equal(result.status, MATCHABILITY.REVIEW_REQUIRED);
    assert.deepEqual(result.reasonCodes, ['invalid_shape_snapshot']);
    assert.equal(result.canonicalSpec, null);
    assert.equal(fingerprint, null);
  }

  const validBuilderSnapshot = closedStirrupResult().snapshot;
  assert.equal(
    buildResult({ shapeSnapshot: validBuilderSnapshot, materialGrade: 'B500B' }).result.status,
    MATCHABILITY.EXACT_MATCHABLE,
  );
});

test('engine-less and unknown external mappings never create fingerprints', () => {
  const engineLess = buildShapeSnapshotFromExternalCode({
    sourceSystem: 'TASSA',
    externalShapeCode: '225',
    diameter: 8,
    data: { width: 300, legLength: 500, returnLength: 100, radius: 20 },
  });
  const unknown = buildShapeSnapshotFromExternalCode({
    sourceSystem: 'TASSA',
    externalShapeCode: '999',
    diameter: 8,
  });

  const engineLessResult = buildResult({ shapeSnapshot: engineLess, materialGrade: 'B500B' });
  const unknownResult = buildResult({ shapeSnapshot: unknown, materialGrade: 'B500B' });
  assert.equal(engineLessResult.result.status, MATCHABILITY.UNMATCHABLE);
  assert.deepEqual(engineLessResult.result.reasonCodes, ['shape_engine_unavailable']);
  assert.equal(engineLessResult.fingerprint, null);
  assert.equal(unknownResult.result.status, MATCHABILITY.UNMATCHABLE);
  assert.equal(unknownResult.fingerprint, null);
});

test('unsupported Phase 1 families and geometry return deterministic non-exact results', () => {
  const cases = [
    [straightSnapshot({ family: 'mesh', shapeType: 'mesh_rectangular', data: {} }), 'unsupported_shape_family'],
    [straightSnapshot({ family: 'piles', shapeType: 'round_pile_cage', data: {} }), 'unsupported_shape_family'],
    [straightSnapshot({ family: 'spirals', shapeType: 'spiral', data: {} }), 'unsupported_shape_family'],
    [straightSnapshot({
      shapeType: 'l_bar',
      data: { sides: [500, 200], angles: [90], diameter: 12 },
    }), 'unsupported_shape_type'],
    [straightSnapshot({ shapeType: 'rounded_end_bar', data: {} }), 'unsupported_shape_type'],
    [straightSnapshot({
      data: { sides: [1000], angles: [], diameter: 12, is3d: true },
    }), 'unsupported_3d_geometry'],
  ];

  for (const [shapeSnapshot, reason] of cases) {
    const { result, fingerprint } = buildResult({ shapeSnapshot, materialGrade: 'B500B' });
    assert.equal(result.status, MATCHABILITY.UNMATCHABLE);
    assert.deepEqual(result.reasonCodes, [reason]);
    assert.equal(fingerprint, null);
  }
});

test('canonical services contain no supplier-code-specific physical logic', () => {
  for (const file of ['canonicalPhysicalSpec.js', 'physicalSpecFingerprint.js', 'productionCardSpecSnapshot.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', file), 'utf8');
    assert.doesNotMatch(source, /TASSA|Easybar|X17|externalShapeCode\s*===\s*['"]103/);
  }
});
