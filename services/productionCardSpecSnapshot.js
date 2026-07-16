'use strict';

const {
  CANONICAL_SPEC_VERSION,
  buildCanonicalPhysicalSpec,
} = require('./canonicalPhysicalSpec');
const { buildPhysicalSpecFingerprint } = require('./physicalSpecFingerprint');

const CONTRACT_VERSION = 'production-card-spec/v1';

function cloneValue(value, active = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (active.has(value)) return active.get(value);
  const clone = Array.isArray(value) ? [] : {};
  active.set(value, clone);
  if (Array.isArray(value)) {
    value.forEach(entry => clone.push(cloneValue(entry, active)));
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      if (entry !== undefined) clone[key] = cloneValue(entry, active);
    });
  }
  return clone;
}

function deepFreeze(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  Object.freeze(value);
  Object.values(value).forEach(entry => deepFreeze(entry, visited));
  return value;
}

function parseSnapshot(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.snapshot && typeof value.snapshot === 'object' ? value.snapshot : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function buildTraceability(shapeSnapshot) {
  const snapshot = parseSnapshot(shapeSnapshot);
  if (!snapshot) return {};
  const data = snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : {};
  const generic = snapshot.machineOutput?.generic || {};
  const source = snapshot.source && typeof snapshot.source === 'object' ? snapshot.source : {};
  const values = {
    sourceSystem: firstDefined(source.sourceSystem, snapshot.sourceSystem),
    externalShapeCode: firstDefined(source.externalShapeCode, source.externalCode, snapshot.externalShapeCode),
    internalShapeCode: firstDefined(snapshot.internalShapeCode, data.internalShapeCode, generic.internalShapeCode),
    templateUid: firstDefined(snapshot.templateUid, data.templateUid, generic.templateUid),
    templateVersion: firstDefined(snapshot.templateVersion, data.templateVersion, generic.templateVersion),
    shapeId: snapshot.shapeId,
    shapeVersion: snapshot.shapeVersion,
    snapshotContractVersion: snapshot.contractVersion,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function buildSource(shapeSnapshot, legacyItem) {
  const hasSnapshot = shapeSnapshot !== undefined && shapeSnapshot !== null;
  const hasLegacy = legacyItem !== undefined && legacyItem !== null;
  if (hasSnapshot && hasLegacy) {
    return {
      kind: 'shape_snapshot_and_legacy_item',
      value: cloneValue({ shapeSnapshot, legacyItem }),
    };
  }
  if (hasSnapshot) return { kind: 'shape_snapshot', value: cloneValue(shapeSnapshot) };
  if (hasLegacy) return { kind: 'legacy_item', value: cloneValue(legacyItem) };
  return { kind: 'none', value: null };
}

function buildProductionCardSpecSnapshot(input = {}) {
  const matchability = buildCanonicalPhysicalSpec(input);
  const physicalSpecFingerprint = buildPhysicalSpecFingerprint(matchability);
  const contract = {
    contractVersion: CONTRACT_VERSION,
    matchability: {
      status: matchability.status,
      reasonCodes: [...matchability.reasonCodes],
    },
    canonicalSpecVersion: CANONICAL_SPEC_VERSION,
    canonicalSpec: matchability.canonicalSpec ? cloneValue(matchability.canonicalSpec) : null,
    physicalSpecFingerprint,
    source: buildSource(input.shapeSnapshot, input.legacyItem),
    traceability: buildTraceability(input.shapeSnapshot),
    validation: {
      discrepancies: cloneValue(matchability.validation.discrepancies),
    },
  };
  return deepFreeze(contract);
}

module.exports = {
  buildProductionCardSpecSnapshot,
};
