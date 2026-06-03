const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIntakeOrderPayload,
  normalizeIntakeItem,
  parseManualIntakeText,
  resolveIntakeCustomer,
} = require('../services/intakeWorkflow');

test('normalizeIntakeItem builds canonical sides angles quantity and shape', () => {
  const item = normalizeIntakeItem({
    diameter: '12',
    sides: ['300', '600', '300'],
    qty: '4',
    shape: 'U - anchor',
  });

  assert.deepEqual(item.sides, [300, 600, 300]);
  assert.deepEqual(item.angles, [90, 90]);
  assert.equal(item.length, 1200);
  assert.equal(item.qty, 4);
  assert.equal(item.shapeId, 'U - anchor');
});

test('buildIntakeOrderPayload resolves customer and calculates total weight', () => {
  const payload = buildIntakeOrderPayload({
    customer_name: 'Fallback',
    delivery_date: '2026-06-03',
    items: [
      { diameter: 10, length: 1000, quantity: 2 },
      { diameter: 12, sides: [300, 300], qty: 1 },
    ],
  }, {
    source: 'phone',
    rawContent: 'fallback@example.com',
    resolveCustomer: () => ({ id: 7, name: 'מאיר', phone: '0501234567', email: 'meir@example.com' }),
    calcWeightPerUnit: (diameter, length) => diameter * length / 100000,
  });

  assert.equal(payload.customer.id, 7);
  assert.equal(payload.customer.name, 'מאיר');
  assert.equal(payload.order.channel, 'phone');
  assert.equal(payload.order.deliveryDate, '2026-06-03');
  assert.equal(payload.pallets[0].items.length, 2);
  assert.equal(payload.order.totalWeight, 10 * 1000 / 100000 * 2 + 12 * 600 / 100000);
});

test('parseManualIntakeText delegates whatsapp and manual parsing', () => {
  const whatsapp = parseManualIntakeText({
    text: 'hello',
    source: 'whatsapp',
    parseWhatsAppMessage: value => ({ channel: 'wa', value }),
    parseOCRText: () => ({ channel: 'ocr' }),
  });
  const manual = parseManualIntakeText({
    text: 'hello',
    source: 'phone',
    parseWhatsAppMessage: () => ({ channel: 'wa' }),
    parseOCRText: value => ({ channel: 'ocr', value }),
  });

  assert.equal(whatsapp.channel, 'wa');
  assert.equal(whatsapp.source, 'whatsapp');
  assert.equal(manual.channel, 'ocr');
  assert.equal(manual.source, 'phone');
});

test('resolveIntakeCustomer ranks customer candidates and removes duplicates', () => {
  const customer = { id: 9, name: 'לקוח א', phone: '0501234567', email: 'a@example.com', priority_id: 'C9' };
  const match = resolveIntakeCustomer({
    customer_phone: '050-1234567',
    customer_email: 'a@example.com',
    customer_name: 'לקוח א',
  }, '', {
    byPhone: () => customer,
    byEmail: () => customer,
    byName: () => customer,
  });

  assert.equal(match.customer.id, 9);
  assert.equal(match.customer.match_type, 'phone');
  assert.equal(match.needs_customer_review, false);
  assert.equal(match.candidates.length, 1);
});

test('resolveIntakeCustomer extracts email and phone from raw content when parsed data is partial', () => {
  const match = resolveIntakeCustomer({}, 'call 972501234567 or send to raw@example.com', {
    byPhone: phone => phone === '0501234567' ? { id: 3, name: 'טלפון', phone, email: null } : null,
    byEmail: email => ({ id: 4, name: 'מייל', phone: null, email }),
  });

  assert.equal(match.input.phone, '0501234567');
  assert.equal(match.input.email, 'raw@example.com');
  assert.equal(match.customer.id, 3);
});
