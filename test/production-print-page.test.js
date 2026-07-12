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
  assert.match(html, /shapeSvgForCard\(item, segs\)/);
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
          { lengthMm: 700, bendAfterDeg: 90 },
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


test('production cards print visible 90 degree bend labels for U shapes', () => {
  const item = {
    id: 801,
    shape_name: 'U 90',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([
      { length_mm: 200, angle_deg: 90 },
      { length_mm: 600, angle_deg: 90 },
      { length_mm: 200, angle_deg: null },
    ]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-ANGLE-90', customer_name: 'Angle Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.equal((html.match(/90\u00b0/g) || []).length >= 2, true);
  assert.match(html, /data-angle-label="1"/);
  assert.match(html, /class="dim-ang">90\u00b0<\/span>/);
});

test('production cards print 45 and 135 degree bend labels', () => {
  const item = {
    id: 802,
    shape_name: 'angled bend',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([
      { length_mm: 200, angle_deg: 45 },
      { length_mm: 600, angle_deg: 135 },
      { length_mm: 200, angle_deg: null },
    ]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-ANGLE-45', customer_name: 'Angle Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.match(html, /45\u00b0/);
  assert.match(html, /135\u00b0/);
  assert.doesNotMatch(html, /180\u00b0/);
});

test('production cards do not print bogus bend angles for straight bars', () => {
  const item = {
    id: 803,
    shape_name: 'straight bar',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([{ length_mm: 1000, angle_deg: null }]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-STRAIGHT', customer_name: 'Straight Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.match(html, /100/);
  assert.doesNotMatch(html, />0\u00b0</);
  assert.doesNotMatch(html, /180\u00b0/);
  assert.doesNotMatch(html, /class="dim-ang"/);
});

test('production cards prefer Shape V2 snapshot angles over legacy segments', () => {
  const item = {
    id: 804,
    shape_name: 'snapshot wins',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    segments: JSON.stringify([
      { length_mm: 300, angle_deg: 0 },
      { length_mm: 300, angle_deg: 0 },
      { length_mm: 300, angle_deg: null },
    ]),
    shape_snapshot_json: JSON.stringify({
      contractVersion: '2.0',
      shapeVersion: '1.0',
      family: 'bars',
      data: {
        diameter: 12,
        sides: [200, 600, 200],
        angles: [90, 90],
      },
      machineOutput: { generic: { segments: [
        { lengthMm: 200, bendAfterDeg: 90 },
        { lengthMm: 600, bendAfterDeg: 90 },
        { lengthMm: 200, bendAfterDeg: null },
      ] } },
      calculated: { totalLengthMm: 1000 },
      validation: { valid: true },
    }),
  };
  assert.deepEqual(cards.shapeSegmentsFromItem(item), [
    { length_mm: 200, angle_deg: 90 },
    { length_mm: 600, angle_deg: 90 },
    { length_mm: 200, angle_deg: null },
  ]);
  const html = cards.itemCard(item, { order_num: 'HZ-SNAPSHOT', customer_name: 'Snapshot Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.equal((html.match(/90\u00b0/g) || []).length >= 2, true);
  assert.doesNotMatch(html, />0\u00b0</);
});

test('production cards suppress legacy zero-degree bend labels', () => {
  const item = {
    id: 806,
    shape_name: 'legacy zero bend',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1300,
    total_weight: 1.15,
    segments: JSON.stringify([
      { length_mm: 1000, angle_deg: 0 },
      { length_mm: 300, angle_deg: null },
    ]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-ZERO', customer_name: 'Zero Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.doesNotMatch(html, />0\u00b0</);
  assert.doesNotMatch(html, /class="dim-ang">0/);
});
test('production cards rebuild old shape_svg when valid segments have bend labels', () => {
  const item = {
    id: 805,
    shape_name: 'old svg',
    diameter: 12,
    quantity: 1,
    total_length_mm: 1000,
    total_weight: 0.89,
    shape_svg: '<svg data-old="1"><text>0�</text><line x1="0" y1="0" x2="10" y2="0"/></svg>',
    segments: JSON.stringify([
      { length_mm: 200, angle_deg: 90 },
      { length_mm: 600, angle_deg: 90 },
      { length_mm: 200, angle_deg: null },
    ]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-OLD-SVG', customer_name: 'Old Svg Customer' }, '10-07-2026', industry.REBAR_WEIGHTS || {});
  assert.match(html, /90\u00b0/);
  assert.doesNotMatch(html, /data-old="1"/);
  assert.doesNotMatch(html, />0\u00b0</);

  const printHtml = printPage.renderPrintCardsPage({
    order: { id: 805, order_num: 'HZ-OLD-SVG', customer_name: 'Old Svg Customer', status: 'approved' },
    pallets: [{ pallet_num: 1, items: [item] }],
    allItems: [{ ...item, _palletNum: 1, card_weights: [] }],
    printDate: '10-07-2026',
    delivDate: '11-07-2026',
    cards,
    industry,
    tryParseJSON,
  });
  assert.match(printHtml, /90\u00b0/);
  assert.doesNotMatch(printHtml, />0\u00b0</);
  assert.match(printHtml, /shapeSvgForCard/);
});


function fixtureSpiralItem(overrides = {}) {
  return {
    id: 152,
    shape_name: 'ספיראלה',
    diameter: 8,
    quantity: 13,
    total_length_mm: 39270,
    total_weight: 201.65,
    shape_snapshot_json: JSON.stringify({
      contractVersion: 'SHAPE_DATA_CONTRACT_V2',
      family: 'spirals',
      shapeType: 'spiral',
      validation: { valid: true },
      data: {
        rebarDiameter: 8,
        spiralDiameterMm: 250,
        turns: 50,
      },
      calculated: {
        totalLengthMm: 39270,
      },
    }),
    segments: JSON.stringify([{ length_mm: 39270, angle_deg: null }]),
    shape_svg: '<svg><line data-old-straight="1"></line></svg>',
    ...overrides,
  };
}

test('production cards render spiral item as top-view preview instead of straight or side wave fallback', () => {
  const item = fixtureSpiralItem();
  const html = cards.itemCard(item, { order_num: 'HZ-2026-025', customer_name: 'Spiral Customer' }, '12-07-2026', industry.REBAR_WEIGHTS || {});

  assert.match(html, /data-shape-kind="spiral"/);
  assert.match(html, /pc-spiral-top-svg/);
  assert.match(html, /data-spiral-diameter-mm="250"/);
  assert.match(html, /data-spiral-turns="50"/);
  assert.match(html, /250/);
  assert.match(html, /50/);
  assert.match(html, /(?:&#216;|Ø)8|data-rebar-diameter-mm="8"/);
  assert.match(html, /3927/);
  assert.doesNotMatch(html, /39270\s*ס/);
  assert.doesNotMatch(html, /pc-spiral-svg/);
  assert.doesNotMatch(html, /arr-s|arr-sl/);
  assert.doesNotMatch(html, /data-old-straight/);
  assert.doesNotMatch(html, /data-shape-kind="straight-bar"/);
});

test('production print page serializes fresh spiral SVG instead of stale straight shape_svg', () => {
  const item = fixtureSpiralItem();
  const html = printPage.renderPrintCardsPage({
    order: { id: 152, order_num: 'HZ-2026-025', customer_name: 'Spiral Customer', status: 'approved' },
    pallets: [{ pallet_num: 1, items: [item] }],
    allItems: [{ ...item, _palletNum: 1, card_weights: [] }],
    printDate: '12-07-2026',
    delivDate: '13-07-2026',
    cards,
    industry,
    tryParseJSON,
  });

  assert.match(html, /data-shape-kind=\"spiral\"/);
  assert.match(html, /pc-spiral-top-svg/);
  assert.match(html, /data-spiral-diameter-mm=\"250\"/);
  assert.match(html, /data-spiral-turns=\"50\"/);
  assert.match(html, /shape_dims_html/);
  assert.match(html, /3927/);
  assert.doesNotMatch(html, /39270\s*ס/);
  assert.doesNotMatch(html, /pc-spiral-svg/);
  assert.doesNotMatch(html, /data-old-straight/);
});

test('production cards keep incomplete spiral as spiral instead of straight bar', () => {
  const item = fixtureSpiralItem({
    shape_snapshot_json: JSON.stringify({
      contractVersion: 'SHAPE_DATA_CONTRACT_V2',
      family: 'spirals',
      shapeType: 'spiral',
      data: { rebarDiameter: 8 },
      validation: { valid: false },
    }),
    spiral_diameter_mm: null,
    spiral_turns: null,
  });
  const html = cards.itemCard(item, { order_num: 'HZ-SPIRAL-MISSING', customer_name: 'Spiral Customer' }, '12-07-2026', industry.REBAR_WEIGHTS || {});

  assert.match(html, /data-shape-kind="spiral"/);
  assert.match(html, /data-spiral-incomplete="1"/);
  assert.doesNotMatch(html, /data-shape-kind="straight-bar"/);
});

test('regular straight bar still renders with straight preview', () => {
  const item = {
    id: 153,
    shape_name: 'straight bar',
    diameter: 8,
    quantity: 13,
    total_length_mm: 39270,
    total_weight: 201.65,
    segments: JSON.stringify([{ length_mm: 39270, angle_deg: null }]),
  };
  const html = cards.itemCard(item, { order_num: 'HZ-STRAIGHT-CHECK', customer_name: 'Straight Customer' }, '12-07-2026', industry.REBAR_WEIGHTS || {});

  assert.match(html, /data-shape-kind="straight-bar"/);
  assert.doesNotMatch(html, /pc-spiral-top-svg/);
});
