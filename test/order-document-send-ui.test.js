'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Saving and sending belong to the open document rather than to a dialog in
// front of it: the operator has to see the sheet before deciding what to do
// with it, and a dialog that replaces the sheet hides the very thing being
// chosen.
test('the order modal opens each document directly, with no dialog in the way', () => {
  const orders = read('public/orders.html');

  for (const kind of ['print-cards', 'print-a4', 'delivery-certificate']) {
    assert.match(
      orders,
      new RegExp('href="/order-print\\.html\\?id=\\$\\{o\\.id\\}&kind=' + kind + '" target="_blank"'),
      `expected ${kind} to open straight from the order modal`
    );
  }

  assert.doesNotMatch(orders, /class="send-file-btn"/, 'sending moved into the document itself');
  assert.doesNotMatch(orders, /openProductionCardPrintDialog\(\$\{o\.id\}\)/, 'cards open directly, not through a picker dialog');
  assert.doesNotMatch(orders, /openA4PrintDialog\(\$\{o\.id\}\)/, 'the A4 sheet opens directly');
});

test('every printable document carries its own print, download and send actions', () => {
  for (const file of ['routes/orderPrintA4.js', 'routes/orderDeliveryCertificate.js', 'services/productionCardPrintPage.js']) {
    const source = read(file);
    assert.match(source, /window\.print\(\)/, `${file} should still print`);
    assert.match(source, /IronBendDocExport\.download\(/, `${file} should offer a PDF download`);
    assert.match(source, /IronBendDocExport\.send\(/, `${file} should offer sending the file`);
    assert.match(source, /\/vendor\/jspdf\.umd\.min\.js/, `${file} should load the vendored PDF writer`);
    assert.match(source, /\/doc-export\.js/, `${file} should load the shared export helper`);
  }
});

test('the PDF libraries are served by this app rather than a CDN', () => {
  assert.ok(fs.existsSync(path.join(root, 'public', 'vendor', 'jspdf.umd.min.js')));
  assert.ok(fs.existsSync(path.join(root, 'public', 'vendor', 'html2canvas.min.js')));
  assert.doesNotMatch(read('public/doc-export.js'), /https?:\/\/(cdn|unpkg|jsdelivr)/i, 'the factory has to keep working with the line down');
});

// Picking happens on the cards themselves, the way photos are picked.
test('production cards are picked on the sheet, and unpicked ones leave the printout', () => {
  const page = read('services/productionCardPrintPage.js');
  const cards = read('services/productionCards.js');

  assert.match(cards, /class="pc-pick"/, 'every card needs its own pick control');
  assert.match(cards, /data-picked="1"/, 'cards start picked');

  assert.match(page, /function togglePickedCard\(/);
  assert.match(page, /function pickAllCards\(/);
  assert.match(page, /function refreshPickedCards\(/);
  assert.match(page, /\.prod-card\[data-picked="0"\]\{display:none!important;\}/, 'unpicked cards must leave the flow so the rest close ranks');
  assert.match(page, /\.pc-pick\{display:none!important;\}/, 'the pick control is a screen control, never printed');
  assert.match(page, /id="pcPickCount"/, 'the operator should see how many are picked');
});
