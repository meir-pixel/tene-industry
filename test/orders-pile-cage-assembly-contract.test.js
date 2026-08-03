const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');

const ordersHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'orders.html'), 'utf8');

function assemblyRenderer() {
  const start = ordersHtml.indexOf('function orderShapeSnapshot(item) {');
  const end = ordersHtml.indexOf('function isSingleSegmentShape', start);
  assert.ok(start >= 0 && end >= 0, 'order assembly renderer exists');
  const context = { escHtml: value => String(value) };
  vm.createContext(context);
  vm.runInContext(ordersHtml.slice(start, end), context);
  return context.roundPileAssemblyHtml;
}

test('order detail renders a snapshot-derived round pile cage assembly guide', () => {
  assert.match(ordersHtml, /function orderShapeSnapshot\(item\)/);
  assert.match(ordersHtml, /function roundPileAssemblyHtml\(item\)/);
  assert.match(ordersHtml, /snapshot\?\.calculated\?\.manufacturingBreakdown/);
  assert.match(ordersHtml, /snapshot\?\.machineOutput\?\.generic\?\.manufacturingBreakdown/);
  assert.match(ordersHtml, /data-round-pile-assembly="1"/);
  assert.match(ordersHtml, /component\('straight', 'מוטות אורך ישרים'/);
  assert.match(ordersHtml, /component\('bent', 'מוטות אורך עם כיפוף עליון'/);
  assert.match(ordersHtml, /component\('spiral', 'ספירלה מאוחדת'/);
  assert.match(ordersHtml, /component\('hoop', 'טבעות חיזוק'/);
  assert.match(ordersHtml, /const pileAssembly = roundPileAssemblyHtml\(item\)/);
});

test('pile assembly placement directions remain snapshot-derived and responsive', () => {
  assert.match(ordersHtml, /מקומות האי־זוגיים: 1, 3, 5/);
  assert.match(ordersHtml, /מקומות הזוגיים, כשהכיפוף כלפי ראש הכלונס/);
  assert.match(ordersHtml, /data\.hoops\?\.firstOffsetMm/);
  assert.match(ordersHtml, /pile-component-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(ordersHtml, /@media\(max-width:640px\)\{[\s\S]*?\.pile-component-grid\{grid-template-columns:1fr;\}/);
});

test('order assembly guide shows each production component and its exact snapshot placement', () => {
  const render = assemblyRenderer();
  const snapshot = calculatePileCage({
    roundPileCage: true, pileDiameterMm: 600, pileLengthMm: 12000,
    longitudinalBars: { totalBars: 10, defaultDiameterMm: 20, defaultLengthMm: 12000, pattern: [{ type: 'straight', lengthMm: 12000 }, { type: 'L', lengthMm: 12000, bendLengthMm: 200 }] },
    spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMode: 'zones', zones: [{ name: 'A', lengthMm: 3000, pitchMm: 150 }, { name: 'B', lengthMm: 2000, noWrap: true }, { name: 'C', lengthMm: 7000, pitchMm: 200 }] },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  });
  const html = render({ shape_snapshot_json: JSON.stringify(snapshot) });

  for (const component of ['straight', 'bent', 'spiral', 'hoop']) assert.match(html, new RegExp(`data-pile-component="${component}"`));
  assert.match(html, /5 × Ø20 · L=12 מ׳/);
  assert.match(html, /5 × Ø20 · L=12.2 מ׳/);
  assert.match(html, /אורך הכיפוף 20 ס״מ/);
  assert.match(html, /כיפוף בראש/);
  assert.match(html, /L=12 מ׳/);
  assert.match(html, /L=12.2 מ׳/);
  assert.match(html, />20 ס״מ<\/text>/);
  assert.match(html, /Ø8 · קוטר 48 ס״מ · פסיעות 15 \/ 20 ס״מ/);
  assert.match(html, /A: 3m @ 15cm · 20 כריכות/);
  assert.match(html, /B: 2m ללא כריכות/);
  assert.match(html, /C: 7m @ 20cm · 35 כריכות/);
  assert.match(html, /5 × Ø18 · קוטר 42 ס״מ/);
  assert.match(html, /הטבעת הראשונה 150 ס״מ מראש הכלונס; מרווח 30 ס״מ/);
});
