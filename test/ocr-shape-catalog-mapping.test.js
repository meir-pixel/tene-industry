const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyShapeCatalogMapping,
  extractExternalShapeCode,
} = require('../services/steelDocumentParser');
const {
  buildIntakeOrderPayload,
  normalizeIntakeItem,
} = require('../services/intakeWorkflow');

test('OCR parser extracts explicit external shape codes without using item numbers', () => {
  assert.equal(extractExternalShapeCode({ shape_code: '100' }), '100');
  assert.equal(extractExternalShapeCode({ text: "מס' צורה: 103" }), '103');
  assert.equal(extractExternalShapeCode({ cells: { shape: { raw: 'shape 225 rounded end' } } }), '225');
  assert.equal(extractExternalShapeCode({ text: 'item 12 diameter 14 length 450' }), null);
});

test('external shape code 100 maps to the canonical straight bar safely', () => {
  const mapped = applyShapeCatalogMapping({
    externalShapeCode: '100',
    diameter: 12,
    quantity: 4,
    total_length_mm: 3000,
  });

  assert.equal(mapped.externalShapeCode, '100');
  assert.equal(mapped.shapeType, 'straight_bar');
  assert.equal(mapped.shape_type, 'straight_bar');
  assert.equal(mapped.status, 'recognized');
  assert.equal(mapped.review_status, 'parsed');
  assert.equal(mapped.review_notes.length, 0);
});

test('external shape codes 103 and 225 require Shape Editor review in phase one', () => {
  for (const code of ['103', '225']) {
    const mapped = applyShapeCatalogMapping({
      externalShapeCode: code,
      diameter: 10,
      quantity: 8,
      total_length_mm: 1200,
    });

    assert.equal(mapped.externalShapeCode, code);
    assert.equal(mapped.status, 'requires_shape_edit');
    assert.equal(mapped.review_status, 'needs_review');
    assert.ok(mapped.shapeType);
    assert.ok(mapped.review_notes.some(note => note.code === 'requires_shape_editor'));
  }
});

test('unsupported external shape code is never converted to straight bar', () => {
  const mapped = applyShapeCatalogMapping({
    externalShapeCode: '999',
    diameter: 10,
    quantity: 8,
    total_length_mm: 1200,
  });

  assert.equal(mapped.externalShapeCode, '999');
  assert.equal(mapped.shapeType, 'unknown');
  assert.equal(mapped.shape_type, 'unknown');
  assert.equal(mapped.status, 'requires_shape_edit');
  assert.ok(mapped.review_notes.some(note => note.code === 'unsupported_external_shape_code'));

  const normalized = normalizeIntakeItem(mapped);
  assert.equal(normalized.shapeSnapshot, null);
  assert.notEqual(normalized.shapeType, 'straight_bar');
  assert.ok(normalized.reviewNotes.some(note => note.field === 'shape'));
});

test('TASSA fixture rows preserve safe catalog status before order approval', () => {
  const rows = [
    { text: "מס' צורה: 100", diameter: 12, quantity: 30, total_length_mm: 3000 },
    { text: "מס' צורה: 103", diameter: 8, quantity: 60, total_length_mm: 1000 },
    { text: "מס' צורה: 225", diameter: 14, quantity: 10, total_length_mm: 2500 },
  ].map(row => applyShapeCatalogMapping(row, row));

  assert.equal(rows[0].status, 'recognized');
  assert.equal(rows[1].status, 'requires_shape_edit');
  assert.equal(rows[2].status, 'requires_shape_edit');
});

test('Intake approval payload keeps unsupported OCR shapes as review data instead of fake straight snapshots', () => {
  const payload = buildIntakeOrderPayload({
    customer_name: 'Customer A',
    source_identity: { source_system: 'ocr', external_id: 'doc-1' },
    items: [
      applyShapeCatalogMapping({
        externalShapeCode: '999',
        diameter: 12,
        quantity: 2,
        total_length_mm: 3000,
        length: 3000,
      }),
    ],
  }, { calcWeightPerUnit: () => 1 });

  const item = payload.pallets[0].items[0];
  assert.equal(item.externalShapeCode, '999');
  assert.equal(item.status, 'requires_shape_edit');
  assert.equal(item.shapeSnapshot, null);
  assert.ok(item.reviewNotes.some(note => note.code === 'unsupported_external_shape_code'));
});
