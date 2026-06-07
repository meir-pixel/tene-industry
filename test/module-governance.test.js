const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const requiredModules = [
  'Platform Core',
  'Orders',
  'Production',
  'Inventory And Procurement',
  'Fleet Management',
  'Finance',
  'Quality And Maintenance',
  'Customer And External Portals',
  'Dashboard And Reports',
  'Vendor Control And Remote Support',
];

test('module inventory defines every sellable/control module', () => {
  const inventory = read('docs/module-inventory.md');

  for (const moduleName of requiredModules) {
    assert.match(inventory, new RegExp(`## ${moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }

  assert.match(inventory, /Every future agent task should name one\s+module and one bounded file set/i);
  assert.match(inventory, /Remote vendor access to customer data must be off by default/);
  assert.match(inventory, /customer-approved, time-limited, read-only by default/);
  assert.match(inventory, /JWT auth is active for guarded routes/);
  assert.match(inventory, /AUTH_BYPASS[\s\S]*production and staging environments/);
  assert.doesNotMatch(inventory, /Auth enforcement is disabled/);
  assert.doesNotMatch(inventory, /spoofable role headers while enforcement is off/);
});

test('module inventory assigns shared core and extracted services to owners', () => {
  const inventory = read('docs/module-inventory.md');

  for (const ownedFile of [
    'auth-core.js',
    'permissions.js',
    'constants.js',
    'status-contracts.js',
    'public/status-contracts-client.js',
    'services/orderNumbers.js',
    'services/productionCards.js',
    'services/inventory.js',
    'services/fleet.js',
    'services/intakeWorkflow.js',
  ]) {
    assert.match(inventory, new RegExp(ownedFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(inventory, /Next Agent Assignments/);
  assert.doesNotMatch(inventory, /Security Agent: protect user\/admin\/settings\/database endpoints/);
});

test('shared constants are extracted from the server monolith', () => {
  const constants = read('constants.js');
  const steelWeights = read('modules/steel-rebar/weights.js');
  const server = read('server.js');

  // Steel-specific logic now lives in modules/steel-rebar/
  assert.match(steelWeights, /const REBAR_WEIGHTS = Object\.freeze/);
  assert.match(steelWeights, /const REBAR_KG_PER_M = Object\.freeze/);
  assert.match(steelWeights, /function rebarKgPerMeter/);

  // Universal platform constants stay in constants.js
  assert.match(constants, /const MACHINE_STATES = Object\.freeze/);
  assert.match(constants, /const STATE_TRANSITIONS = Object\.freeze/);
  assert.match(constants, /'ריצה'/);
  assert.doesNotMatch(constants, /\\u05/);

  // constants.js re-exports steel for backward compat
  assert.match(constants, /require\('\.\/modules\/steel-rebar'\)/);

  // server.js must not define these inline
  assert.match(server, /require\('\.\/constants'\)/);
  assert.match(server, /rebarKgPerMeter/);
  assert.doesNotMatch(server, /const REBAR_WEIGHTS = \{/);
  assert.doesNotMatch(server, /const REBAR_KG_PER_M = Object\.assign/);
  assert.doesNotMatch(server, /const MACHINE_STATES = \[/);
  assert.doesNotMatch(server, /const STATE_TRANSITIONS = \{/);
  assert.doesNotMatch(server, /const VALID_ORDER_TRANSITIONS = \{/);
  assert.doesNotMatch(server, /REBAR_WEIGHTS\[[^\]]+\]\s*\?\?/);
  assert.doesNotMatch(server, /WEIGHTS\[/);
  assert.doesNotMatch(server, /REBAR_KG_PER_M\[/);
  assert.doesNotMatch(server, /diameter\s*\*\s*diameter\s*\*\s*0\.00617/);
});

test('registries reserve vendor control APIs before implementation', () => {
  const apiRegistry = read('docs/api-registry.md');
  const screenRegistry = read('docs/screen-registry.md');
  const permissionRegistry = read('docs/permission-registry.md');

  assert.match(apiRegistry, /## Vendor Control And Remote Support/);
  assert.match(apiRegistry, /\/api\/vendor\/sites\*/);
  assert.match(apiRegistry, /\/api\/vendor\/sites\/:id\/support-session/);
  assert.match(apiRegistry, /customer-approved \+ vendor-admin/);
  assert.match(screenRegistry, /admin\.html/);
  assert.match(permissionRegistry, /admin/);
});

test('change protocol blocks unowned work and duplicate module edits', () => {
  const protocol = read('docs/change-control-protocol.md');
  const template = read('docs/agent-task-template.md');

  assert.match(protocol, /No change is ready unless it has:/);
  assert.match(protocol, /One module owner/);
  assert.match(protocol, /One bounded file scope/);
  assert.match(protocol, /Every task must name exactly one primary owner/);
  assert.match(protocol, /No Duplicate Agent Work/);
  assert.match(template, /Module owner:/);
  assert.match(template, /Allowed write scope:/);
  assert.match(template, /Do not edit:/);
});

test('admin module board exposes maturity, risk, scope and vendor control', () => {
  const admin = read('public/admin.html');

  assert.match(admin, /בקרת מודולים/);
  assert.match(admin, /moduleStatusGrid/);
  assert.match(admin, /module-card/);
  assert.match(admin, /MODULE_VENDOR_CONTROL/);
  assert.match(admin, /Vendor Control \/ בקרה מרחוק/);
  assert.match(admin, /אין גישה חופשית לנתוני לקוח/);
  assert.match(admin, /status:'frozen'/);
  assert.match(admin, /risk:'high'/);
  assert.match(admin, /screens:\[/);
  assert.match(admin, /apis:\[/);
  assert.match(admin, /next:/);
});

test('production cards are rendered through a module service', () => {
  const service = read('services/productionCards.js');
  const route = read('routes/productionCards.js');
  const server = read('server.js');

  assert.match(service, /function masterCard/);
  assert.match(service, /function itemCard/);
  assert.match(service, /module\.exports/);
  assert.match(server, /require\('\.\/services\/productionCards'\)/);
  assert.match(route, /cards\.masterCard/);
  assert.match(route, /cards\.itemCard/);
  assert.doesNotMatch(server, /productionCards\.masterCard/);
  assert.doesNotMatch(server, /productionCards\.itemCard/);
});

test('order numbers are allocated through an orders module service', () => {
  const service = read('services/orderNumbers.js');
  const server = read('server.js');

  assert.match(service, /function ensureOrderSequence/);
  assert.match(service, /function createOrderNumberAllocator/);
  assert.match(service, /UPDATE order_sequences\s+SET next_value=next_value\+1/);
  assert.match(server, /require\('\.\/services\/orderNumbers'\)/);
  assert.match(server, /const generateOrderNum = createOrderNumberAllocator\(db\)/);
  assert.doesNotMatch(server, /const nextOrderNumTx = db\.transaction/);
});

test('order creation logic lives in an orders module service', () => {
  const service = read('services/orders.js');
  const server = read('server.js');

  assert.match(service, /function createOrderFactory/);
  assert.match(service, /function createOrderFromPayload/);
  assert.match(service, /function validateShapeGeometry/);
  // normalizeFactorySegments/ShapeName הועברו ל-modules/steel-rebar/shapes.js
  const steelShapes = read('modules/steel-rebar/shapes.js');
  assert.match(steelShapes, /function normalizeFactorySegments/);
  assert.match(steelShapes, /function normalizeFactoryShapeName/);
  assert.match(service, /createOrderTransaction: db\.transaction\(createOrderFromPayload\)/);
  assert.match(server, /require\('\.\/services\/orders'\)/);
  assert.match(server, /createOrderFactory\(db, \{/);
  assert.doesNotMatch(server, /function createOrderFromPayload/);
  assert.doesNotMatch(server, /function validateShapeGeometry/);
});

test('inventory receiving and bent-shape parsing live in an inventory service', () => {
  const service = read('services/inventory.js');
  const route = read('routes/inventory.js');

  assert.match(service, /const MATERIAL_TYPES = new Set\(\['coil', 'straight', 'bent'\]\)/);
  assert.match(service, /function normalizeBendingShapeInput/);
  assert.match(service, /function bendingShapeColumns/);
  assert.match(service, /function normalizeReceiptReviewItem/);
  assert.match(service, /function parseReceiptReviewPayload/);
  assert.match(route, /require\('\.\.\/services\/inventory'\)/);
  assert.match(route, /const \{\s+MATERIAL_TYPES,\s+bendingShapeColumns,\s+normalizeBendingShapeInput,\s+normalizeReceiptReviewItem,\s+parseReceiptReviewPayload,\s+\} = require\('\.\.\/services\/inventory'\);/);
});

test('inventory procurement API routes are split out of the server monolith', () => {
  const route = read('routes/inventory.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createInventoryRouter/);
  assert.match(route, /router\.get\('\/suppliers'/);
  assert.match(route, /router\.post\('\/inventory\/receipt-reviews\/analyze'/);
  assert.match(route, /router\.get\('\/steel-prices'/);
  assert.match(route, /router\.patch\('\/purchase-orders\/:id\/receive'/);
  assert.match(server, /createInventoryRouter/);
  assert.match(server, /app\.use\('\/api', createInventoryRouter/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/suppliers/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/inventory/);
  assert.doesNotMatch(server, /app\.(get|post)\('\/api\/steel-prices/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/purchase-orders/);
});

test('core order API routes are split out of the server monolith', () => {
  const route = read('routes/orders.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createOrdersRouter/);
  assert.match(route, /router\.get\('\/orders'/);
  assert.match(route, /router\.post\('\/order-imports\/preview'/);
  assert.match(route, /router\.post\('\/orders'/);
  assert.match(route, /router\.patch\('\/orders\/:id\/status'/);
  assert.match(route, /auditLog\('order'/);
  assert.match(route, /wsBroadcast\('new_order'/);
  assert.match(server, /createOrdersRouter/);
  assert.match(server, /app\.use\('\/api', createOrdersRouter/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/orders(?!\/:id\/(?:print-cards|delivery-certificate|print-a4|margin|costs))/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/order-imports/);
});

test('production card print routes are split out of the server monolith', () => {
  const route = read('routes/productionCards.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createProductionCardsRouter/);
  assert.match(route, /router\.get\('\/orders\/:id\/print-cards'/);
  assert.match(route, /router\.get\('\/orders\/:id\/delivery-certificate'/);
  assert.match(route, /router\.get\('\/orders\/:id\/print-a4'/);
  assert.match(route, /cards\.masterCard/);
  assert.match(route, /cards\.itemCard/);
  assert.match(server, /createProductionCardsRouter/);
  assert.match(server, /app\.use\('\/api', createProductionCardsRouter/);
  assert.doesNotMatch(server, /app\.get\('\/api\/orders\/:id\/print-cards'/);
  assert.doesNotMatch(server, /app\.get\('\/api\/orders\/:id\/delivery-certificate'/);
  assert.doesNotMatch(server, /app\.get\('\/api\/orders\/:id\/print-a4'/);
  assert.doesNotMatch(server, /function pcMasterCard/);
  assert.doesNotMatch(server, /function pcItemCard/);
});

test('finance API routes are split out of the server monolith', () => {
  const route = read('routes/finance.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createFinanceRouter/);
  assert.match(route, /router\.get\('\/invoices'/);
  assert.match(route, /router\.post\('\/invoices'/);
  assert.match(route, /router\.patch\('\/invoices\/:id\/pay'/);
  assert.match(route, /router\.patch\('\/invoices\/:id\/cancel'/);
  assert.match(route, /router\.get\('\/orders\/:id\/margin'/);
  assert.match(route, /router\.get\('\/orders\/:id\/costs'/);
  assert.match(route, /router\.post\('\/orders\/:id\/costs\/recalculate'/);
  assert.match(route, /router\.patch\('\/orders\/:id\/costs\/lock'/);
  assert.match(route, /router\.get\('\/customers\/:id\/ledger'/);
  assert.match(route, /router\.patch\('\/customers\/:id\/credit'/);
  assert.match(route, /router\.get\('\/finance\/kpis'/);
  assert.match(route, /router\.get\('\/finance\/events'/);
  assert.ok(route.includes("router.get('/credit'"));
  assert.ok(route.includes("router.get('/credit/:customerId'"));
  assert.ok(route.includes("router.patch('/credit/:customerId'"));
  assert.ok(route.includes("router.post('/credit/:customerId/transaction'"));
  assert.ok(route.includes("router.get('/credit/:customerId/status'"));
  assert.match(route, /credit_accounts/);
  assert.match(route, /credit_transactions/);
  assert.match(route, /wsBroadcast\('new_invoice'/);
  assert.match(route, /BUG-36: cannot pay cancelled invoice/);
  assert.match(route, /function calculateOrderCost/);
  assert.match(server, /createFinanceRouter/);
  assert.match(server, /app\.use\('\/api', createFinanceRouter/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/invoices/);
  assert.doesNotMatch(server, /app\.(get|post|patch)\('\/api\/orders\/:id\/(?:margin|costs)/);
  assert.doesNotMatch(server, /app\.(get|patch)\('\/api\/customers\/:id\/(?:ledger|credit)/);
  assert.doesNotMatch(server, /app\.get\('\/api\/finance\/(?:kpis|events)'/);
  assert.doesNotMatch(server, /app\.(get|patch)\('\/api\/price-list'/);
  assert.ok(!server.includes("app.get('/api/credit'"));
  assert.ok(!server.includes("app.patch('/api/credit/:customerId'"));
  assert.ok(!server.includes("app.post('/api/credit/:customerId/transaction'"));
  assert.doesNotMatch(server, /function calculateOrderCost/);
  assert.match(server, /createReportsRouter/);
  assert.doesNotMatch(server, /app\.get\('\/api\/export\/orders'/);
  assert.doesNotMatch(route, /app\.get\('\/api\/export/);
});

test('catalog and pricing routes are split out of the server monolith', () => {
  const route = read('routes/catalog.js');
  const finance = read('routes/finance.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createCatalogRouter/);
  assert.ok(route.includes("router.get('/price-list'"));
  assert.ok(route.includes("router.patch('/price-list'"));
  assert.match(route, /function notifyPriceListUpdate/);
  assert.ok(route.includes("router.get('/shapes'"));
  assert.ok(route.includes("router.post('/shapes'"));
  assert.ok(route.includes("router.post('/shapes/seed'"));
  assert.match(server, /createCatalogRouter/);
  assert.ok(server.includes("app.use('/api', createCatalogRouter"));
  assert.ok(!finance.includes("router.get('/price-list'"));
  assert.ok(!finance.includes("router.patch('/price-list'"));
  assert.ok(!server.includes("app.get('/api/price-list'"));
  assert.ok(!server.includes("app.patch('/api/price-list'"));
  assert.ok(!server.includes("app.get('/api/shapes'"));
  assert.ok(!server.includes("app.post('/api/shapes'"));
});

test('intake import and manual parsing live in an intake workflow service', () => {
  const service = read('services/intakeWorkflow.js');
  const server = read('server.js');
  const route = read('routes/intake.js');

  assert.match(service, /function buildOrderImportPreview/);
  assert.match(service, /function buildIntakeOrderPayload/);
  assert.match(service, /function normalizeIntakeItem/);
  assert.match(service, /function resolveIntakeCustomer/);
  assert.match(service, /function parseDelimitedRows/);
  assert.match(service, /function parseManualIntakeText/);
  assert.match(server, /require\('\.\/services\/intakeWorkflow'\)/);
  assert.match(server, /intakeWorkflow\.buildIntakeOrderPayload/);
  assert.match(server, /intakeWorkflow\.buildOrderImportPreview/);
  assert.match(route, /intakeWorkflow\.parseManualIntakeText/);
  assert.match(server, /intakeWorkflow\.resolveIntakeCustomer/);
});

test('intake API routes are split out of the server monolith', () => {
  const route = read('routes/intake.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createIntakeRouter/);
  assert.ok(route.includes("router.post('/analyze-image'"));
  assert.ok(route.includes("router.get('/intake/training'"));
  assert.ok(route.includes("router.post('/intake/training'"));
  assert.ok(route.includes("router.delete('/intake/training/:id'"));
  assert.ok(route.includes("router.post('/intake/image'"));
  assert.ok(route.includes("router.get('/intake/whatsapp'"));
  assert.ok(route.includes("router.post('/intake/whatsapp'"));
  assert.ok(route.includes("router.post('/intake/email/poll'"));
  assert.ok(route.includes("router.get('/intake/log'"));
  assert.ok(route.includes("router.post('/intake/:id/approve'"));
  assert.ok(route.includes("router.post('/intake/:id/reject'"));
  assert.ok(route.includes("router.post('/intake/parse-text'"));
  assert.match(server, /createIntakeRouter/);
  assert.ok(server.includes("app.use('/api', createIntakeRouter"));
  assert.ok(!server.includes("app.post('/api/analyze-image'"));
  assert.ok(!server.includes("app.get('/api/intake/training'"));
  assert.ok(!server.includes("app.post('/api/intake/training'"));
  assert.ok(!server.includes("app.delete('/api/intake/training/:id'"));
  assert.ok(!server.includes("app.post('/api/intake/image'"));
  assert.ok(!server.includes("app.get('/api/intake/whatsapp'"));
  assert.ok(!server.includes("app.post('/api/intake/whatsapp'"));
  assert.ok(!server.includes("app.post('/api/intake/email/poll'"));
  assert.ok(!server.includes("app.get('/api/intake/log'"));
  assert.ok(!server.includes("app.post('/api/intake/:id/approve'"));
  assert.ok(!server.includes("app.post('/api/intake/:id/reject'"));
  assert.ok(!server.includes("app.post('/api/intake/parse-text'"));
});

test('fleet vehicle health and input normalization live in a fleet service', () => {
  const service = read('services/fleet.js');
  const route = read('routes/fleet.js');
  const server = read('server.js');

  assert.match(service, /function vehicleHealth/);
  assert.match(service, /function vehicleInput/);
  assert.match(service, /טסט/);
  assert.match(service, /ביטוח/);
  assert.match(service, /טיפול לפי ק"מ/);
  assert.match(route, /require\('\.\.\/services\/fleet'\)/);
  assert.match(route, /fleetService\.vehicleHealth/);
  assert.match(route, /fleetService\.vehicleInput/);
  assert.doesNotMatch(server, /function vehicleHealth/);
  assert.doesNotMatch(server, /function vehicleInput/);
});

test('customer CRM project and site API routes are split out of the server monolith', () => {
  const route = read('routes/customers.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createCustomersRouter/);
  assert.ok(route.includes('routes/customers missing dependency'));
  assert.ok(!route.includes("router.get('/customers/:id/token'"));
  assert.ok(!route.includes("router.post('/customers/:id/token/rotate'"));
  assert.ok(!route.includes('c.portal_token'));

  for (const routeSnippet of [
    "router.get('/customers'",
    "router.get('/customers/:id'",
    "router.post('/customers'",
    "router.patch('/customers/:id'",
    "router.get('/projects'",
    "router.get('/projects/:id'",
    "router.post('/projects'",
    "router.patch('/projects/:id'",
    "router.get('/sites'",
    "router.post('/sites'",
    "router.patch('/sites/:id'",
  ]) {
    assert.ok(route.includes(routeSnippet), routeSnippet);
  }

  assert.match(server, /createCustomersRouter/);
  assert.ok(server.includes("app.use('/api', createCustomersRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/customers',",
    "app.get('/api/customers/:id',",
    "app.post('/api/customers',",
    "app.patch('/api/customers/:id',",
    "app.get('/api/projects'",
    "app.post('/api/projects'",
    "app.patch('/api/projects/:id'",
    "app.get('/api/sites'",
    "app.post('/api/sites'",
    "app.patch('/api/sites/:id'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }

  assert.ok(!server.includes("app.get('/api/customers/:id/token'"));
  assert.ok(!server.includes("app.patch('/api/customers/:id/pricing'"));
});

test('auth identity routes are split out of admin and server monolith', () => {
  const route = read('routes/auth.js');
  const admin = read('routes/admin.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createAuthRouter/);
  assert.ok(route.includes('routes/auth missing dependency'));
  assert.ok(route.includes("router.post('/auth/login'"));
  assert.ok(route.includes("router.post('/auth/refresh'"));
  assert.ok(route.includes("router.post('/auth/logout'"));
  assert.ok(route.includes("router.post('/users/login'"));
  assert.match(route, /refreshCookie/);
  assert.match(route, /parseCookies/);
  assert.doesNotMatch(route, /router[.](get|post|patch)\('\/settings/);
  assert.doesNotMatch(route, /router[.](get|post|patch)\('\/users'/);
  assert.doesNotMatch(admin, /router[.]post\('\/auth\//);

  assert.match(server, /createAuthRouter/);
  assert.ok(server.includes("app.use('/api', createAuthRouter"));
  assert.ok(!server.includes("app.post('/api/auth/login'"));
  assert.ok(!server.includes("app.post('/api/auth/refresh'"));
  assert.ok(!server.includes("app.post('/api/auth/logout'"));
  assert.ok(!server.includes("app.post('/api/users/login'"));
});

test('customer portal and portal management routes are split out of the server monolith', () => {
  const route = read('routes/portal.js');
  const customers = read('routes/customers.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createPortalRouter/);
  assert.ok(route.includes('routes/portal missing dependency'));
  assert.ok(route.includes("router.get('/customers/:id/token'"));
  assert.ok(route.includes("router.post('/customers/:id/token/rotate'"));
  assert.ok(route.includes("router.delete('/customers/:id/token'"));
  assert.ok(route.includes("router.patch('/customers/:id/pricing'"));
  assert.ok(route.includes("router.post('/c/auth'"));
  assert.ok(route.includes("router.post('/c/auth/verify'"));
  assert.ok(route.includes("router.get('/c/me'"));
  assert.ok(route.includes("router.get('/c/price-list'"));
  assert.ok(route.includes("router.post('/c/quote'"));
  assert.ok(route.includes("router.post('/c/order'"));
  assert.ok(route.includes("router.get('/c/approve/:token'"));
  assert.ok(route.includes("router.post('/c/approve'"));
  assert.ok(route.includes("router.get('/c/orders/:orderId'"));
  assert.match(route, /CUSTOMER_PORTAL_COLS/);
  assert.match(route, /customerPortalAuthLimiter/);
  assert.match(route, /customerPortalActionLimiter/);
  assert.ok(!customers.includes("router.get('/customers/:id/token'"));
  assert.ok(!customers.includes("router.patch('/customers/:id/pricing'"));

  assert.match(server, /createPortalRouter/);
  assert.ok(server.includes("app.use('/api', createPortalRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/customers/:id/token'",
    "app.post('/api/customers/:id/token/rotate'",
    "app.delete('/api/customers/:id/token'",
    "app.patch('/api/customers/:id/pricing'",
    "app.post('/api/c/auth'",
    "app.post('/api/c/auth/verify'",
    "app.get('/api/c/me'",
    "app.get('/api/c/price-list'",
    "app.post('/api/c/quote'",
    "app.post('/api/c/order'",
    "app.get('/api/c/approve/:token'",
    "app.post('/api/c/approve'",
    "app.get('/api/c/orders/:orderId'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }
});

test('admin settings users audit and database routes are split out of the server monolith', () => {
  const route = read('routes/admin.js');
  const auth = read('routes/auth.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createAdminRouter/);
  assert.ok(route.includes('routes/admin missing dependency'));
  assert.ok(route.includes("router.get('/settings'"));
  assert.ok(route.includes("router.post('/settings'"));
  assert.ok(route.includes("router.post('/settings/test/:service'"));
  assert.ok(route.includes("router.get('/audit-log'"));
  assert.ok(route.includes("router.get('/users'"));
  assert.ok(route.includes("router.get('/kiosk/operators'"));
  assert.ok(route.includes("router.post('/users'"));
  assert.ok(route.includes("router.patch('/users/:id'"));
  assert.ok(route.includes("router.get('/admin/data-audit'"));
  assert.ok(route.includes("router.get('/admin/database/download'"));
  assert.ok(route.includes("router.post('/admin/database/upload'"));
  assert.match(route, /getDb/);
  assert.match(route, /setDb/);
  assert.match(route, /validateUploadedDatabase/);
  assert.match(route, /allowDatabaseUpload/);
  assert.doesNotMatch(auth, /router[.](get|post|patch)\('\/settings/);
  assert.doesNotMatch(auth, /router[.](get|post|patch)\('\/admin\//);

  assert.match(server, /createAdminRouter/);
  assert.ok(server.includes("app.use('/api', createAdminRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/settings'",
    "app.post('/api/settings'",
    "app.post('/api/settings/test/:service'",
    "app.get('/api/audit-log'",
    "app.get('/api/users'",
    "app.get('/api/kiosk/operators'",
    "app.post('/api/users'",
    "app.patch('/api/users/:id'",
    "app.get('/api/admin/data-audit'",
    "app.get('/api/admin/database/download'",
    "app.post('/api/admin/database/upload'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }
  assert.ok(server.includes("app.get('/api/health'"));
});

test('quality and maintenance API routes are split out of the server monolith', () => {
  const route = read('routes/quality.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createQualityRouter/);
  assert.ok(route.includes('routes/quality missing dependency'));
  assert.ok(!route.includes('requireRole'));
  assert.ok(route.includes("wsBroadcast('machine_update'"));
  assert.ok(route.includes('INSERT INTO quality_checks'));
  assert.ok(route.includes('UPDATE items SET qc_status'));
  assert.ok(route.includes('UPDATE machines SET status='));

  for (const routeSnippet of [
    "router.get('/quality'",
    "router.post('/quality'",
    "router.get('/quality/stats'",
    "router.get('/maintenance'",
    "router.post('/maintenance'",
    "router.patch('/maintenance/:id'",
    "router.get('/maintenance/stats'",
    "router.get('/incidents'",
    "router.post('/incidents'",
    "router.patch('/incidents/:id'",
    "router.get('/ncr'",
    "router.post('/ncr'",
    "router.patch('/ncr/:id'",
    "router.get('/capa'",
    "router.post('/capa'",
    "router.patch('/capa/:id'",
    "router.get('/loto'",
    "router.post('/loto'",
    "router.patch('/loto/:id/release'",
    "router.get('/pm-schedule'",
    "router.post('/pm-schedule'",
  ]) {
    assert.ok(route.includes(routeSnippet), routeSnippet);
  }

  assert.match(server, /createQualityRouter/);
  assert.ok(server.includes("app.use('/api', createQualityRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/quality'",
    "app.post('/api/quality'",
    "app.get('/api/maintenance'",
    "app.post('/api/maintenance'",
    "app.patch('/api/maintenance/:id'",
    "app.get('/api/incidents'",
    "app.post('/api/incidents'",
    "app.patch('/api/incidents/:id'",
    "app.get('/api/ncr'",
    "app.post('/api/ncr'",
    "app.patch('/api/ncr/:id'",
    "app.get('/api/capa'",
    "app.post('/api/capa'",
    "app.patch('/api/capa/:id'",
    "app.get('/api/loto'",
    "app.post('/api/loto'",
    "app.patch('/api/loto/:id/release'",
    "app.get('/api/pm-schedule'",
    "app.post('/api/pm-schedule'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }
});

test('production execution API routes are split out of the server monolith', () => {
  const route = read('routes/production.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createProductionRouter/);
  for (const routeSnippet of [
    "router.get('/workers'",
    "router.post('/workers'",
    "router.get('/machines'",
    "router.post('/machines'",
    "router.patch('/machines/:id/config'",
    "router.patch('/machines/:id/state'",
    "router.post('/scan'",
    "router.get('/production-queue'",
    "router.get('/production-events'",
    "router.get('/shifts'",
    "router.post('/machine-stops'",
    "router.patch('/items/:id/status'",
    "router.get('/machines/oee'",
    "router.get('/kpi/tons-today'",
  ]) {
    assert.ok(route.includes(routeSnippet), routeSnippet);
  }
  assert.match(route, /statusContracts[.]ITEM_STATUS[.]DONE/);
  assert.ok(route.includes("wsBroadcast('machine_assign'"));
  assert.match(route, /checkOrderComplete/);
  assert.match(server, /createProductionRouter/);
  assert.ok(server.includes("app.use('/api', createProductionRouter"));

  for (const forbiddenSnippet of [
    "app.get('/api/workers'",
    "app.post('/api/workers'",
    "app.get('/api/machines'",
    "app.post('/api/machines'",
    "app.patch('/api/machines/:id/config'",
    "app.patch('/api/machines/:id/state'",
    "app.post('/api/scan'",
    "app.get('/api/production-queue'",
    "app.get('/api/production-events'",
    "app.get('/api/shifts'",
    "app.post('/api/machine-stops'",
    "app.patch('/api/items/:id/status'",
    "app.get('/api/kpi/tons-today'",
    "app.get('/api/kpi/shift-summary'",
    "app.get('/api/machines/oee'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }

  assert.ok(server.includes("createWarehouseRouter"));
  assert.ok(server.includes("createReportsRouter"));
});

test('warehouse package and delivery note routes are split out of the server monolith', () => {
  const route = read('routes/warehouse.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createWarehouseRouter/);
  assert.ok(route.includes('routes/warehouse missing dependency'));
  assert.ok(route.includes("router.get('/packages'"));
  assert.ok(route.includes("router.post('/packages'"));
  assert.ok(route.includes("router.patch('/packages/:id/ship'"));
  assert.ok(route.includes("router.get('/delivery-notes'"));
  assert.ok(route.includes("router.post('/delivery-notes'"));
  assert.match(route, /package_code/);
  assert.match(route, /note_num/);
  assert.match(server, /createWarehouseRouter/);
  assert.ok(server.includes("app.use('/api', createWarehouseRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/packages'",
    "app.post('/api/packages'",
    "app.patch('/api/packages/:id/ship'",
    "app.get('/api/delivery-notes'",
    "app.post('/api/delivery-notes'",
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }
});

test('dashboard reports KPI and export routes are split out of the server monolith', () => {
  const route = read('routes/reports.js');
  const server = read('server.js');

  assert.match(route, /module[.]exports = function createReportsRouter/);
  assert.ok(route.includes('routes/reports missing dependency'));
  assert.ok(route.includes("router.get('/dashboard'"));
  assert.ok(route.includes("router.get('/reports/summary'"));
  assert.ok(route.includes("router.get('/kpi/monthly'"));
  assert.ok(route.includes("router.get('/export/orders'"));
  assert.ok(route.includes("router.get('/export/packages'"));
  assert.ok(route.includes("router.get('/export/inventory'"));
  assert.match(route, /function toCSV/);
  assert.match(route, /statusContracts[.]ITEM_STATUS[.]DONE/);
  assert.match(route, /ai[.]analyzeWastePatterns/);
  assert.match(server, /createReportsRouter/);
  assert.ok(server.includes("app.use('/api', createReportsRouter"));
  for (const forbiddenSnippet of [
    "app.get('/api/dashboard'",
    "app.get('/api/reports/summary'",
    "app.get('/api/kpi/monthly'",
    "app.get('/api/export/orders'",
    "app.get('/api/export/packages'",
    "app.get('/api/export/inventory'",
    'function toCSV',
  ]) {
    assert.ok(!server.includes(forbiddenSnippet), forbiddenSnippet);
  }
});

test('fleet API routes are split out of the server monolith', () => {
  const route = read('routes/fleet.js');
  const server = read('server.js');

  assert.match(route, /module\.exports = function createFleetRouter/);
  assert.match(route, /require\('\.\.\/services\/fleet'\)/);
  assert.match(route, /function vehiclePortfolioRows/);
  assert.match(route, /function driverRows/);
  assert.match(route, /router\.get\('\/vehicles'/);
  assert.match(route, /router\.post\('\/vehicles'/);
  assert.match(route, /router\.patch\('\/vehicles\/:id'/);
  assert.match(route, /router\.get\('\/vehicles\/:id\/events'/);
  assert.match(route, /router\.post\('\/vehicles\/:id\/events'/);
  assert.match(route, /router\.get\('\/vehicles\/:id\/documents'/);
  assert.match(route, /router\.post\('\/vehicles\/:id\/documents'/);
  assert.match(route, /router\.get\('\/drivers'/);
  assert.match(route, /router\.post\('\/drivers'/);
  assert.match(route, /router\.patch\('\/drivers\/:id'/);
  assert.match(route, /router\.delete\('\/drivers\/:id'/);
  assert.match(route, /router\.get\('\/drivers\/:id\/vehicle-events'/);
  assert.match(route, /router\.post\('\/drivers\/:id\/vehicle-events'/);
  assert.match(route, /router\.patch\('\/drivers\/:id\/location'/);
  assert.match(route, /router\.get\('\/deliveries'/);
  assert.match(route, /router\.post\('\/deliveries'/);
  assert.match(route, /router\.post\('\/deliveries\/:id\/depart'/);
  assert.match(route, /router\.post\('\/deliveries\/:id\/confirm'/);
  assert.match(route, /router\.post\('\/deliveries\/:id\/problem'/);
  assert.match(route, /intakeNotify/);
  assert.match(route, /priorityUpdate/);
  assert.match(route, /createAlert\('delivery_problem'/);
  assert.match(server, /createFleetRouter/);
  assert.match(server, /app\.use\('\/api', createFleetRouter/);
  assert.doesNotMatch(server, /app\.(get|post|patch|delete)\('\/api\/vehicles/);
  assert.doesNotMatch(server, /app\.(get|post|patch|delete)\('\/api\/drivers/);
  assert.doesNotMatch(server, /app\.(get|post|patch|delete)\('\/api\/deliveries/);
  assert.doesNotMatch(server, /function vehiclePortfolioRows/);
  assert.doesNotMatch(server, /function driverRows/);
  assert.match(server, /createPriorityRouter/);
  assert.match(server, /createWarehouseRouter/);
});

test('remaining utility API routes are split out of the server monolith', () => {
  const server = read('server.js');
  const alerts = read('routes/alerts.js');
  const companies = read('routes/companies.js');
  const priority = read('routes/priority.js');
  const ai = read('routes/ai.js');
  const search = read('routes/search.js');
  const bvbs = read('routes/bvbs.js');

  assert.match(alerts, /module[.]exports = function createAlertsRouter/);
  assert.ok(alerts.includes("router.get('/alerts'"));
  assert.ok(alerts.includes("router.post('/alerts'"));
  assert.ok(alerts.includes("router.patch('/alerts/:id/resolve'"));

  assert.match(companies, /module[.]exports = function createCompaniesRouter/);
  assert.ok(companies.includes("router.get('/companies'"));
  assert.ok(companies.includes("router.post('/companies'"));
  assert.ok(companies.includes("router.patch('/companies/:id'"));
  assert.ok(companies.includes("router.get('/holdings'"));

  assert.match(priority, /module[.]exports = function createPriorityRouter/);
  assert.ok(priority.includes("router.post('/priority/sync/:orderId'"));
  assert.ok(priority.includes("router.get('/priority/status'"));

  assert.match(ai, /module[.]exports = function createAiRouter/);
  assert.ok(ai.includes("router.post('/ai/predict'"));
  assert.ok(ai.includes("router.get('/ai/predict-order/:orderId'"));
  assert.ok(ai.includes("router.get('/ai/waste-patterns'"));
  assert.ok(ai.includes("router.get('/ai/machine-efficiency'"));

  assert.match(search, /module[.]exports = function createSearchRouter/);
  assert.ok(search.includes("router.get('/search'"));

  assert.match(bvbs, /module[.]exports = function createBvbsRouter/);
  assert.match(bvbs, /function parseBVBSLine/);
  assert.match(bvbs, /function parseBVBS/);
  assert.ok(bvbs.includes("router.post('/bvbs/parse'"));
  assert.ok(bvbs.includes("router.post('/bvbs/create-order'"));

  for (const forbidden of [
    "app.get('/api/alerts'",
    "app.post('/api/alerts'",
    "app.patch('/api/alerts/:id/resolve'",
    "app.get('/api/companies'",
    "app.post('/api/companies'",
    "app.patch('/api/companies/:id'",
    "app.get('/api/holdings'",
    "app.post('/api/priority/sync/:orderId'",
    "app.get('/api/priority/status'",
    "app.post('/api/ai/predict'",
    "app.get('/api/ai/predict-order/:orderId'",
    "app.get('/api/ai/waste-patterns'",
    "app.get('/api/ai/machine-efficiency'",
    "app.get('/api/search'",
    "app.post('/api/bvbs/parse'",
    "app.post('/api/bvbs/create-order'",
    'function parseBVBSLine',
    'function parseBVBS',
  ]) {
    assert.ok(!server.includes(forbidden), forbidden);
  }
});


test('database startup schema migrations and seed data are extracted from server', () => {
  const startup = read('db/startup.js');
  const server = read('server.js');

  assert.match(startup, /function ensureCoreSchema\(db\)/);
  assert.match(startup, /function runCoreMigrations\(db\)/);
  assert.match(startup, /function seedCoreData\(db\)/);
  assert.match(startup, /CREATE TABLE IF NOT EXISTS customers/);
  assert.match(startup, /function addCol\(table, col, def\)/);
  assert.match(startup, /INSERT OR IGNORE INTO downtime_reasons/);
  assert.match(server, /require\('\.\/db\/startup'\)/);
  assert.match(server, /ensureCoreSchema\(db\)/);
  assert.match(server, /runCoreMigrations\(db\)/);
  assert.match(server, /seedCoreData\(db\)/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS customers/);
  assert.doesNotMatch(server, /function addCol\(table, col, def\)/);
  assert.doesNotMatch(server, /INSERT OR IGNORE INTO downtime_reasons/);
});


test('realtime websocket transport is extracted from server', () => {
  const realtime = read('realtime/ws.js');
  const server = read('server.js');

  assert.match(realtime, /function createRealtimeServer\(deps\)/);
  assert.match(realtime, /new WebSocketServer\(\{ noServer: true \}\)/);
  assert.match(realtime, /function wsBroadcast\(type, data\)/);
  assert.match(realtime, /server\.on\('upgrade', onUpgrade\)/);
  assert.match(realtime, /modbus\.onUpdate/);
  assert.match(realtime, /machines_state/);
  assert.match(server, /require\('\.\/realtime\/ws'\)/);
  assert.match(server, /const realtime = createRealtimeServer\(\{ server, db, modbus, authService, applyAuthBypass \}\)/);
  assert.match(server, /const wsBroadcast = realtime\.wsBroadcast/);
  assert.doesNotMatch(server, /new WebSocketServer/);
  assert.doesNotMatch(server, /function wsBroadcast\(type, data\)/);
  assert.doesNotMatch(server, /wss\.on\('connection'/);
  assert.doesNotMatch(server, /server\.on\('upgrade'/);
});


test('scheduled background jobs are extracted from server', () => {
  const scheduler = read('jobs/scheduler.js');
  const server = read('server.js');

  assert.match(scheduler, /function createScheduler\(deps\)/);
  assert.match(scheduler, /cron\.schedule/);
  assert.match(scheduler, /settingsService\.getNum\('URGENT_ORDER_WAIT_MINUTES'/);
  assert.match(scheduler, /intake\.pollEmail/);
  assert.match(scheduler, /new_intake_email/);
  assert.match(scheduler, /createBackupService/);
  assert.match(scheduler, /db\.backup/);
  assert.match(server, /require\('\.\/jobs\/scheduler'\)/);
  assert.match(server, /const scheduler = createScheduler\(\{/);
  assert.match(server, /scheduler\.stop\(\)/);
  assert.doesNotMatch(server, /require\('node-cron'\)/);
  assert.doesNotMatch(server, /cron\.schedule/);
  assert.doesNotMatch(server, /createBackupService/);
  assert.doesNotMatch(server, /intake\.pollEmail/);
  assert.doesNotMatch(server, /new_intake_email/);
});


test('finance schema is extracted from server startup', () => {
  const financeSchema = read('db/financeSchema.js');
  const startup = read('db/startup.js');
  const server = read('server.js');

  assert.match(financeSchema, /function ensureFinanceSchema\(db\)/);
  assert.match(financeSchema, /CREATE TABLE IF NOT EXISTS order_costs/);
  assert.match(financeSchema, /CREATE TABLE IF NOT EXISTS cost_snapshots/);
  assert.match(financeSchema, /CREATE TABLE IF NOT EXISTS customer_credit/);
  assert.match(financeSchema, /CREATE TABLE IF NOT EXISTS financial_events/);
  assert.match(financeSchema, /CREATE TABLE IF NOT EXISTS steel_prices/);
  assert.match(startup, /require\('\.\/financeSchema'\)/);
  assert.match(startup, /ensureFinanceSchema\(db\)/);
  assert.doesNotMatch(server, /FINANCIAL SCHEMA BOOTSTRAP/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS order_costs/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS customer_credit/);
  assert.doesNotMatch(server, /CREATE TABLE IF NOT EXISTS steel_prices/);
});
