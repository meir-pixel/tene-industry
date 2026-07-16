'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildShapeSnapshotFromExternalCode } = require('../services/shapeSnapshotBuilder');
const { buildProductionCardSpecSnapshot } = require('../services/productionCardSpecSnapshot');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function straightSnapshot(overrides = {}) {
  return {
    contractVersion: 2,
    shapeVersion: 4,
    shapeId: 'straight-trace-id',
    shapeType: 'straight_bar',
    family: 'bars',
    source: {
      sourceSystem: 'Portal',
      externalShapeCode: 'PORTAL-STRAIGHT',
    },
    internalShapeCode: 'straight_bar',
    templateUid: 'tpl-straight',
    templateVersion: 7,
    data: {
      sides: [6000],
      angles: [],
      diameter: 12,
      ...(overrides.data || {}),
    },
    calculated: {
      totalLengthMm: 6000,
      weightKg: 5.328,
    },
    machineOutput: { generic: {}, machineProfiles: {} },
    validation: { valid: true, errors: [], warnings: [] },
    ...overrides,
  };
}

function closedSnapshot(width = 300) {
  const result = buildShapeSnapshotFromExternalCode({
    sourceSystem: 'TASSA',
    externalShapeCode: '103',
    diameter: 8,
    data: {
      width,
      height: 500,
      hookLength: 80,
      overlapLength: 0,
    },
    source: {
      sourceSystem: 'TASSA',
      externalShapeCode: '103',
      sourceDocumentId: 'source-document',
    },
  });
  assert.equal(result.status, 'success');
  return result.snapshot;
}

function assertDeepFrozen(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(entry => assertDeepFrozen(entry, visited));
}

test('production-card specification is deeply immutable and does not mutate input', () => {
  const input = {
    shapeSnapshot: straightSnapshot(),
    legacyItem: {
      family: 'bars',
      shapeType: 'straight_bar',
      diameter: 12,
      total_length_mm: 6000,
      nested: { note: 'source-only' },
    },
    materialGrade: 'B500B',
  };
  const before = clone(input);
  const contract = buildProductionCardSpecSnapshot(input);

  assert.deepEqual(input, before);
  assert.notEqual(contract.source.value, input.shapeSnapshot);
  assert.notEqual(contract.source.value.shapeSnapshot, input.shapeSnapshot);
  assert.notEqual(contract.source.value.shapeSnapshot.data, input.shapeSnapshot.data);
  assert.notEqual(contract.source.value.legacyItem, input.legacyItem);
  assertDeepFrozen(contract);
  assert.throws(() => {
    contract.source.value.shapeSnapshot.data.sides[0] = 1;
  }, TypeError);
  assert.equal(input.shapeSnapshot.data.sides[0], 6000);
});

test('exact production-card specification contains canonical spec and fingerprint', () => {
  const contract = buildProductionCardSpecSnapshot({
    shapeSnapshot: straightSnapshot(),
    materialGrade: ' b500b ',
  });

  assert.equal(contract.contractVersion, 'production-card-spec/v1');
  assert.equal(contract.matchability.status, 'exact_matchable');
  assert.deepEqual(contract.matchability.reasonCodes, []);
  assert.equal(contract.canonicalSpecVersion, 1);
  assert.equal(contract.canonicalSpec.material.grade, 'B500B');
  assert.match(contract.physicalSpecFingerprint, /^physical-spec:v1:sha256:[a-f0-9]{64}$/);
});

test('review-required production-card specification has no fingerprint or invented canonical values', () => {
  const contract = buildProductionCardSpecSnapshot({
    shapeSnapshot: straightSnapshot(),
    materialGrade: '',
  });

  assert.equal(contract.matchability.status, 'review_required');
  assert.deepEqual(contract.matchability.reasonCodes, ['missing_material_grade']);
  assert.equal(contract.physicalSpecFingerprint, null);
  assert.equal(contract.canonicalSpec, null);
});

