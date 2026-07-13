'use strict';

const SHAPE_TYPES = Object.freeze({
  STRAIGHT_BAR: 'straight_bar',
  POLYLINE_BAR: 'polyline_bar',
  CLOSED_STIRRUP: 'closed_stirrup',
  ROUNDED_END_BAR: 'rounded_end_bar',
  OVERLAP_BAR: 'overlap_bar',
  SPIRAL_BAR: 'spiral_bar',
  MESH_RECTANGULAR: 'mesh_rectangular',
  ROUND_PILE_CAGE: 'round_pile_cage',
  CUSTOM_POLYLINE: 'custom_polyline',
});

const SHAPE_CATALOG = Object.freeze([
  Object.freeze({
    externalShapeCode: '100',
    shapeType: SHAPE_TYPES.STRAIGHT_BAR,
    family: 'bars',
    label: 'מוט ישר',
    aliases: Object.freeze(['100', "מס' צורה 100", 'shape 100']),
    parameters: Object.freeze([
      Object.freeze({ name: 'length', required: true, unit: 'mm' }),
    ]),
  }),
  Object.freeze({
    externalShapeCode: '103',
    shapeType: SHAPE_TYPES.CLOSED_STIRRUP,
    family: 'bars',
    label: 'חישוק מלבני',
    aliases: Object.freeze(['103', 'חישוק', 'סטיראפ', "מס' צורה 103"]),
    parameters: Object.freeze([
      Object.freeze({ name: 'width', required: true, unit: 'mm' }),
      Object.freeze({ name: 'height', required: true, unit: 'mm' }),
      Object.freeze({ name: 'hookLength', required: false, unit: 'mm', defaultValue: 100 }),
    ]),
  }),
  Object.freeze({
    externalShapeCode: '225',
    shapeType: SHAPE_TYPES.ROUNDED_END_BAR,
    family: 'bars',
    label: 'קצה מעוגל',
    aliases: Object.freeze(['225', 'מעוגל', 'קצה מעוגל', "מס' צורה 225"]),
    parameters: Object.freeze([
      Object.freeze({ name: 'width', required: true, unit: 'mm' }),
      Object.freeze({ name: 'legLength', required: true, unit: 'mm' }),
      Object.freeze({ name: 'returnLength', required: true, unit: 'mm' }),
      Object.freeze({ name: 'radius', required: false, unit: 'mm' }),
    ]),
  }),
]);

const SUPPORTED_SHAPE_TYPES = new Set(Object.values(SHAPE_TYPES));

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function templateAliases(template) {
  return [template.externalShapeCode, template.label, ...(template.aliases || [])];
}

function normalizeShapeCode(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const directNumber = text.match(/\b\d{2,4}\b/);
  if (directNumber) {
    const code = directNumber[0];
    return SHAPE_CATALOG.some(template => template.externalShapeCode === code) ? code : null;
  }

  const template = SHAPE_CATALOG.find(entry =>
    templateAliases(entry).some(alias => normalizeText(alias) === text)
  );
  return template ? template.externalShapeCode : null;
}

function cloneTemplate(template) {
  if (!template) return null;
  return {
    ...template,
    aliases: [...template.aliases],
    parameters: template.parameters.map(parameter => ({ ...parameter })),
  };
}

function getShapeTemplateByCode(code) {
  const normalized = normalizeShapeCode(code);
  if (!normalized) return null;
  return cloneTemplate(SHAPE_CATALOG.find(template => template.externalShapeCode === normalized));
}

function getShapeTemplateByType(shapeType) {
  const type = normalizeText(shapeType);
  if (!type) return null;
  return cloneTemplate(SHAPE_CATALOG.find(template => template.shapeType === type));
}

function isSupportedShapeType(shapeType) {
  return SUPPORTED_SHAPE_TYPES.has(String(shapeType || '').trim());
}

function listShapeTemplates() {
  return SHAPE_CATALOG.map(cloneTemplate);
}

function hasInputValue(input, name) {
  return input && Object.prototype.hasOwnProperty.call(input, name) && input[name] !== null && input[name] !== undefined && input[name] !== '';
}

function validateShapeTemplateInput(shapeType, input = {}) {
  const template = getShapeTemplateByType(shapeType);
  if (!template) {
    return {
      valid: false,
      shapeType: String(shapeType || ''),
      externalShapeCode: null,
      missingParameters: [],
      errors: ['unsupported shapeType'],
    };
  }

  const missingParameters = template.parameters
    .filter(parameter => parameter.required && !hasInputValue(input, parameter.name))
    .map(parameter => parameter.name);

  return {
    valid: missingParameters.length === 0,
    shapeType: template.shapeType,
    externalShapeCode: template.externalShapeCode,
    missingParameters,
    errors: missingParameters.map(name => `${name} is required`),
  };
}

module.exports = {
  SHAPE_TYPES,
  SHAPE_CATALOG,
  normalizeShapeCode,
  getShapeTemplateByCode,
  getShapeTemplateByType,
  isSupportedShapeType,
  listShapeTemplates,
  validateShapeTemplateInput,
};
