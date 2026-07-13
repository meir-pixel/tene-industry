const assert = require('node:assert/strict');
const test = require('node:test');

const printPage = require('../services/productionCardPrintPage');
const cards = require('../services/productionCards');
const industry = require('../constants');

function tryParseJSON(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

test('production cards show per-order item numbering and struct element names', () => {
  const order = { id: 901, order_num: 'HZ-ELEMENT-001', customer_name: 'Element Customer', status: 'approved' };
  const baseItem = {
    shape_name: 'straight bar',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([{ length_mm: 1000, angle_deg: null }]),
    note: '',
    pallet_num: 1,
    material_grade: 'B500B',
    card_weights: [],
  };
  const allItems = [
    { ...baseItem, id: 144, order_id: 901, struct_element: 'קורה 1' },
    { ...baseItem, id: 145, order_id: 901, struct_element: 'עמוד A7' },
    { ...baseItem, id: 146, order_id: 901, struct_element: 'רשת רצפה' },
  ];

  const html = printPage.renderPrintCardsPage({
    order,
    pallets: [{ id: 1, pallet_num: 1 }],
    allItems,
    printDate: '12-07-2026',
    delivDate: '13-07-2026',
    cards,
    industry,
    tryParseJSON,
  });

  assert.match(html, /פריט 1\/3/);
  assert.match(html, /קורה 1/);
  assert.match(html, /פריט 2\/3/);
  assert.match(html, /עמוד A7/);
  assert.match(html, /פריט 3\/3/);
  assert.match(html, /רשת רצפה/);
  assert.doesNotMatch(html, /ITEM 144/);
  assert.doesNotMatch(html, /ITEM 145/);
  assert.doesNotMatch(html, /ITEM 146/);
  assert.match(html, /HZ-ELEMENT-001-000144/);
});

test('production card numbering resets per order and escapes struct element HTML', () => {
  const items = [
    { id: 1, order_id: 1, created_at: '2026-07-01T08:00:00Z' },
    { id: 2, order_id: 1, created_at: '2026-07-01T08:01:00Z' },
    { id: 3, order_id: 2, created_at: '2026-07-01T08:02:00Z' },
  ];
  cards.attachOrderLineNumbers(items);
  assert.deepEqual(items.map(item => `${item.orderLineNo}/${item.orderTotalLines}`), ['1/2', '2/2', '1/1']);

  const html = cards.itemCard({
    id: 999,
    orderLineNo: 1,
    orderTotalLines: 1,
    struct_element: '<img src=x onerror=alert(1)>',
    shape_name: 'straight bar',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([{ length_mm: 1000, angle_deg: null }]),
  }, { order_num: 'HZ-XSS', customer_name: 'Safe Customer' }, '12-07-2026', industry.REBAR_WEIGHTS || {});

  assert.match(html, /פריט 1\/1/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
