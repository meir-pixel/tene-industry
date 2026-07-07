const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('customer detail exposes modular workbench read model without owning orders or invoices', () => {
  const route = read('routes/customers.js');
  assert.match(route, /c\.workbench\s*=\s*\{/);
  assert.match(route, /c\.sites_summary\s*=\s*sites/);
  assert.match(route, /active_price_book/);
  assert.doesNotMatch(route, /INSERT\s+INTO\s+orders/i);
  assert.doesNotMatch(route, /INSERT\s+INTO\s+invoices/i);
});

test('customer screen links order creation through order screen with customer context', () => {
  const page = read('public/customers.html');
  assert.match(page, /function renderCustomerWorkbench/);
  assert.match(page, /function renderCustomerSitesSummary/);
  assert.match(page, /function quickCreateSite/);
  assert.match(page, /new URLSearchParams\(\{/);
  assert.match(page, /customer_id: String\(id\)/);
  assert.match(page, /customer_name: c\.name/);
  assert.match(page, /\/api\/customers\/' \+ customerId \+ '\/portal-sites/);
});
