'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('each order document has a neighbouring PDF send action with email and WhatsApp handoff', () => {
  const orders = read('public/orders.html');
  const printLoader = read('public/order-print.html');
  const route = read('routes/orders.js');

  for (const documentKey of ['print-cards', 'print-a4', 'print-a4-th', 'delivery-certificate']) {
    assert.match(orders, new RegExp(`openSendFile\\(event,\\$\\{o\\.id\\},'${documentKey}'\\)`));
  }
  assert.match(orders, /id="sendFileOverlay"/);
  assert.match(orders, /openPdfForSending\(\)/);
  assert.match(orders, /openWhatsAppForSending\(\)/);
  assert.match(orders, /openEmailForSending\(\)/);
  assert.match(orders, /שמירה כ‑PDF/);
  assert.match(orders, /autoPrint: true/);
  assert.match(printLoader, /const autoPrint = params\.get\('auto_print'\) === '1';/);
  assert.match(printLoader, /window\.setTimeout\(function\(\)\{window\.print\(\);\},350\)/);
  assert.match(route, /c\.email as customer_email/);
});
