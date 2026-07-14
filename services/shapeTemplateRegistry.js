'use strict';

const crypto = require('crypto');
const { isSupportedShapeType } = require('./shapeCatalog');

const TEMPLATE_STATUSES = Object.freeze(['draft', 'active', 'deprecated']);
const TEMPLATE_SOURCES = Object.freeze(['system', 'learned', 'manual']);
const SUPPORTED_FAMILIES = Object.freeze(['bars', 'mesh', 'piles', 'spirals']);

const INITIAL_TEMPLATES = Object.freeze([
  Object.freeze({
    templateUid: 'tpl_system_straight_bar_100',
    source: 'system',
    status: 'active',
    family: 'bars',
    shapeType: 'straight_bar',
    internalShapeCode: 'straight_bar',
    displayName: 'מוט ישר',
    version: 1,
    parameters: Object.freeze([
      Object.freeze({ key: 'length', label: 'אורך', unit: 'mm', required: true }),
    ]),
    defaultData: Object.freeze({}),
    validation: Object.freeze({ minSegments: 1, maxSegments: 1, allowClosed: false }),
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  }),
  Object.freeze({
    templateUid: 'tpl_system_tassa_103',
    source: 'system',
    status: 'active',
    family: 'bars',
    shapeType: 'closed_stirrup',
    internalShapeCode: 'closed_stirrup_rect_hook',
    displayName: 'חישוק מלבני עם קרסים',
    version: 1,
    parameters: Object.freeze([
      Object.freeze({ key: 'width', label: 'רוחב', unit: 'mm', required: true }),
      Object.freeze({ key: 'height', label: 'גובה', unit: 'mm', required: true }),
      Object.freeze({ key: 'hookLength', label: 'אורך קרס', unit: 'mm', required: false, defaultValue: 100 }),
    ]),
    defaultData: Object.freeze({}),
    validation: Object.freeze({ minSegments: 4, maxSegments: 5, allowClosed: true }),
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  }),
  Object.freeze({
    templateUid: 'tpl_system_rounded_end_225',
    source: 'system',
    status: 'active',
    family: 'bars',
    shapeType: 'rounded_end_bar',
    internalShapeCode: 'rounded_end_bar',
    displayName: 'קצה מעוגל',
    version: 1,
    parameters: Object.freeze([
      Object.freeze({ key: 'width', label: 'רוחב', unit: 'mm', required: true }),
      Object.freeze({ key: 'legLength', label: 'אורך רגל', unit: 'mm', required: true }),
      Object.freeze({ key: 'returnLength', label: 'אורך חזרה', unit: 'mm', required: true }),
      Object.freeze({ key: 'radius', label: 'רדיוס', unit: 'mm', required: false }),
    ]),
    defaultData: Object.freeze({}),
    validation: Object.freeze({ minSegments: 3, maxSegments: 6, allowClosed: false }),
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  }),
]);

const registry = INITIAL_TEMPLATES.map(cloneTemplate);

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback ?? '').trim();
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
}

function cloneTemplate(template) {
  return cloneValue(template);
}

function normalizeStatus(value, fallback = 'draft') {
  const status = cleanText(value || fallback);
  return TEMPLATE_STATUSES.includes(status) ? status : fallback;
}

function normalizeSource(value, fallback = 'manual') {
  const source = cleanText(value || fallback);
  return TEMPLATE_SOURCES.includes(source) ? source : fallback;
}

function normalizeParameter(parameter = {}) {
  return {
    ...parameter,
    key: cleanText(parameter.key || parameter.name),
    label: cleanText(parameter.label || parameter.key || parameter.name),
    unit: cleanText(parameter.unit || 'mm'),
    required: Boolean(parameter.required),
  };
}

function normalizeTemplateDefinition(input = {}, defaults = {}) {
  const timestamp = nowIso();
  const parameters = Array.isArray(input.parameters) ? input.parameters.map(normalizeParameter) : [];
  return {
    templateUid: cleanText(input.templateUid || defaults.templateUid || `tpl_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}`),
    source: normalizeSource(input.source, defaults.source || 'manual'),
    status: normalizeStatus(input.status, defaults.status || 'draft'),
    family: cleanText(input.family || defaults.family || 'bars'),
    shapeType: cleanText(input.shapeType || defaults.shapeType),
    internalShapeCode: cleanText(input.internalShapeCode || defaults.internalShapeCode),
    displayName: cleanText(input.displayName || defaults.displayName),
    version: Math.max(1, Math.round(Number(input.version || defaults.version || 1) || 1)),
    parameters,
    defaultData: cloneValue(input.defaultData || defaults.defaultData || {}),
    validation: cloneValue(input.validation || defaults.validation || {}),
    createdAt: cleanText(input.createdAt || defaults.createdAt || timestamp),
    updatedAt: cleanText(input.updatedAt || timestamp),
  };
}

