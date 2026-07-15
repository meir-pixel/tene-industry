'use strict';

const { buildShapeSnapshotFromExternalCode } = require('./shapeSnapshotBuilder');

function cleanText(value) {
  return String(value ?? '').trim();
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstTextValue(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function firstNumberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeProfileSource(value) {
  const text = cleanText(value);
  if (text === 'tassa_easybar_bending_schedule') return 'TASSA';
  return text;
}

function extractOcrShapeSource(input = {}) {
  const item = objectOrEmpty(input.item || input);
  const source = objectOrEmpty(input.source);
  const itemSource = objectOrEmpty(item.source);
  const parsingProfile = objectOrEmpty(item.parsing_profile || item.parsingProfile || source.parsing_profile || source.parsingProfile);
  const documentProfile = firstTextValue(
    item.documentProfile,
    item.document_profile,
    item.documentSourceSystem,
    item.document_source_system,
    itemSource.documentProfile,
    itemSource.document_profile,
    source.documentProfile,
    source.document_profile,
    parsingProfile.id,
    parsingProfile.name
  );
  const sourceSystem = firstTextValue(
    item.sourceSystem,
    item.source_system,
    item.documentSourceSystem,
    item.document_source_system,
    itemSource.sourceSystem,
    itemSource.source_system,
    source.sourceSystem,
    source.source_system,
    normalizeProfileSource(documentProfile)
  );
  const externalShapeCode = firstTextValue(
    item.externalShapeCode,
    item.externalCode,
    item.shapeCode,
    item.rawShapeCode,
    item.external_shape_code,
    item.external_code,
    item.shape_code,
    item.raw_shape_code,
    itemSource.externalShapeCode,
    itemSource.externalCode,
    source.externalShapeCode,
    source.externalCode
  );
  return {
    sourceSystem,
    externalShapeCode,
    externalCode: firstTextValue(item.externalCode, item.external_code, itemSource.externalCode, source.externalCode, externalShapeCode),
    source: {
      ...source,
      ...itemSource,
      ...(sourceSystem ? { sourceSystem } : {}),
      ...(externalShapeCode ? { externalShapeCode } : {}),
      ...(documentProfile ? { documentProfile } : {}),
    },
  };
}

function extractOcrShapeParameters(input = {}) {
  const item = objectOrEmpty(input.item || input);
  const data = objectOrEmpty(item.data);
  const diameter = firstNumberValue(
    data.diameter,
    item.diameter,
    item.diameter_mm,
    item.barDiameter,
    item.bar_diameter
  );
  return {
    diameter,
    data: {
      width: firstNumberValue(data.width, data.width_mm, data.A, item.width, item.width_mm, item.A),
      height: firstNumberValue(data.height, data.height_mm, data.B, item.height, item.height_mm, item.B),
      hookLength: firstNumberValue(data.hookLength, data.hook_length, data.C, item.hookLength, item.hook_length, item.C),
      overlapLength: firstNumberValue(data.overlapLength, data.overlap_length, data.overlap, item.overlapLength, item.overlap_length, item.overlap),
    },
  };
}

function buildRequiresShapeReviewResult(reason, details = {}) {
  return {
    status: 'requires_user_review',
    reason,
    ...details,
    requiresShapeEdit: true,
    reviewStatus: 'requires_shape_edit',
    validation: details.validation || {
      valid: false,
      errors: [reason],
      warnings: [],
    },
  };
}

function mapOcrItemToShapeSnapshot(input = {}) {
  const item = objectOrEmpty(input.item || input);
  const shapeSource = extractOcrShapeSource(input);
  if (!shapeSource.externalShapeCode) {
    return {
      status: 'not_applicable',
      reason: 'missing_external_shape_code',
    };
  }
  if (!shapeSource.sourceSystem) {
    return buildRequiresShapeReviewResult('missing_source_system');
  }

  const parameters = extractOcrShapeParameters(input);
  const builderResult = buildShapeSnapshotFromExternalCode({
    sourceSystem: shapeSource.sourceSystem,
    externalShapeCode: shapeSource.externalShapeCode,
    externalCode: shapeSource.externalCode,
    diameter: parameters.diameter,
    data: parameters.data,
    source: {
      ...shapeSource.source,
      sourceDocumentId: input.source?.sourceDocumentId || item.sourceDocumentId || item.source_document_id,
      page: input.source?.page || item.page || item.source_page,
      rowNumber: input.source?.rowNumber || item.rowNumber || item.row_number || item.item_number,
    },
  });

  const snapshot = builderResult.snapshot || null;
  if (builderResult.status === 'success' && snapshot?.validation?.valid) {
    return {
      status: 'success',
      shapeSnapshot: snapshot,
      reviewStatus: 'ready',
      requiresShapeEdit: false,
      mapping: builderResult.mapping,
      template: builderResult.template,
      engine: builderResult.engine,
      validation: builderResult.validation,
    };
  }

  return buildRequiresShapeReviewResult(builderResult.reason || 'missing_required_shape_parameters', {
    mapping: builderResult.mapping,
    template: builderResult.template,
    engine: builderResult.engine,
    validation: builderResult.validation || snapshot?.validation || {
      valid: false,
      errors: ['missing_required_shape_parameters'],
      warnings: [],
    },
  });
}

module.exports = {
  mapOcrItemToShapeSnapshot,
  extractOcrShapeSource,
  extractOcrShapeParameters,
  buildRequiresShapeReviewResult,
};
