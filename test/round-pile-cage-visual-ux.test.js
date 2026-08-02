const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const editorJs = fs.readFileSync(path.join(root, 'public', 'new-order-editor.js'), 'utf8');
const editorCss = fs.readFileSync(path.join(root, 'public', 'new-order-editor.css'), 'utf8');
const ordersHtml = fs.readFileSync(path.join(root, 'public', 'orders.html'), 'utf8');
const productionCards = require('../services/productionCards');

const pileItem = {
  diameter: 20,
  shape_snapshot_json: JSON.stringify({
    contractVersion: '2.0',
    shapeType: 'round_pile_cage',
    family: 'piles',
    data: {
      roundPileCage: true,
      pileDiameterMm: 600,
      pileLengthMm: 12000,
      longitudinalBars: { count: 10, diameterMm: 20 },
      spiral: { barDiameterMm: 8, pitchMm: 150 },
      hoops: { quantity: 5, diameterMm: 18 },
    },
  }),
};

test('round pile cage identification produces a dedicated production SVG, never a generic bar', () => {
  assert.equal(productionCards.isRoundPileCageItem(pileItem), true);
  const svg = productionCards.shapeSvgForProductionCard(pileItem, [{ length_mm: 12000, angle_deg: 0 }]);
  assert.match(svg, /aria-label="PILE CAGE"/);
  assert.match(svg, /L 12\.00m/);
  assert.match(svg, /10 × Ø20/);
  assert.match(svg, /Ø8 @ 15cm/);
  assert.match(svg, /5 × Ø18/);
  assert.match(svg, /<circle/);
  assert.match(svg, /<path/);
  assert.equal(productionCards.itemHumanTitle(pileItem), 'PILE CAGE');
});

test('order row and order detail use the pile-cage visual language and component cards', () => {
  assert.match(indexHtml, /function isRoundPileCageItem\(item = \{\}\)/);
  assert.match(indexHtml, /function roundPileCagePreviewSvg\(item = \{\}\)/);
  assert.match(indexHtml, /if \(isRoundPileCageItem\(item\)\) return roundPileCagePreviewSvg/);
  assert.match(editorJs, /data-shape-kind="round_pile_cage"/);
  assert.match(editorJs, /line-pile-cage-tag">PILE CAGE/);
  assert.match(editorCss, /\.line-round-pile-cage/);
  assert.match(ordersHtml, /function roundPileCageDetailSvg\(item\)/);
  assert.match(ordersHtml, /pile-cage-detail-visual/);
  assert.match(ordersHtml, /pile-cage-badge">PILE CAGE/);
  assert.match(ordersHtml, /כלוב זיון לכלונס עגול/);
  for (const component of ['straight', 'bent', 'spiral', 'hoop']) assert.match(ordersHtml, new RegExp(`component\\('${component}'`));
});

test('production print keeps a distinct master cage card and component cards', () => {
  const printPage = fs.readFileSync(path.join(root, 'services', 'productionCardPrintPage.js'), 'utf8');
  assert.match(printPage, /function pileMasterShapeSvg\(snapshot = \{\}\)/);
  assert.match(printPage, /כלוב זיון לכלונס עגול/);
  assert.match(printPage, /item\.pile_card_type === 'pile_master' && item\.shape_svg/);
  assert.match(printPage, /pile-cage-master-card/);
  assert.match(printPage, /pile-cage-component-card/);
});