function validateShapeTemplateDefinition(template = {}) {
  const errors = [];
  const warnings = [];
  const parameters = Array.isArray(template.parameters) ? template.parameters : [];
  const keys = parameters.map(parameter => cleanText(parameter.key || parameter.name)).filter(Boolean);
  const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);

  if (!cleanText(template.shapeType)) errors.push('shapeType is required');
  else if (!isSupportedShapeType(template.shapeType)) errors.push('shapeType is not supported');
  if (!cleanText(template.internalShapeCode)) errors.push('internalShapeCode is required');
  if (!cleanText(template.displayName)) errors.push('displayName is required');
  if (!SUPPORTED_FAMILIES.includes(cleanText(template.family))) errors.push('family is not supported');
  if (!Array.isArray(template.parameters)) errors.push('parameters must be an array');
  parameters.forEach((parameter, index) => {
    if (!cleanText(parameter.key || parameter.name)) errors.push(`parameters[${index}].key is required`);
  });
  if (duplicateKeys.length) errors.push(`duplicate parameter keys: ${[...new Set(duplicateKeys)].join(', ')}`);
  if (!(Number(template.version) > 0)) errors.push('version must be a positive number');
  if (!TEMPLATE_STATUSES.includes(cleanText(template.status))) errors.push('status must be draft, active, or deprecated');

  const duplicateActive = registry.find(existing =>
    existing.templateUid !== template.templateUid
    && existing.status === 'active'
    && template.status === 'active'
    && existing.internalShapeCode === template.internalShapeCode
    && Number(existing.version) === Number(template.version)
  );
  if (duplicateActive) errors.push('active template with same internalShapeCode and version already exists');

  return { valid: errors.length === 0, errors, warnings };
}

function sortTemplates(templates) {
  return [...templates].sort((a, b) =>
    String(a.internalShapeCode).localeCompare(String(b.internalShapeCode))
    || Number(b.version) - Number(a.version)
    || String(a.templateUid).localeCompare(String(b.templateUid))
  );
}

function listShapeTemplates(options = {}) {
  const includeDeprecated = Boolean(options.includeDeprecated);
  const templates = includeDeprecated ? registry : registry.filter(template => template.status !== 'deprecated');
  return sortTemplates(templates).map(cloneTemplate);
}

function getShapeTemplateByUid(templateUid) {
  const uid = cleanText(templateUid);
  return cloneTemplate(registry.find(template => template.templateUid === uid) || null);
}

function getShapeTemplateByInternalCode(internalShapeCode) {
  const code = cleanText(internalShapeCode);
  const candidates = registry
    .filter(template => template.internalShapeCode === code && template.status === 'active')
    .sort((a, b) => Number(b.version) - Number(a.version));
  return cloneTemplate(candidates[0] || null);
}

function createShapeTemplateDraft(input = {}) {
  const template = normalizeTemplateDefinition(input, { status: 'draft', source: input.source || 'manual' });
  const validation = validateShapeTemplateDefinition(template);
  if (!validation.valid) {
    const error = new Error('invalid shape template definition');
    error.code = 'invalid_shape_template';
    error.validation = validation;
    throw error;
  }
  registry.push(template);
  return cloneTemplate(template);
}

function updateTemplateStatus(templateUid, status, updates = {}) {
  const uid = cleanText(templateUid);
  const index = registry.findIndex(template => template.templateUid === uid);
  if (index < 0) return null;
  const next = normalizeTemplateDefinition({ ...registry[index], ...updates, status, updatedAt: nowIso() }, registry[index]);
  const validation = validateShapeTemplateDefinition(next);
  if (!validation.valid) {
    const error = new Error('invalid shape template status update');
    error.code = 'invalid_shape_template';
    error.validation = validation;
    throw error;
  }
  registry[index] = next;
  return cloneTemplate(next);
}

function activateShapeTemplate(templateUid) {
  return updateTemplateStatus(templateUid, 'active');
}

function deprecateShapeTemplate(templateUid, reason = '') {
  return updateTemplateStatus(templateUid, 'deprecated', { deprecatedReason: cleanText(reason) });
}

function createShapeTemplateVersion(templateUid, updates = {}) {
  const current = getShapeTemplateByUid(templateUid);
  if (!current) return null;
  const nextVersion = Math.max(1, Number(current.version || 1) + 1);
  const baseUid = String(current.templateUid).replace(/_v\d+$/, '');
  const next = normalizeTemplateDefinition({
    ...current,
    ...updates,
    templateUid: updates.templateUid || `${baseUid}_v${nextVersion}`,
    version: nextVersion,
    status: updates.status || 'draft',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, current);
  const validation = validateShapeTemplateDefinition(next);
  if (!validation.valid) {
    const error = new Error('invalid shape template version');
    error.code = 'invalid_shape_template';
    error.validation = validation;
    throw error;
  }
  registry.push(next);
  return cloneTemplate(next);
}

function resolveShapeTemplate({ shapeType, internalShapeCode, templateUid } = {}) {
  if (templateUid) return getShapeTemplateByUid(templateUid);
  if (internalShapeCode) return getShapeTemplateByInternalCode(internalShapeCode);
  const type = cleanText(shapeType);
  const candidates = registry
    .filter(template => template.shapeType === type && template.status === 'active')
    .sort((a, b) => Number(b.version) - Number(a.version));
  return cloneTemplate(candidates[0] || null);
}

function buildShapeLearningEvent(input = {}) {
  return {
    sourceSystem: cleanText(input.sourceSystem),
    sourceDocumentType: cleanText(input.sourceDocumentType || 'steel_order'),
    externalShapeCode: cleanText(input.externalShapeCode),
    before: cloneValue(input.before || { rawRow: {}, suggestedShapeType: 'unknown' }),
    after: cloneValue(input.after || {
      shapeType: cleanText(input.shapeType),
      internalShapeCode: cleanText(input.internalShapeCode),
      parameters: cloneValue(input.parameters || {}),
    }),
    approvedBy: cleanText(input.approvedBy || 'user'),
    approvedAt: cleanText(input.approvedAt || nowIso()),
    confidence: cleanText(input.confidence || 'manual'),
  };
}

module.exports = {
  listShapeTemplates,
  getShapeTemplateByUid,
  getShapeTemplateByInternalCode,
  createShapeTemplateDraft,
  activateShapeTemplate,
  deprecateShapeTemplate,
  createShapeTemplateVersion,
  resolveShapeTemplate,
  validateShapeTemplateDefinition,
  buildShapeLearningEvent,
};
