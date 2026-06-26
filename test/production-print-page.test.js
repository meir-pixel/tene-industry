const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const printPage = require('../services/productionCardPrintPage');
const cards = require('../services/productionCards');
const industry = require('../constants');

function tryParseJSON(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

test('production print page renders fixed A4 cards without order summary and with valid inline script', () => {
  const order = {
    id: 99,
    order_num: 'HZ-PRINT-001',
    customer_name: 'Print Customer',
    project_name: 'Tower A',
    site_name: 'Site 12',
    status: 'approved',
  };
  const pallets = [{ id: 1, pallet_num: 1 }];
  const allItems = [
    {
      id: 101,
      shape_name: 'straight bar',
      diameter: 12,
      quantity: 8,
      total_length_mm: 600,
      total_weight: 4.26,
      weight_per_unit: 0.533,
      segments: [{ length_mm: 600, angle_deg: 0 }],
      note: '',
      struct_element: '',
      pallet_num: 1,
      material_grade: 'B500B',
      actual_weight_kg: 0,
      card_weights: [],
      shape_snapshot_json: JSON.stringify({ kind: 'straight' }),
    },
    {
      id: 102,
      shape_name: 'L',
      diameter: 10,
      quantity: 4,
      total_length_mm: 500,
      total_weight: 1.54,
      weight_per_unit: 0.385,
      segments: [{ length_mm: 250, angle_deg: 90 }, { length_mm: 250, angle_deg: 0 }],
      note: '',
      struct_element: '',
      pallet_num: 1,
      material_grade: 'B500B',
      actual_weight_kg: 0,
      card_weights: [],
      shape_snapshot_json: JSON.stringify({ kind: 'bent' }),
    },
  ];

  for (let i = 0; i < 7; i += 1) {
    allItems.push({ ...allItems[0], id: 200 + i, diameter: i % 2 ? 10 : 12 });
  }

  const html = printPage.renderPrintCardsPage({
    order,
    pallets,
    allItems,
    printDate: '25-06-2026',
    delivDate: '30-06-2026',
    cards,
    industry,
    tryParseJSON,
  });

  assert.doesNotMatch(html, /order-summary-sheet/);
  assert.doesNotMatch(html, /tene-pdf-logo\.jpg/);
  assert.ok(html.indexOf('cards-grid') > -1);
  assert.ok(html.indexOf('cards-pages') > -1);
  assert.equal((html.match(/class="cards-page"/g) || []).length, 2);
  assert.match(html, /page-break-after:always/);
  assert.match(html, /break-after:page/);
  assert.match(html, /appendCardToA4Pages/);
  assert.match(html, /index % 8 === 0/);
  assert.doesNotMatch(html, /setup-panel/);
  assert.doesNotMatch(html, /setupBody/);
  assert.doesNotMatch(html, /onSplitChange/);
  assert.doesNotMatch(html, /splitCfg/);
  assert.match(html, /grid-template-columns:repeat\(2,105mm\)/);
  assert.match(html, /width:210mm/);
  assert.doesNotMatch(html, /master-card/);
  assert.doesNotMatch(html, /כרטיסיית מאסטר/);
  assert.doesNotMatch(html, /cards\.masterCard/);
  assert.match(html, /@page\{size:A4 portrait;margin:0!important;\}/);
  assert.match(html, /grid-template-columns:repeat\(2, 105mm\)/);
  assert.match(html, /grid-auto-rows:74\.25mm/);
  assert.match(html, /grid-template-columns:78mm 27mm/);
  assert.match(html, /pc-print-qr-code/);
  assert.match(html, /worker-visual\.html\?card=/);
  assert.match(html, /&quot;'\+uid\+'&quot;/);

  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(script => script.includes('Server data'));
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline));
});
