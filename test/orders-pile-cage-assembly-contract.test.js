const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ordersHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'orders.html'), 'utf8');

function assemblyRenderer() {
  const block = ordersHtml.match(/function orderShapeSnapshot\(item\) \{[\s\S]*?\n\}\n\nfunction isSingleSegmentShape/);
  assert.ok(block, 'order assembly renderer exists');
  const context = { escHtml: value => String(value) };
  vm.createContext(context);
  vm.runInContext(block[0].replace(/\nfunction isSingleSegmentShape$/, ''), context);
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
  assert.match(ordersHtml, /component\('spiral', 'ספירלה רציפה'/);
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
  const html = render({ shape_snapshot_json: JSON.stringify({
    shapeType: 'round_pile_cage',
    data: {
      pileLength: 12000,
      bars: [
        { type: 'straight', diameterMm: 20, lengthMm: 12000 },
        { type: 'L', diameterMm: 20, lengthMm: 12200, bendLengthMm: 200 },
      ],
      spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMm: 150, turns: 80 },
      hoops: { barDiameterMm: 18, outerDiameterMm: 420, quantity: 5, firstOffsetMm: 1500, spacingMm: 300 },
    },
    calculated: { manufacturingBreakdown: [
      { componentType: 'longitudinal_straight_bar', quantity: 5, diameterMm: 20, lengthMm: 12000, totalLengthMm: 60000 },
      { componentType: 'longitudinal_l_bar', quantity: 5, diameterMm: 20, lengthMm: 12200, bendLengthMm: 200, totalLengthMm: 61000 },
      { componentType: 'spiral_zone', quantity: 1, diameterMm: 8, outerDiameterMm: 480, pitchMm: 150, turns: 80 },
      { componentType: 'hoop_ring', quantity: 5, diameterMm: 18, hoopOuterDiameterMm: 420, spacingMm: 300 },
    ] },
  }) });

  for (const component of ['straight', 'bent', 'spiral', 'hoop']) assert.match(html, new RegExp(`data-pile-component="${component}"`));
  assert.match(html, /5 × Ø20 · L=12000 מ״מ/);
  assert.match(html, /5 × Ø20 · L=12200 מ״מ/);
  assert.match(html, /אורך הכיפוף 200 מ״מ/);
  assert.match(html, /Ø8 · קוטר 480 · פסיעה 150 מ״מ/);
  assert.match(html, /5 × Ø18 · קוטר 420 מ״מ/);
  assert.match(html, /הטבעת הראשונה 1500 מ״מ מראש הכלונס; מרווח 300 מ״מ/);
});
