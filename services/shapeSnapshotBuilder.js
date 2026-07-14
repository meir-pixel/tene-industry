'use strict';

const crypto = require('crypto');
const { resolveExternalShapeCode } = require('./externalShapeCodeMap');
const { resolveShapeTemplate } = require('./shapeTemplateRegistry');
const {
  buildFullShapeSnapshot,
  buildMachineProfilesPlaceholder,
  isShapeDataContractV2,
} = require('./shapeSnapshot');
const { buildClosedStirrupShape } = require('./shapeEngines/closedStirrupEngine');

function cleanText(value, fallback = '') {
  return String(value ?? fallback ?? '').trim();
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function normalizeExternalShapeInput(input = {}) {
  const source = cloneObject(input.source);
  const sourceSystem = cleanText(input.sourceSystem ?? source.sourceSystem);
  const externalCode = cleanText(input.externalCode ?? input.externalShapeCode ?? source.externalCode ?? source.externalShapeCode);
  const externalShapeCode = cleanText(input.externalShapeCode ?? source.externalShapeCode ?? externalCode);
  const label = cleanText(input.label ?? source.label);
  return {
    ...input,
    sourceSystem,
    externalCode,
    externalShapeCode,
    label,
    source: {
      ...source,
      ...(sourceSystem ? { sourceSystem } : {}),
      ...(externalShapeCode ? { externalShapeCode } : {}),
      ...(externalCode ? { externalCode } : {}),
      ...(label ? { label } : {}),
    },
  };
}

function reviewResult({ reason, mapping = null, template = null, shapeType = '', internalShapeCode = '' } = {}) {
  return {
    status: 'requires_user_review',
    reason,
    ...(mapping ? { mapping } : {}),
    ...(template ? { template } : {}),
    ...(shapeType ? { shapeType } : {}),
    ...(internalShapeCode ? { internalShapeCode } : {}),
    validation: {
      valid: false,
      errors: [reason],
      warnings: [],
    },
  };
}

function resolveShapeEngineForTemplate(templateOrMapping = {}) {
  const shapeType = cleanText(templateOrMapping.shapeType);
  const internalShapeCode = cleanText(templateOrMapping.internalShapeCode);
  const engines = {
    'closed_stirrup:closed_stirrup_rect_hook': {
      name: 'closedStirrupEngine',
      buildShape: buildClosedStirrupShape,
    },
  };
  return engines[`${shapeType}:${internalShapeCode}`] || null;
}

function stableShapeId({ template, source, data, diameter }) {
  const payload = JSON.stringify({
    templateUid: template?.templateUid || null,
    internalShapeCode: template?.internalShapeCode || null,
    sourceSystem: source?.sourceSystem || null,
    externalShapeCode: source?.externalShapeCode || null,
    data: data || {},
    diameter: diameter ?? null,
  });
  return `shape-${crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16)}`;
}

function sourceString(source = {}) {
  return cleanText(source.sourceSystem || source.system || 'shape-snapshot-builder');
}

function buildEngineInput({ template, input, source }) {
  const data = cloneObject(input.data);
  const diameter = input.diameter ?? data.diameter;
  return {
    family: template.family,
    shapeType: template.shapeType,
    internalShapeCode: template.internalShapeCode,
    diameter,
    data: {
      ...data,
      diameter,
    },
    source,
  };
}

function snapshotFromEngineShape({ engineShape, template, input, source }) {
  const approvedAt = input.approvedAt || new Date().toISOString();
  const data = {
    ...engineShape.data,
    internalShapeCode: engineShape.internalShapeCode,
    templateUid: template.templateUid,
    templateVersion: template.version,
  };
  delete data.quantity;

  const generic = {
    ...(engineShape.machineOutput?.generic || {}),
    family: engineShape.family,
    shapeType: engineShape.shapeType,
    internalShapeCode: engineShape.internalShapeCode,
    templateUid: template.templateUid,
    templateVersion: template.version,
    totalLengthMm: engineShape.calculated?.totalLengthMm,
    weightKg: engineShape.calculated?.weightKg,
    bendCount: engineShape.calculated?.bendCount,
  };
  delete generic.quantity;

  const snapshot = buildFullShapeSnapshot({
    shapeId: input.shapeId || stableShapeId({ template, source, data: engineShape.data, diameter: engineShape.data?.diameter }),
    shapeVersion: input.shapeVersion || 1,
    shapeType: engineShape.shapeType,
    family: engineShape.family,
    source: sourceString(source),
    approvedAt,
    displayName: input.displayName || template.displayName || engineShape.shapeType,
    data,
    calculated: { ...(engineShape.calculated || {}) },
    machineOutput: {
      generic,
      machineProfiles: buildMachineProfilesPlaceholder(),
    },
    validation: engineShape.validation,
    extra: {
      internalShapeCode: engineShape.internalShapeCode,
      templateUid: template.templateUid,
      templateVersion: template.version,
      source,
      geometry: engineShape.geometry,
      previewData: engineShape.previewData,
    },
  });

  delete snapshot.quantity;
  delete snapshot.data.quantity;
  delete snapshot.machineOutput.generic.quantity;

  return snapshot;
}

function buildShapeSnapshotFromTemplate(input = {}) {
  const template = resolveShapeTemplate({
    templateUid: input.templateUid,
    internalShapeCode: input.internalShapeCode,
    shapeType: input.shapeType,
  });
  if (!template) {
    return reviewResult({
      reason: 'shape_template_not_found',
      shapeType: cleanText(input.shapeType),
      internalShapeCode: cleanText(input.internalShapeCode),
    });
  }

  const engine = resolveShapeEngineForTemplate(template);
  if (!engine) {
    return reviewResult({
      reason: 'shape_engine_not_available',
      template,
      shapeType: template.shapeType,
      internalShapeCode: template.internalShapeCode,
    });
  }

  const source = normalizeExternalShapeInput(input).source;
  const engineShape = engine.buildShape(buildEngineInput({ template, input, source }));
  const snapshot = snapshotFromEngineShape({ engineShape, template, input, source });
  return {
    status: isShapeDataContractV2(snapshot) ? 'success' : 'requires_user_review',
    template,
    engine: engine.name,
    snapshot,
    validation: snapshot.validation,
  };
}

function buildShapeSnapshotFromExternalCode(input = {}) {
  const normalized = normalizeExternalShapeInput(input);
  const mapping = resolveExternalShapeCode({
    sourceSystem: normalized.sourceSystem,
    externalCode: normalized.externalCode,
    label: normalized.label,
  });

  if (!mapping || mapping.status !== 'mapped') {
    return reviewResult({
      reason: 'unmapped_external_shape_code',
      mapping,
    });
  }

  const template = resolveShapeTemplate({
    templateUid: mapping.template?.templateUid,
    internalShapeCode: mapping.internalShapeCode,
    shapeType: mapping.shapeType,
  });
  if (!template) {
    return reviewResult({
      reason: 'shape_template_not_found',
      mapping,
      shapeType: mapping.shapeType,
      internalShapeCode: mapping.internalShapeCode,
    });
  }

  const result = buildShapeSnapshotFromTemplate({
    ...normalized,
    templateUid: template.templateUid,
    shapeType: template.shapeType,
    internalShapeCode: template.internalShapeCode,
    source: {
      ...normalized.source,
      sourceSystem: mapping.sourceSystem || normalized.sourceSystem,
      externalShapeCode: normalized.externalShapeCode || mapping.externalCode,
      externalCode: mapping.externalCode || normalized.externalCode,
      mappingStatus: mapping.status,
      mappingConfidence: mapping.confidence,
    },
  });

  return result.status === 'success'
    ? { ...result, mapping }
    : { ...result, mapping: result.mapping || mapping };
}

module.exports = {
  buildShapeSnapshotFromExternalCode,
  buildShapeSnapshotFromTemplate,
  resolveShapeEngineForTemplate,
  normalizeExternalShapeInput,
};
