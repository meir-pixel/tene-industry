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
  assert.match(html, /var cardSplits = \{\}/);
  assert.match(html, /function setCardSplit\(itemId, count, event\)/);
  assert.match(html, /pc-screen-tools/);
  assert.match(html, /function openCardSplitMenu\(itemId, event\)/);
  assert.match(html, /function escapeHtml\(value\)/);
  assert.ok(html.indexOf('function escapeHtml(value)') < html.indexOf('function dimensionLabelSvg'));
  assert.match(html, /pc-split-hotspot/);
  assert.match(html, /data-split-menu-open/);
  assert.doesNotMatch(html, /\\u05e4\\u05e6\\u05dc \\u05dc-2/);
  assert.match(html, /Math\.min\(2, Number\(cardSplits\[item\.id\]/);
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
  assert.match(html, /worker-visual\.html\?scan=1&card=/);
  assert.match(html, /"shape_svg":/);
  assert.match(html, /item\.shape_svg \|\| buildShapeSVG\(segs\)/);
  assert.match(html, /qrFallbackUrl/);
  assert.match(html, /api\.qrserver\.com\/v1\/create-qr-code/);
  assert.match(html, /data-qr-target/);
  assert.match(html, /renderWorkerCardQrCodes\(\)\.then/);
  assert.match(html, /&quot;'\+uid\+'&quot;/);

  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(script => script.includes('Server data'));
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline));
});

test('production card shape renderer keeps angled open stirrups inside a print-fit viewBox', () => {
  const html = cards.shapeSvg([
    { length_mm: 75, angle_deg: 45 },
    { length_mm: 250, angle_deg: 90 },
    { length_mm: 200, angle_deg: 90 },
    { length_mm: 250, angle_deg: 45 },
    { length_mm: 75, angle_deg: 0 },
  ]);

  assert.match(html, /data-shape-kind="angled-open-stirrup"/);
  assert.match(html, /data-scale-mode="print-fit"/);
  assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(html, /viewBox="0 0 260 140"/);
  assert.doesNotMatch(html, /viewBox="0 0 240 120"/);
  assert.match(html, />45°</);
});


test('production print page expands pile cages to master and component cards', () => {
  const pileSnapshot = {
    family: 'piles',
    shapeType: 'round_pile_cage',
    manufacturingBreakdown: [
      { componentType: 'longitudinal_straight_bar', description: 'Longitudinal straight bars', diameterMm: 20, quantity: 4, totalLengthMm: 12000, weightKg: 118.4 },
      { componentType: 'spiral_zone', description: 'Spiral zone A', name: 'A', diameterMm: 8, quantity: 1, totalLengthMm: 30000, weightKg: 11.8 },
      { componentType: 'hoop_ring', description: 'Internal hoop ring', diameterMm: 14, quantity: 4, totalLengthMm: 7000, weightKg: 8.5 },
    ],
  };
  const html = printPage.renderPrintCardsPage({
    order: { id: 77, order_num: 'HZ-PILE-001', customer_name: 'Pile Customer', status: 'approved' },
    pallets: [{ id: 1, pallet_num: 1 }],
    allItems: [{
      id: 501,
      shape_name: 'כלונס',
      diameter: 20,
      quantity: 2,
      total_length_mm: 12000,
      total_weight: 280,
      segments: JSON.stringify([]),
      note: '',
      pallet_num: 1,
      material_grade: 'B500B',
      card_weights: [],
      shape_snapshot_json: JSON.stringify(pileSnapshot),
    }],
    printDate: '05-07-2026',
    delivDate: '10-07-2026',
    cards,
    industry,
    tryParseJSON,
  });

  assert.match(html, /כלונס 1\/2/);
  assert.match(html, /כלונס 2\/2/);
  assert.match(html, /מוטות אורך ישרים/);
  assert.match(html, /ספירלה A/);
  assert.match(html, /טבעות חיזוק פנימיות/);
  assert.match(html, /HZ-PILE-001-000501-P1-MASTER/);
  assert.match(html, /HZ-PILE-001-000501-P2-C3/);
  assert.match(html, /data-shape-kind=\"pile-spiral-component\"/);
  assert.match(html, /data-component-type=\"spiral_zone\"/);
  assert.match(html, /data-shape-kind=\"pile-hoop-component\"/);
  assert.equal(new Set(html.match(/HZ-PILE-001-000501-P[12]-(?:MASTER|C[123])/g) || []).size, 8);
  assert.equal((html.match(/class="cards-page"/g) || []).length, 1);
});
test('production card renderer prefers Shape V2 snapshot segments over legacy item segments', () => {
  const item = {
    shape_name: 'snapshot-bend',
    diameter: null,
    total_length_mm: null,
    segments: JSON.stringify([]),
    shape_snapshot_json: JSON.stringify({
      contract: 'SHAPE_DATA_CONTRACT_V2',
      contractVersion: '2.0',
      shapeVersion: '1.0',
      shapeId: 'shape-snapshot-production-test',
      shapeType: 'custom',
      family: 'rebar',
      data: {
        diameter: 14,
        segments: [
          { lengthMm: 700, angleDeg: 90 },
          { lengthMm: 300, angleDeg: 0 },
        ],
      },
      calculated: { totalLengthMm: 1000, weightKg: 1.21 },
      machineOutput: { generic: { lengthMm: 1000 }, machineProfiles: {} },
      validation: { valid: true, messages: [] },
    }),
  };

  const svg = cards.itemShapeSvg(item);
  assert.match(svg, /data-shape-kind="generic-bar"/);
  assert.doesNotMatch(svg, /viewBox="0 0 220 60"/);
  assert.equal(cards.shapeDiameterFromItem(item), 14);
  assert.equal(cards.shapeTotalLengthMmFromItem(item), 1000);
  assert.deepEqual(cards.shapeSegmentsFromItem(item), [
    { length_mm: 700, angle_deg: 90 },
    { length_mm: 300, angle_deg: 0 },
  ]);
});
