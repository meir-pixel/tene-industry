const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ordersHtml = fs.readFileSync(path.join(root, 'public', 'orders.html'), 'utf8');
const productionCards = require('../services/productionCards');
const printPage = require('../services/productionCardPrintPage');
const industry = require('../constants');

function tryParseJSON(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function pileSnapshot(overrides = {}) {
  return {
    contractVersion: '2.0',
    shapeType: 'round_pile_cage',
    family: 'piles',
    data: {
      pileDiameterMm: 600,
      pileLengthMm: 12000,
      longitudinalBars: { count: 10, diameterMm: 20 },
      spiral: { barDiameterMm: 8, pitchMm: 150 },
      hoops: { quantity: 5, diameterMm: 18 },
      ...overrides,
    },
    manufacturingBreakdown: [
      { componentType: 'longitudinal_straight_bar', diameterMm: 20, quantity: 5, totalLengthMm: 12000 },
      { componentType: 'spiral_zone', diameterMm: 8, quantity: 1, totalLengthMm: 12000, pitchMm: 150 },
      { componentType: 'hoop_ring', diameterMm: 18, quantity: 5, totalLengthMm: 6600 },
    ],
  };
}

function pileItem(snapshot = pileSnapshot(), id = 501) {
  return {
    id,
    diameter: 20,
    quantity: 1,
    total_length_mm: 12000,
    total_weight: 100,
    pallet_num: 1,
    material_grade: 'B500B',
    card_weights: [],
    shape_snapshot_json: JSON.stringify(snapshot),
  };
}

function dynamicPrintCards(items) {
  const html = printPage.renderPrintCardsPage({
    order: { id: 77, order_num: 'PC-77', customer_name: 'Test', status: 'approved' },
    pallets: [{ id: 1, pallet_num: 1 }],
    allItems: items,
    printDate: '01-08-2026',
    delivDate: '02-08-2026',
    cards: productionCards,
    industry,
    tryParseJSON,
  });
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(script => script.includes('Server data'));
  const grids = [];
  const cardsGrid = {
    set innerHTML(value) { this._html = value; grids.length = 0; },
    get innerHTML() { return this._html || ''; },
    appendChild(page) { this.pages = (this.pages || []).concat(page); },
    querySelectorAll(selector) { return selector === '.cards-grid' ? grids : []; },
  };
  const document = {
    getElementById(id) { return id === 'cardsGrid' ? cardsGrid : null; },
    createElement() {
      return {
        children: [],
        appendChild(child) { this.children.push(child); if (child && child.isGrid) grids.push(child); },
        set innerHTML(value) { this.html = value; this.firstElementChild = { html: value }; },
        get innerHTML() { return this.html || ''; },
      };
    },
  };
  const originalCreateElement = document.createElement;
  document.createElement = function(tag) {
    const element = originalCreateElement(tag);
    if (tag === 'div') {
      const append = element.appendChild;
      element.appendChild = function(child) { append.call(this, child); if (this.children.length === 1 && child && !child.html) this.isGrid = false; };
    }
    return element;
  };
  const context = { document, console: { error() {} }, setTimeout() {}, window: {}, fetch() {} };
  const executable = inline.replace(/\/\/ Init: render fixed production cards and QR codes\.[\s\S]*$/, '');
  vm.runInNewContext(executable, context);
  // Mark the inner grid when the print code creates page → grid.
  const originalAppend = cardsGrid.appendChild.bind(cardsGrid);
  cardsGrid.appendChild = function(page) {
    const grid = page.children && page.children[0];
    if (grid) { grid.isGrid = true; grids.push(grid); }
    originalAppend(page);
  };
  context.generateCards();
  return grids.flatMap(grid => grid.children.map(card => card.html));
}

test('exact snapshot identity alone identifies a round pile cage', () => {
  assert.equal(productionCards.isRoundPileCageItem(pileItem()), true);
  for (const snapshot of [
    { family: 'piles', shapeType: 'other_pile_shape', data: {} },
    { family: 'piles', data: { label: 'pile cage כלונס' } },
    { family: 'rebar', shapeType: 'round_pile_cage', data: {} },
  ]) {
    assert.equal(productionCards.isRoundPileCageItem(pileItem(snapshot)), false);
  }
});

test('complete cage renders a dedicated SVG with cage, bars and spiral', () => {
  const svg = productionCards.shapeSvgForProductionCard(pileItem(), [{ length_mm: 12000, angle_deg: 0 }]);
  assert.match(svg, /aria-label="PILE CAGE"/);
  assert.match(svg, /L 12\.00m/);
  assert.match(svg, /10 × Ø20/);
  assert.match(svg, /Ø8 @ 15cm/);
  assert.match(svg, /5 × Ø18/);
  assert.match(svg, /<circle/);
  assert.match(svg, /<path/);
  assert.equal(productionCards.itemHumanTitle(pileItem()), 'PILE CAGE');
});

test('partial cage snapshot uses unavailable values without fabricating reinforcement', () => {
  const item = pileItem(pileSnapshot({ longitudinalBars: {}, spiral: {}, hoops: {} }));
  const svg = productionCards.shapeSvgForProductionCard(item, []);
  assert.match(svg, /aria-label="PILE CAGE"/);
  assert.doesNotMatch(svg, /10 × Ø20|Ø8 @ 15cm|5 × Ø18/);
  assert.match(svg, /—/);
  assert.equal((svg.match(/stroke="#2563eb"/g) || []).length, 0);
  assert.equal((svg.match(/<circle/g) || []).length, 1);
});

test('order surfaces require exact identity and retain the dedicated visual path', () => {
  assert.match(indexHtml, /snapshot\?\.family === 'piles' && snapshot\?\.shapeType === 'round_pile_cage'/);
  assert.match(ordersHtml, /snapshot\.family === 'piles' && snapshot\.shapeType === 'round_pile_cage'/);
  assert.match(indexHtml, /if \(isRoundPileCageItem\(item\)\) return roundPileCagePreviewSvg/);
  assert.match(ordersHtml, /pile-cage-detail-visual/);
  assert.match(ordersHtml, /pile-cage-badge">PILE CAGE/);
});

test('dynamic print reconstruction retains dedicated master and component visuals', () => {
  const cards = dynamicPrintCards([pileItem()]);
  assert.equal(cards.length, 4);
  const master = cards.find(card => card.includes('pile-cage-master-card'));
  assert.match(master, /aria-label="PILE CAGE"/);
  assert.doesNotMatch(master, /data-shape-kind="generic-bar"/);
  assert.match(cards.find(card => card.includes('longitudinal_straight_bar')), /data-shape-kind="pile-longitudinal-component"/);
  assert.match(cards.find(card => card.includes('spiral_zone')), /data-shape-kind="pile-spiral-component"/);
  assert.match(cards.find(card => card.includes('hoop_ring')), /data-shape-kind="pile-hoop-component"/);
  for (const component of cards.filter(card => card.includes('pile-cage-component-card'))) assert.doesNotMatch(component, /data-shape-kind="generic-bar"/);
});

test('dynamic print keeps multiple cages independent and does not classify another pile shape', () => {
  const cards = dynamicPrintCards([pileItem(pileSnapshot(), 501), pileItem(pileSnapshot(), 502)]);
  assert.equal(cards.filter(card => card.includes('pile-cage-master-card')).length, 2);
  assert.equal(new Set(cards.filter(card => card.includes('PILE CAGE'))).size, 2);
  const otherPile = pileItem({ family: 'piles', shapeType: 'square_pile_cage', data: {} }, 503);
  const otherCards = dynamicPrintCards([otherPile]);
  assert.equal(otherCards.length, 1);
  assert.doesNotMatch(otherCards[0], /כלוב זיון לכלונס עגול|PILE CAGE|pile-cage-master-card/);
});

function componentPrintCard(component) {
  const snapshot = pileSnapshot();
  snapshot.manufacturingBreakdown = [component];
  return dynamicPrintCards([pileItem(snapshot)]).find(card => card.includes(`data-component-type="${component.componentType}"`));
}

test('dynamic spiral component renders geometry only from valid length and pitch', () => {
  const incompleteCases = [
    { componentType: 'spiral_zone', totalLengthMm: 12000 },
    { componentType: 'spiral_zone', pitchMm: 150 },
    { componentType: 'spiral_zone' },
    { componentType: 'spiral_zone', totalLengthMm: 12000, pitchMm: 0 },
    { componentType: 'spiral_zone', totalLengthMm: 0, pitchMm: 150 },
  ];
  for (const component of incompleteCases) {
    const card = componentPrintCard(component);
    assert.match(card, /data-shape-kind="pile-spiral-component"/);
    assert.match(card, />—</);
    assert.doesNotMatch(card, /pitch 300 mm|<path/);
    assert.doesNotMatch(card, /data-shape-kind="generic-bar"/);
  }
  const complete = componentPrintCard({ componentType: 'spiral_zone', totalLengthMm: 12000, pitchMm: 150 });
  assert.match(complete, /data-shape-kind="pile-spiral-component"/);
  assert.match(complete, /pitch 150 mm/);
  assert.match(complete, /<path/);
});

test('dynamic hoop component never invents a quantity', () => {
  for (const component of [
    { componentType: 'hoop_ring' },
    { componentType: 'hoop_ring', source: {} },
    { componentType: 'hoop_ring', quantity: null },
  ]) {
    const card = componentPrintCard(component);
    assert.match(card, /data-shape-kind="pile-hoop-component"/);
    assert.match(card, /PCS —/);
    assert.doesNotMatch(card, /PCS 1/);
    assert.doesNotMatch(card, /data-shape-kind="generic-bar"/);
  }
  const complete = componentPrintCard({ componentType: 'hoop_ring', quantity: 5, hoopDiameterMm: 420 });
  assert.match(complete, /PCS 5 · D 420 mm/);
});