test('traceability is preserved outside the canonical physical specification', () => {
  const snapshot = straightSnapshot();
  const contract = buildProductionCardSpecSnapshot({
    shapeSnapshot: snapshot,
    materialGrade: 'B500B',
  });

  assert.deepEqual(contract.traceability, {
    sourceSystem: 'Portal',
    externalShapeCode: 'PORTAL-STRAIGHT',
    internalShapeCode: 'straight_bar',
    templateUid: 'tpl-straight',
    templateVersion: 7,
    shapeId: 'straight-trace-id',
    shapeVersion: 4,
    snapshotContractVersion: 2,
  });
  for (const excluded of [
    'sourceSystem',
    'externalShapeCode',
    'internalShapeCode',
    'templateUid',
    'templateVersion',
    'shapeId',
    'shapeVersion',
    'snapshotContractVersion',
  ]) {
    assert.equal(Object.hasOwn(contract.canonicalSpec, excluded), false);
  }
});

test('changing traceability does not change fingerprint', () => {
  const firstSnapshot = straightSnapshot();
  const secondSnapshot = clone(firstSnapshot);
  secondSnapshot.source.sourceSystem = 'Other';
  secondSnapshot.source.externalShapeCode = 'OTHER';
  secondSnapshot.shapeId = 'other-shape-id';
  secondSnapshot.templateUid = 'other-template';
  secondSnapshot.templateVersion = 999;
  secondSnapshot.internalShapeCode = 'other-internal-code';

  const first = buildProductionCardSpecSnapshot({
    shapeSnapshot: firstSnapshot,
    materialGrade: 'B500B',
  });
  const second = buildProductionCardSpecSnapshot({
    shapeSnapshot: secondSnapshot,
    materialGrade: 'B500B',
  });

  assert.equal(first.physicalSpecFingerprint, second.physicalSpecFingerprint);
  assert.notDeepEqual(first.traceability, second.traceability);
});

test('changing physical geometry changes fingerprint', () => {
  const first = buildProductionCardSpecSnapshot({
    shapeSnapshot: closedSnapshot(300),
    materialGrade: 'B500B',
  });
  const second = buildProductionCardSpecSnapshot({
    shapeSnapshot: closedSnapshot(301),
    materialGrade: 'B500B',
  });

  assert.equal(first.matchability.status, 'exact_matchable');
  assert.equal(second.matchability.status, 'exact_matchable');
  assert.notEqual(first.physicalSpecFingerprint, second.physicalSpecFingerprint);
});

test('snapshot and legacy discrepancies remain immutable validation data', () => {
  const contract = buildProductionCardSpecSnapshot({
    shapeSnapshot: straightSnapshot(),
    legacyItem: {
      family: 'bars',
      shapeType: 'straight_bar',
      diameter: 12,
      total_length_mm: 6100,
    },
    materialGrade: 'B500B',
  });

  assert.equal(contract.matchability.status, 'review_required');
  assert.equal(contract.physicalSpecFingerprint, null);
  assert.deepEqual(contract.validation.discrepancies, [{
    field: 'geometry.lengthMm',
    snapshotValue: 6000,
    legacyValue: 6100,
  }]);
  assert.equal(Object.isFrozen(contract.validation.discrepancies[0]), true);
});

test('unsupported family remains non-exact in immutable contract', () => {
  const contract = buildProductionCardSpecSnapshot({
    shapeSnapshot: {
      contractVersion: 2,
      shapeVersion: 1,
      shapeId: 'mesh-id',
      shapeType: 'mesh_rectangular',
      family: 'mesh',
      data: { length: 600, width: 250 },
    },
    materialGrade: 'B500B',
  });

  assert.equal(contract.matchability.status, 'unmatchable');
  assert.deepEqual(contract.matchability.reasonCodes, ['unsupported_shape_family']);
  assert.equal(contract.canonicalSpec, null);
  assert.equal(contract.physicalSpecFingerprint, null);
});
