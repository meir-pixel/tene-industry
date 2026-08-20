'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const warehousePage = fs.readFileSync(path.join(__dirname, '..', 'public', 'warehouse.html'), 'utf8');
const orderPrintRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orderPrintA4.js'), 'utf8');

test('the order-sheet QR opens the persisted production-card camera flow, never the old package-loading UI', () => {
  assert.match(orderPrintRoute, /warehouse\.html\?load_order=.*autostart=1/);
  assert.match(warehousePage, /startCardLoadingSession\(loadingOrderFromQr\)/);
  assert.match(warehousePage, /\/api\/loading\/card-sessions/);
  assert.doesNotMatch(warehousePage, /\/api\/loading\/sessions/);
  assert.doesNotMatch(warehousePage, /deliverySelectorCard/);
  assert.match(warehousePage, /CARD_LOADING_STORAGE_KEY/);
  assert.match(warehousePage, /localStorage\.setItem\(CARD_LOADING_STORAGE_KEY/);
  assert.match(warehousePage, /visibilitychange/);
  assert.match(warehousePage, /resumeCardCamera\(\{quiet:true\}\)/);
  assert.match(warehousePage, /BarcodeDetector/);
  assert.match(warehousePage, /wakeLock/);
  assert.match(warehousePage, /partial-departure/);
  assert.match(warehousePage, /כרטיסי עבודה/);
});

test('A4 order rows keep dimensions on the canonical shape drawing, without a duplicate dimensions column', () => {
  assert.doesNotMatch(orderPrintRoute, /<th>מידות \(ס"מ\)<\/th>/);
  assert.doesNotMatch(orderPrintRoute, /buildDimsHtml/);
  assert.doesNotMatch(orderPrintRoute, /dims-td/);
  assert.match(orderPrintRoute, /shape_svg:\s+productionCards\.itemShapeSvg\(it\)/);
  assert.match(orderPrintRoute, /colspan="7"/);
});
