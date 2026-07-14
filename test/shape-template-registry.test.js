const assert = require('node:assert/strict');
const test = require('node:test');

const {
  activateShapeTemplate,
  buildShapeLearningEvent,
  createShapeTemplateDraft,
  createShapeTemplateVersion,
  deprecateShapeTemplate,
  getShapeTemplateByInternalCode,
  getShapeTemplateByUid,
  listShapeTemplates,
  resolveShapeTemplate,
  validateShapeTemplateDefinition,
} = require('../services/shapeTemplateRegistry');

test('listShapeTemplates returns active templates', () => {
  const templates = listShapeTemplates();
  assert.ok(templates.length >= 3);
  assert.ok(templates.every(template => template.status !== 'deprecated'));
});

test('getShapeTemplateByInternalCode returns the active template', () => {
  const template = getShapeTemplateByInternalCode('closed_stirrup_rect_hook');
  assert.equal(template.shapeType, 'closed_stirrup');
  assert.equal(template.status, 'active');
});

test('createShapeTemplateDraft creates a draft template', () => {
  const template = createShapeTemplateDraft({
    templateUid: 'tpl_test_manual_open_u',
    source: 'manual',
    family: 'bars',
    shapeType: 'open_u_bar',
    internalShapeCode: 'test_open_u_bar',
    displayName: 'בדיקה U פתוח',
    parameters: [
      { key: 'A', label: 'רגל א', unit: 'mm', required: true },
      { key: 'B', label: 'גשר', unit: 'mm', required: true },
    ],
  });
  assert.equal(template.status, 'draft');
  assert.equal(getShapeTemplateByUid(template.templateUid).internalShapeCode, 'test_open_u_bar');
});

test('activateShapeTemplate changes status to active', () => {
  const template = createShapeTemplateDraft({
    templateUid: 'tpl_test_activate',
    family: 'bars',
    shapeType: 'polyline_bar',
    internalShapeCode: 'test_activate_polyline',
    displayName: 'בדיקה להפעלה',
    parameters: [{ key: 'A', required: true }],
  });
  const active = activateShapeTemplate(template.templateUid);
  assert.equal(active.status, 'active');
});

test('deprecateShapeTemplate changes status without deleting the template', () => {
  const template = createShapeTemplateDraft({
    templateUid: 'tpl_test_deprecate',
    family: 'bars',
    shapeType: 'polyline_bar',
    internalShapeCode: 'test_deprecate_polyline',
    displayName: 'בדיקה להשבתה',
    parameters: [{ key: 'A', required: true }],
  });
  const deprecated = deprecateShapeTemplate(template.templateUid, 'replaced by newer template');
  assert.equal(deprecated.status, 'deprecated');
  assert.equal(getShapeTemplateByUid(template.templateUid).status, 'deprecated');
});

test('createShapeTemplateVersion increments version without changing the old template', () => {
  const original = createShapeTemplateDraft({
    templateUid: 'tpl_test_version',
    family: 'bars',
    shapeType: 'polyline_bar',
    internalShapeCode: 'test_version_polyline',
    displayName: 'בדיקת גרסה',
    parameters: [{ key: 'A', required: true }],
  });
  const next = createShapeTemplateVersion(original.templateUid, {
    displayName: 'בדיקת גרסה 2',
    parameters: [{ key: 'A', required: true }, { key: 'B', required: false }],
  });
  assert.equal(next.version, 2);
  assert.equal(getShapeTemplateByUid(original.templateUid).version, 1);
  assert.equal(getShapeTemplateByUid(original.templateUid).displayName, 'בדיקת גרסה');
});

test('resolveShapeTemplate can resolve by templateUid, internal code, or shapeType', () => {
  assert.equal(resolveShapeTemplate({ templateUid: 'tpl_system_tassa_103' }).shapeType, 'closed_stirrup');
  assert.equal(resolveShapeTemplate({ internalShapeCode: 'straight_bar' }).shapeType, 'straight_bar');
  assert.equal(resolveShapeTemplate({ shapeType: 'rounded_end_bar' }).internalShapeCode, 'rounded_end_bar');
});

test('validateShapeTemplateDefinition reports missing required identity fields', () => {
  const validation = validateShapeTemplateDefinition({ parameters: [] });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('shapeType is required'));
  assert.ok(validation.errors.includes('internalShapeCode is required'));
});

test('validateShapeTemplateDefinition rejects duplicate parameter keys', () => {
  const validation = validateShapeTemplateDefinition({
    templateUid: 'tpl_test_duplicate_params',
    source: 'manual',
    status: 'draft',
    family: 'bars',
    shapeType: 'polyline_bar',
    internalShapeCode: 'test_duplicate_params',
    displayName: 'Duplicate params',
    version: 1,
    parameters: [{ key: 'A' }, { key: 'A' }],
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes('duplicate parameter keys')));
});

test('buildShapeLearningEvent returns a valid learning contract without DB writes', () => {
  const event = buildShapeLearningEvent({
    sourceSystem: 'TASSA',
    externalShapeCode: '999',
    before: { rawRow: { code: '999' }, suggestedShapeType: 'unknown' },
    after: {
      shapeType: 'closed_stirrup',
      internalShapeCode: 'closed_stirrup_rect_hook',
      parameters: { width: 950, height: 150, hookLength: 100 },
    },
    approvedBy: 'user',
  });
  assert.equal(event.sourceSystem, 'TASSA');
  assert.equal(event.after.shapeType, 'closed_stirrup');
  assert.equal(event.confidence, 'manual');
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'dbSaved'), false);
});
