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
  assert.match(route, /profitability/);
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

test('customer workbench avoids browser prompts and hands off customer and site context', () => {
  const page = read('public/customers.html');
  assert.match(page, /id="siteModalBackdrop"/);
  assert.match(page, /function openSiteModal/);
  assert.match(page, /classList\.add\('open'\)/);
  assert.match(page, /function saveCustomerSite/);
  assert.doesNotMatch(page, /prompt\(/);
  assert.match(page, /ironbend:new-order:draft:v1/);
  assert.match(page, /siteId: site\?\.id/);
  assert.match(page, /siteName: site\?\.name/);
  assert.match(page, /params\.set\('site_id'/);
  assert.match(page, /openPriceListFor/);
  assert.match(page, /\/pricing\.html\?/);
});

test('pricing screen can open in customer context from the customer card', () => {
  const pricing = read('public/pricing.html');
  assert.match(pricing, /initialCustomerId/);
  assert.match(pricing, /initialCustomerName/);
  assert.match(pricing, /Number\(book\.customer_id\) === Number\(initialCustomerId\)/);
  assert.match(pricing, /existing\.customer_id \|\| initialCustomerId/);
});

test('customer list bootstraps with initial retry instead of requiring manual refresh', () => {
  const page = read('public/customers.html');
  assert.match(page, /function bootstrapCustomerList/);
  assert.match(page, /loadList\('', \{ initial: true \}\)/);
  assert.match(page, /initialListRetryCount < 3/);
  assert.match(page, /setTimeout\(\(\) => loadList\(lastCustomerQuery, \{ initial: true \}\), delay\)/);
  assert.match(page, /DOMContentLoaded/);
});

test('pricing screen explains customer price book connection', () => {
  const pricing = read('public/pricing.html');
  assert.match(pricing, /customerContextBar/);
  assert.match(pricing, /function isInitialCustomerBook/);
  assert.match(pricing, /function prepareCustomerPriceBook/);
  assert.match(pricing, /customer_id: state\.mode === 'customer' \? \(existing\.customer_id \|\| initialCustomerId \|\| null\) : null/);
  assert.match(pricing, /state\.editing = Boolean\(initialCustomerId\)/);
});

test('pricing customer handoff can return and clones a clean customer price book', () => {
  const pricing = read('public/pricing.html');
  const customers = read('public/customers.html');
  assert.match(pricing, /id="backToCustomerBtn"/);
  assert.match(pricing, /\/customers\.html\?customer_id=/);
  assert.match(pricing, /function customerBookCode/);
  assert.match(pricing, /cloneSourceBook/);
  assert.match(pricing, /id: null/);
  assert.match(pricing, /source_type: existing\.source_type \|\| \(source\.id \? 'customer_copy' : 'manual'\)/);
  assert.match(customers, /requestedCustomerId/);
  assert.match(customers, /selectCustomer\(requestedCustomerId\)/);
});

test('customer price book handoff activates pricing consumers and customer profitability summary', () => {
  const pricing = read('public/pricing.html');
  const customers = read('public/customers.html');
  const route = read('routes/customers.js');
  assert.match(pricing, /status: existing\.status \|\| \(customerPriceBook \? 'active' : 'draft'\)/);
  assert.match(route, /today_margin_pct/);
  assert.match(route, /LEFT JOIN order_costs oc ON oc\.order_id=o\.id/);
  assert.match(customers, /רווח היום/);
  assert.match(customers, /מרווח היום/);
});

test('customer card exposes unbilled delivery-to-billing queue without owning invoice creation', () => {
  const route = read('routes/customers.js');
  const page = read('public/customers.html');
  assert.match(route, /unbilledOrders/);
  assert.match(route, /LEFT JOIN order_billing ob ON ob\.order_id=o\.id/);
  assert.match(route, /ob\.order_id IS NULL/);
  assert.doesNotMatch(route, /INSERT\s+INTO\s+invoices/i);
  assert.match(page, /function renderCustomerBillingQueue/);
  assert.match(page, /kind=delivery-certificate/);
  assert.match(page, /function recordCustomerBilling/);
  assert.match(page, /\/api\/orders\/' \+ orderId \+ '\/costs\/billing/);
});

test('customer card keeps orders above billing sites and secondary details', () => {
  const page = read('public/customers.html');
  assert.match(page, /function renderCustomerOrders/);
  const workbench = page.indexOf('renderCustomerWorkbench(c)');
  const orders = page.indexOf('renderCustomerOrders(c, orders)');
  const billing = page.indexOf('renderCustomerBillingQueue(c)');
  const sites = page.indexOf('renderCustomerSitesSummary(c)');
  const info = page.indexOf('// ── Info grid ──');
  assert.ok(workbench > -1 && orders > workbench);
  assert.ok(billing > orders);
  assert.ok(sites > billing);
  assert.ok(info > sites);
});
