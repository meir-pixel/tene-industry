const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('client auth contract has a single fetch wrapper source', () => {
  const authClient = read('public/auth-client.js');
  const nav = read('public/nav.js');

  assert.match(authClient, /window\.IronBendAuth/);
  assert.match(authClient, /window\.fetch = authFetch/);
  assert.match(authClient, /showAuthNotice/);
  assert.match(authClient, /השרת עובד/);
  assert.match(authClient, /\/login\.html\?next=/);
  assert.doesNotMatch(nav, /window\.fetch\s*=/);
  assert.match(nav, /auth-client\.js/);
});

test('browser clients do not send spoofable role headers', () => {
  const publicFiles = fs.readdirSync(path.join(root, 'public'))
    .filter(file => /\.(html|js)$/.test(file))
    .map(file => `public/${file}`);

  const offenders = publicFiles
    .filter(file => file !== 'public/auth-client.js')
    .filter(file => /x-user-role|x-user-id/.test(read(file)));

  assert.deepEqual(offenders, []);

  const authClient = read('public/auth-client.js');
  assert.match(authClient, /headers\.delete\('x-user-role'\)/);
  assert.match(authClient, /headers\.delete\('x-user-id'\)/);
});

test('login stores sessions through IronBendAuth', () => {
  const login = read('public/login.html');

  assert.match(login, /src="\/auth-client\.js"/);
  assert.match(login, /IronBendAuth\.storeSession/);
  assert.doesNotMatch(login, /setItem\('ib_access_token'/);
  assert.doesNotMatch(login, /Demo mode/i);
  assert.doesNotMatch(login, /דמו/);
  assert.doesNotMatch(login, /PIN 1234/);
});

test('public portal does not query internal order search', () => {
  const portal = read('public/portal.html');

  assert.doesNotMatch(portal, /\/api\/orders\?order_num=/);
  assert.match(portal, /customer-scoped portal token/);
});

test('production card split keeps item cards and master card in sync', () => {
  const productionCardsRoute = read('routes/productionCards.js');

  assert.match(productionCardsRoute, /function cardPlan\(\)/);
  assert.match(productionCardsRoute, /function buildSplitMaster\(\)/);
  assert.match(productionCardsRoute, /d\.innerHTML = buildSplitMaster\(\)/);
  assert.match(productionCardsRoute, /buildCard\(row\.item, row\.subQty, row\.totalCards, row\.cardIdx\)/);
  assert.match(productionCardsRoute, /function isOpenUShapeClient\(segments\)/);
  assert.match(productionCardsRoute, /function buildOpenUShapeSVG\(segments\)/);
  assert.match(productionCardsRoute, /data-shape-kind="open-u"/);
  assert.match(productionCardsRoute, /function printCards\(\)[\s\S]*generateCards\(\);[\s\S]*window\.print\(\);/);
  assert.match(productionCardsRoute, /'-C' \+ \(cardIdx\+1\) \+ 'OF' \+ totalCards/);
  assert.match(productionCardsRoute, /להדפיס גם מאסטר מעודכן/);
});

test('customer portal UI uses OTP verification before storing token', () => {
  const customer = read('public/customer.html');

  assert.match(customer, /id="authOtpField"/);
  assert.match(customer, /\/api\/c\/auth\/verify/);
  assert.match(customer, /otpRequired/);
  assert.match(customer, /completeAuth\(data\.data\)/);
});

test('customer CRM can rotate and revoke portal links', () => {
  const customers = read('public/customers.html');
  const admin = read('public/admin.html');

  assert.match(customers, /rotatePortalLink/);
  assert.match(customers, /revokePortalLink/);
  assert.match(customers, /\/api\/customers\/' \+ id \+ '\/token\/rotate/);
  assert.match(customers, /method: 'DELETE'/);
  assert.doesNotMatch(admin, /customerLinksList/);
  assert.doesNotMatch(admin, /copyCustomerLink/);
});

test('high-risk screens load shared safe DOM helper', () => {
  const files = [
    'public/admin.html',
    'public/customers.html',
    'public/dashboard.html',
    'public/reports.html',
    'public/finance.html',
    'public/machine.html',
    'public/orders.html',
  ];

  for (const file of files) {
    assert.match(read(file), /\/safe-dom\.js/, file);
  }

  assert.match(read('public/safe-dom.js'), /window\.IronBendSafe/);
});

test('high-risk admin and reporting surfaces load auth client before shared navigation', () => {
  for (const file of ['public/admin.html', 'public/finance.html', 'public/reports.html']) {
    const html = read(file);
    const authIndex = html.indexOf('src="/auth-client.js"');
    const navIndex = html.indexOf('src="/nav.js"');

    assert.notEqual(authIndex, -1, `${file} should load auth-client.js`);
    assert.notEqual(navIndex, -1, `${file} should load nav.js`);
    assert.ok(authIndex < navIndex, `${file} should load auth before nav`);
  }
});

test('shared navigation preserves Tene logo aspect ratio', () => {
  const nav = read('public/nav.js');
  const theme = read('public/theme.css');

  assert.match(nav, /#ib-logo-icon \{[\s\S]*height:auto/);
  assert.match(nav, /#ib-drawer-logo \{[\s\S]*height:auto/);
  assert.doesNotMatch(nav, /#ib-logo-icon \{[\s\S]*height:\s*42px/);
  assert.match(theme, /#ib-logo img, #ib-drawer-logo \{[\s\S]*height: auto/);
});

test('shared desktop navigation is right aligned for RTL layout', () => {
  const nav = read('public/nav.js');
  const theme = read('public/theme.css');

  assert.match(nav, /padding-right:\s*156px/);
  assert.match(nav, /inset:\s*0 0 0 auto/);
  assert.match(nav, /border-left:\s*1px solid/);
  assert.match(nav, /#ib-drawer \{[\s\S]*right:0/);
  assert.match(nav, /transform:translateX\(100%\)/);
  assert.match(theme, /border-left:\s*1px solid/);
});

test('shared navigation module icons are clickable links', () => {
  const nav = read('public/nav.js');

  assert.match(nav, /escapeAttr\(l\.href\)/);
  assert.match(nav, /title=".*escapeAttr\(l\.label\)/);
  assert.match(nav, /aria-label=".*escapeAttr\(l\.label\)/);
  assert.match(nav, /ib-link-icon/);
  assert.match(nav, /ib-link-label/);
  assert.match(nav, /ib-bn-icon/);
  assert.match(nav, /ib-bn-label/);
  assert.match(nav, /<a href="\/dashboard\.html" title="דשבורד" aria-label="דשבורד"><img id="ib-drawer-logo"/);
});

test('dashboard production queue uses production queue API source', () => {
  const dashboard = read('public/dashboard.html');

  assert.match(dashboard, /\/api\/production-queue/);
  assert.doesNotMatch(dashboard, /renderProdQueue\(dashData\.recentOrders\)/);
  assert.match(dashboard, /renderProdQueue\(productionQueue\.items \|\| \[\]\)/);
});

test('dashboard production KPIs use completed production weight, not order-created weight', () => {
  const dashboard = read('public/dashboard.html');

  assert.match(dashboard, /producedWeightToday/);
  assert.match(dashboard, /producedTonsToday/);
  assert.match(dashboard, /kpiWeightToday'\)\.textContent = producedWeightToday\.toFixed\(0\)/);
  assert.match(dashboard, /qsWeight'\)\.textContent = producedWeightToday\.toFixed\(0\)/);
  assert.doesNotMatch(dashboard, /kpiWeightToday'\)\.textContent = \(d\.totalWeightToday\|\|0\)/);
  assert.doesNotMatch(dashboard, /qsWeight'\)\.textContent = \(d\.totalWeightToday\|\|0\)/);
});

test('dashboard business widgets have data identity contracts', () => {
  const dashboard = read('public/dashboard.html');
  const contracts = require(path.join(root, 'public', 'data-contracts-client.js')).WIDGET_CONTRACTS;
  const requiredElements = [
    'kpiOrdersToday',
    'kpiWeightToday',
    'kpiInProd',
    'kpiDone',
    'kpiUrgent',
    'kpiWaste',
    'kpiPending',
    'kpiTonsToday',
    'qsWeight',
  ];

  assert.match(dashboard, /\/data-contracts-client\.js/);
  assert.match(dashboard, /applyDataContractBadges\(\)/);

  for (const elementId of requiredElements) {
    assert.match(dashboard, new RegExp(`id="${elementId}"`), `${elementId} should exist in dashboard`);
    const ownerContract = Object.values(contracts).find(contract => contract.consumers.includes(elementId));
    assert.ok(ownerContract, `${elementId} should have a data contract`);
    assert.ok(ownerContract.source.api, `${elementId} contract should name source API`);
    assert.ok(ownerContract.source.fields.length, `${elementId} contract should name source fields`);
    assert.ok(ownerContract.meaning, `${elementId} contract should explain meaning`);
  }
});

test('kiosk distinguishes missing work from untrusted machine state', () => {
  const kiosk = read('public/kiosk.html');

  assert.match(kiosk, /let stateHealth\s*=/);
  assert.match(kiosk, /async function apiJson/);
  assert.match(kiosk, /אין אמון בנתוני התחנה/);
  assert.match(kiosk, /canTrustState\s*\?\s*'אין עבודה פעילה'\s*:\s*'אין אמון בנתוני התחנה'/);
  assert.match(kiosk, /btnComplete'\)\.disabled = !hasJob \|\| !canTrustState/);
  assert.match(kiosk, /btnStop'\)\.disabled\s+= !activeShift \|\| !canTrustState/);
});

test('kiosk uses the light operational design language', () => {
  const kiosk = read('public/kiosk.html');

  assert.match(kiosk, /--bg:#f4f7fb/);
  assert.match(kiosk, /--panel:#ffffff/);
  assert.match(kiosk, /--panel-soft:#f8fafc/);
  assert.match(kiosk, /apple-mobile-web-app-status-bar-style" content="default"/);
  assert.doesNotMatch(kiosk, /--bg:#0d1117/);
  assert.doesNotMatch(kiosk, /black-translucent/);
});

test('reports screen uses authenticated APIs and escapes API-sourced table fields', () => {
  const reports = read('public/reports.html');

  assert.match(reports, /src="\/auth-client\.js"/);
  assert.match(reports, /src="\/safe-dom\.js"/);
  assert.match(reports, /\/api\/reports\/summary/);
  assert.match(reports, /\/api\/machines\/oee/);
  assert.match(reports, /escH\(w\.shape_name/);
  assert.match(reports, /escH\(c\.name/);
  assert.match(reports, /escH\(m\.order_num/);
  assert.match(reports, /escH\(m\.name/);
  assert.doesNotMatch(reports, /\$\{w\.shape_name/);
  assert.doesNotMatch(reports, /\$\{c\.name/);
  assert.doesNotMatch(reports, /\$\{m\.order_num/);
});

test('orders screen uses shared status transition contract', () => {
  const orders = read('public/orders.html');
  const statusClient = read('public/status-contracts-client.js');

  assert.match(statusClient, /window\.IronBendStatus/);
  assert.match(orders, /src="\/auth-client\.js"/);
  assert.match(orders, /\/status-contracts-client\.js/);
  assert.match(orders, /allowedOrderTransitions\(o\.status\)/);
  assert.match(orders, /setStatusAndClose/);
  assert.match(orders, /נדרשת התחברות מחדש כדי לאשר הזמנה/);
  assert.match(orders, /אין למשתמש הנוכחי הרשאה לאשר הזמנה/);
  assert.doesNotMatch(orders, /ok=>\{if\(ok\)closeDetailPanel/);
  assert.doesNotMatch(orders, /const statuses = \['/);
});

test('orders screen escapes API-sourced detail fields before innerHTML rendering', () => {
  const orders = read('public/orders.html');

  assert.match(orders, /escHtml\(o\.customer_name/);
  assert.match(orders, /escHtml\(o\.delivery_address\)/);
  assert.match(orders, /escHtml\(o\.driver_notes\)/);
  assert.match(orders, /escHtml\(item\.note\)/);
  assert.match(orders, /escHtml\(p\.package_code\)/);
  assert.match(orders, /jsArg\(p\.package_code\)/);
  assert.doesNotMatch(orders, /\$\{o\.driver_notes\}/);
  assert.doesNotMatch(orders, /\$\{item\.note\}/);
});

test('order creation success copy does not promise production before approval', () => {
  const index = read('public/index.html');

  assert.match(index, /ממתינה לאישור לפני ייצור/);
  assert.doesNotMatch(index, /נשלחה לתור הייצור/);
});

test('new order screen uses compact workspace layout with sticky summary', () => {
  const index = read('public/index.html');
  const intakeStart = index.indexOf('class="section order-import-section"');
  const customerStart = index.indexOf('id="customer-section"');
  const deliveryStart = index.indexOf('id="delivery-section"');
  const channelStart = index.indexOf('class="channel-selector"');
  const customerBlock = index.slice(customerStart, deliveryStart);

  assert.match(index, /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(320px,\s*0\.72fr\) 290px/);
  assert.match(index, /order-import-section/);
  assert.doesNotMatch(index, /<nav class="topnav">/);
  assert.match(index, /summary-order-number" id="orderNumDisplay"/);
  assert.ok(channelStart > intakeStart && channelStart < customerStart);
  assert.doesNotMatch(customerBlock, /channel-selector/);
  assert.doesNotMatch(customerBlock, /orderChannel/);
  assert.match(customerBlock, /href="\/customers\.html"/);
  assert.match(index, /#customer-section \{ grid-column: 1; \}/);
  assert.match(index, /#delivery-section \{ grid-column: 2; \}/);
  assert.match(index, /#items-section \{ grid-column: 1 \/ 3; \}/);
  assert.match(index, /\.summary-bar \{[\s\S]*position: sticky;[\s\S]*top: 72px/);
  assert.match(index, /@media \(max-width: 768px\)[\s\S]*\.main \{ display: flex; flex-direction: column/);
});

test('shape side count picker uses clear canonical silhouettes', () => {
  const editor = read('public/shape-editor.js');

  assert.match(editor, /function countPickerShapeSVG/);
  assert.match(editor, /1:\s*'קו ישר'/);
  assert.match(editor, /2:\s*'צורת L'/);
  assert.match(editor, /3:\s*'צורת ח'/);
  assert.match(editor, /4:\s*'ריבוע \/ מלבן'/);
  assert.match(editor, /5:\s*'מחומש'/);
  assert.match(editor, /6:\s*'משושה'/);
  assert.match(editor, /if \(n === 3\)[\s\S]*aria-label="צורת ח"/);
  assert.match(editor, /if \(n === 4\)[\s\S]*<rect/);
  assert.doesNotMatch(editor, /const ex = SHAPE_PRESETS\.find\(s => s\.sides\.length == n\)/);
});

test('shape editor opens in clean 2D mode and keeps 3D uncluttered', () => {
  const editor = read('public/shape-editor.js');

  assert.match(editor, /window\._seViewMode = '2d'/);
  assert.match(editor, /showBends: false/);
  assert.match(editor, /compactLabels: true/);
  assert.match(editor, /seReal3DToggle/);
  assert.match(editor, /_setReal3D/);
  assert.match(editor, /setPointerCapture/);
  assert.match(editor, /releasePointerCapture/);
  assert.match(editor, /lostpointercapture/);
  assert.doesNotMatch(editor, /3D XYZ/);
});

test('order OCR upload refreshes auth and shows localized permission errors', () => {
  const index = read('public/index.html');

  assert.match(index, /ensureOcrSession/);
  assert.match(index, /IronBendAuth\.refreshAccessToken/);
  assert.match(index, /OCR_AUTH_REQUIRED/);
  assert.match(index, /OCR_FORBIDDEN/);
  assert.match(index, /נדרשת התחברות מחדש לפני ניתוח תמונה/);
  assert.match(index, /אין למשתמש הנוכחי הרשאה לניתוח תמונה/);
  assert.match(index, /img-review-workspace/);
  assert.match(index, /img-source-canvas/);
  assert.match(index, /זוהו \$\{items\.length\} פריטים/);
  assert.doesNotMatch(index, /showImgError\('שגיאת תקשורת: ' \+ err\.message\)/);
});

test('machine assignment queue uses production queue source of truth', () => {
  const machine = read('public/machine.html');

  assert.match(machine, /src="\/auth-client\.js"/);
  assert.match(machine, /src="\/safe-dom\.js"/);
  assert.match(machine, /\/status-contracts-client\.js/);
  assert.match(machine, /ITEM_STATUS\.WAITING/);
  assert.match(machine, /ITEM_STATUS\.IN_PRODUCTION/);
  assert.match(machine, /ITEM_STATUS\.DONE/);
  assert.match(machine, /\/api\/production-queue/);
  assert.doesNotMatch(machine, /\/api\/orders\?status=/);
  assert.doesNotMatch(machine, /fetch\(`\/api\/orders\/\$\{o\.id\}`/);
  assert.match(machine, /escHtml\(item\.customerName/);
  assert.match(machine, /jsArg\(item\.orderNum\)/);
});

test('production queue screen uses shared item status contract', () => {
  const productionQueue = read('public/production-queue.html');

  assert.match(productionQueue, /\/status-contracts-client\.js/);
  assert.match(productionQueue, /src="\/safe-dom\.js"/);
  assert.match(productionQueue, /ITEM_STATUS\.WAITING/);
  assert.match(productionQueue, /ITEM_STATUS\.IN_PRODUCTION/);
  assert.match(productionQueue, /ITEM_STATUS\.DONE/);
  assert.match(productionQueue, /shift-tons'\)\.textContent = 'שגיאה'/);
  assert.doesNotMatch(productionQueue, /status:\s*'בייצור'/);
  assert.doesNotMatch(productionQueue, /status:\s*'הושלם'/);
  assert.match(productionQueue, /escHtml\(item\.customer_name/);
  assert.match(productionQueue, /jsArg\(item\.order_num\)/);
});

test('shop floor screens use shared item status values', () => {
  const kiosk = read('public/kiosk.html');
  const workerVisual = read('public/worker-visual.html');
  const nav = read('public/nav.js');
  const productionQueue = read('public/production-queue.html');

  assert.match(kiosk, /\/status-contracts-client\.js/);
  assert.match(kiosk, /ITEM_STATUS\.DONE/);
  assert.match(kiosk, /\/api\/kiosk\/operators/);
  assert.match(kiosk, /\/api\/auth\/login/);
  assert.match(kiosk, /IronBendAuth\.storeSession/);
  assert.match(kiosk, /username:\s*op\.username/);
  assert.doesNotMatch(kiosk, /\/api\/users/);
  assert.doesNotMatch(kiosk, /op\.pin/);
  assert.doesNotMatch(kiosk, /status:'הושלם'/);

  assert.match(workerVisual, /\/status-contracts-client\.js/);
  assert.match(workerVisual, /ITEM_STATUS\.IN_PRODUCTION/);
  assert.match(workerVisual, /ITEM_STATUS\.DONE/);
  assert.match(workerVisual, /ITEM_STATUS\.DELIVERED/);
  assert.match(workerVisual, /isOpenUShape/);
  assert.match(workerVisual, /data-shape-kind="worker-open-u"/);
  assert.match(workerVisual, /דשבורד איסוף כרטיסים/);
  assert.match(workerVisual, /הזמנות ממתינות/);
  assert.match(workerVisual, /כרטיסים/);
  assert.match(nav, /\/worker-visual\.html/);
  assert.match(nav, /דשבורד איסוף/);
  assert.match(productionQueue, /\/worker-visual\.html/);
});

test('price list management belongs to finance screen', () => {
  const admin = read('public/admin.html');
  const finance = read('public/finance.html');

  assert.doesNotMatch(admin, /tab-pricelist/);
  assert.doesNotMatch(admin, /loadPriceList/);
  assert.doesNotMatch(admin, /savePriceList/);
  assert.match(finance, /src="\/auth-client\.js"/);
  assert.match(finance, /src="\/safe-dom\.js"/);
  assert.match(finance, /loadSalesPriceList/);
  assert.match(finance, /saveSalesPriceList/);
  assert.match(finance, /\/api\/price-list/);
  assert.match(finance, /loadSteelPricesSafe/);
  assert.match(finance, /loadOrdersSafe/);
  assert.match(finance, /loadCustomersSafe/);
  assert.match(finance, /calcOrderCostSafe/);
  assert.match(finance, /escH\(c\.name/);
  assert.match(finance, /escH\(o\.order_num/);
});

test('driver management belongs to delivery admin screen', () => {
  const admin = read('public/admin.html');
  const deliveryAdmin = read('public/delivery-admin.html');
  const nav = read('public/nav.js');

  assert.doesNotMatch(admin, /tab-drivers/);
  assert.doesNotMatch(admin, /loadDriversAdmin/);
  assert.doesNotMatch(admin, /openDriverModal/);
  assert.doesNotMatch(admin, /driverModal/);
  assert.match(deliveryAdmin, /loadFleet/);
  assert.match(deliveryAdmin, /\/api\/vehicles\?all=1/);
  assert.match(deliveryAdmin, /\/api\/vehicles\/'\+id\+'\/documents/);
  assert.match(deliveryAdmin, /vehicleDocumentModal/);
  assert.match(deliveryAdmin, /driverVehicleId/);
  assert.match(deliveryAdmin, /\/api\/drivers\?all=1/);
  assert.match(deliveryAdmin, /\/api\/drivers/);
  assert.match(deliveryAdmin, /fleetKpis/);
  assert.match(deliveryAdmin, /vehicleSide/);
  assert.match(deliveryAdmin, /testExpiry/);
  assert.match(deliveryAdmin, /insuranceExpiry/);
  assert.match(deliveryAdmin, /nextServiceDate/);
  assert.match(deliveryAdmin, /\/events/);
  assert.match(deliveryAdmin, /expense_total/);
  assert.match(deliveryAdmin, /income_total/);
  assert.match(nav, /\/delivery-admin\.html/);
});

test('intake review and OCR training belong to intake screen', () => {
  const admin = read('public/admin.html');
  const intake = read('public/intake.html');
  const nav = read('public/nav.js');

  assert.doesNotMatch(admin, /tab-training/);
  assert.doesNotMatch(admin, /loadOcrTraining/);
  assert.doesNotMatch(admin, /saveOcrTraining/);
  assert.doesNotMatch(admin, /loadIntakeQueue/);
  assert.doesNotMatch(admin, /intakeApprove/);
  assert.doesNotMatch(admin, /intakeReject/);
  assert.match(intake, /loadOcrTraining/);
  assert.match(intake, /saveOcrTraining/);
  assert.match(intake, /loadIntakeQueue/);
  assert.match(intake, /מרכז קליטת הזמנות/);
  assert.match(intake, /הכנסה ידנית לתור/);
  assert.match(intake, /saveManualIntake/);
  assert.match(intake, /manualIntakeText/);
  assert.match(intake, /תור לאישור לפי דחיפות/);
  assert.match(intake, /urgencyInfo/);
  assert.match(intake, /sortIntakeRows/);
  assert.match(intake, /order-metrics/);
  assert.match(intake, /סינון לפי מקור/);
  assert.match(intake, /customer_match/);
  assert.match(intake, /searchCustomerForIntake/);
  assert.match(intake, /\/api\/customers\?q=/);
  assert.match(intake, /customer_id/);
  assert.match(intake, /\/api\/intake\/training/);
  assert.match(intake, /\/api\/intake\/log\?status=pending_review/);
  assert.match(nav, /\/intake\.html/);
});

test('intake OCR review requires source-versus-parsed comparison', () => {
  const intake = read('public/intake.html');
  const route = read('routes/intake.js');
  const server = read('server.js');

  assert.match(intake, /intakeCompareModal/);
  assert.match(intake, /openIntakeCompare/);
  assert.match(intake, /intakeSourceHtml/);
  assert.match(intake, /intakeReviewTable/);
  assert.match(intake, /השוואה במסך מלא/);
  assert.match(intake, /אשר אחרי בדיקה/);
  assert.match(route, /original_data_url/);
  assert.match(route, /original_mime/);
  assert.match(server, /addCol\('intake_log', 'original_data_url'/);
});

test('admin OCR settings describe OpenAI intake instead of Google Vision', () => {
  const admin = read('public/admin.html');
  const adminRoute = read('routes/admin.js');
  const server = read('server.js');

  assert.match(admin, /OpenAI \/ GPT OCR/);
  assert.match(admin, /OPENAI_API_KEY/);
  assert.match(admin, /OPENAI_API_KEY_LOCAL/);
  assert.match(admin, /OPENAI_MODEL/);
  assert.match(admin, /INTAKE_AI_ENABLED/);
  assert.doesNotMatch(admin, /Google Vision OCR/);
  assert.doesNotMatch(admin, /Google Vision API Key/);
  assert.match(adminRoute, /'OPENAI_API_KEY','OPENAI_MODEL','INTAKE_AI_ENABLED'/);
  assert.match(server, /function getOpenAiApiKey/);
  assert.match(server, /OPENAI_API_KEY_LOCAL/);
});

test('order numbers are allocated from a DB sequence instead of order count', () => {
  const server = read('server.js');
  const orderNumbers = read('services/orderNumbers.js');
  const generateOrderNumStart = server.indexOf('const generateOrderNum');
  const generateOrderNumEnd = server.indexOf('function checkOrderComplete', generateOrderNumStart);
  const generateOrderNumSource = server.slice(generateOrderNumStart, generateOrderNumEnd);

  assert.match(server, /CREATE TABLE IF NOT EXISTS order_sequences/);
  assert.match(server, /createOrderNumberAllocator\(db\)/);
  assert.match(orderNumbers, /function ensureOrderSequence/);
  assert.match(orderNumbers, /const nextOrderNumTx = db\.transaction/);
  assert.match(orderNumbers, /UPDATE order_sequences\s+SET next_value=next_value\+1/);
  assert.doesNotMatch(generateOrderNumSource, /COUNT\(\*\).*FROM orders/s);
});

test('large operational list endpoints use server-side pagination', () => {
  const server = read('server.js');
  const orderRoutes = read('routes/orders.js');
  const ordersStart = orderRoutes.indexOf("router.get('/orders'");
  const ordersEnd = orderRoutes.indexOf("router.get('/orders/:id'", ordersStart);
  const ordersSource = orderRoutes.slice(ordersStart, ordersEnd);
  const inventoryRoutes = read('routes/inventory.js');
  const inventoryStart = inventoryRoutes.indexOf("router.get('/inventory'");
  const inventoryEnd = inventoryRoutes.indexOf("router.get('/inventory/summary'", inventoryStart);
  const inventorySource = inventoryRoutes.slice(inventoryStart, inventoryEnd);

  assert.match(server, /function listPage/);
  assert.match(ordersSource, /listPage\(req\.query/);
  assert.match(ordersSource, /LIMIT \? OFFSET \?/);
  assert.match(inventorySource, /listPage\(req\.query/);
  assert.match(inventorySource, /LIMIT \? OFFSET \?/);
});

test('machine and workstation setup belong to production setup screen', () => {
  const admin = read('public/admin.html');
  const setup = read('public/production-setup.html');
  const server = read('server.js');
  const nav = read('public/nav.js');

  assert.doesNotMatch(admin, /tab-machines/);
  assert.doesNotMatch(admin, /tab-workstations/);
  assert.doesNotMatch(admin, /loadMachinesAdmin/);
  assert.doesNotMatch(admin, /saveMachinesAdmin/);
  assert.doesNotMatch(admin, /openAddMachineModal/);
  assert.doesNotMatch(admin, /loadWorkstations/);
  assert.doesNotMatch(admin, /saveWorkstations/);
  assert.match(setup, /loadMachinesAdmin/);
  assert.match(setup, /saveMachinesAdmin/);
  assert.match(setup, /loadWorkstations/);
  assert.match(setup, /\/api\/machines/);
  assert.match(setup, /single_min_diameter/);
  assert.match(setup, /single_max_diameter/);
  assert.match(setup, /double_min_diameter/);
  assert.match(setup, /double_max_diameter/);
  assert.match(setup, /חוט בודד/);
  assert.match(setup, /חוט כפול/);
  assert.match(server, /single_min_diameter/);
  assert.match(server, /double_max_diameter/);
  assert.match(nav, /\/production-setup\.html/);
});

test('platform admin quick links target module admin surfaces', () => {
  const admin = read('public/admin.html');

  assert.match(admin, /\/intake\.html/);
  assert.match(admin, /\/customers\.html/);
  assert.match(admin, /\/finance\.html/);
  assert.match(admin, /\/delivery-admin\.html/);
  assert.match(admin, /\/production-setup\.html/);
  assert.doesNotMatch(admin, /href="\/machine\.html"/);
  assert.doesNotMatch(admin, /href="\/kiosk\.html"/);
  assert.doesNotMatch(admin, /href="\/driver\.html"/);
  assert.doesNotMatch(admin, /class="topnav"/);
  assert.doesNotMatch(admin, /\.machines-table/);
  assert.doesNotMatch(admin, /\.ws-card/);
});

test('platform admin exposes role permission management', () => {
  const admin = read('public/admin.html');

  assert.match(admin, /tab-permissions/);
  assert.match(admin, /ניהול הרשאות/);
  assert.match(admin, /PERMISSION_ROLES/);
  assert.match(admin, /openInitialTabFromUrl/);
  for (const role of ['admin', 'manager', 'office', 'warehouse', 'production', 'kiosk', 'sales', 'finance', 'quality', 'maintenance', 'driver']) {
    assert.match(admin, new RegExp(`value="${role}"|role:'${role}'`));
  }
});

test('platform admin exposes module maturity control board', () => {
  const admin = read('public/admin.html');

  assert.match(admin, /בקרת מודולים/);
  assert.match(admin, /moduleStatusGrid/);
  assert.match(admin, /module-card/);
  assert.match(admin, /status:'partial'/);
  assert.match(admin, /status:'frozen'/);
  assert.match(admin, /risk:'high'/);
  assert.match(admin, /MODULE_PLATFORM_CORE/);
  assert.match(admin, /MODULE_VENDOR_CONTROL/);
  assert.match(admin, /Vendor Control \/ בקרה מרחוק/);
  assert.match(admin, /אין גישה חופשית לנתוני לקוח/);
  assert.match(admin, /MODULE_ORDERS/);
  assert.match(admin, /MODULE_PRODUCTION/);
  assert.match(admin, /MODULE_INVENTORY/);
  assert.match(admin, /MODULE_FLEET/);
  assert.match(admin, /MODULE_FINANCE/);
  assert.match(admin, /MODULE_QUALITY/);
  assert.match(admin, /MODULE_PORTALS/);
  assert.match(admin, /הפעלה טכנית לא אומרת שהמודול בשל למכירה/);
});

test('platform admin ERP connectors do not advertise unavailable demo actions', () => {
  const admin = read('public/admin.html');

  assert.doesNotMatch(admin, /placeholder="demo"/);
  assert.doesNotMatch(admin, /alert\('בפיתוח'\)/);
  assert.match(admin, /id="erp-sap" disabled/);
  assert.match(admin, /id="erp-maven" disabled/);
  assert.match(admin, /מחבר רשמי בתכנון/);
});

test('procurement screen is API-backed and no longer a demo stub', () => {
  const procurement = read('public/procurement.html');

  assert.match(procurement, /src="\/auth-client\.js"/);
  assert.match(procurement, /src="\/safe-dom\.js"/);
  assert.match(procurement, /loadProcurementData/);
  assert.match(procurement, /\/api\/purchase-orders/);
  assert.match(procurement, /\/api\/suppliers/);
  assert.match(procurement, /\/api\/steel-prices/);
  assert.match(procurement, /normalizePO/);
  assert.match(procurement, /normalizeSupplier/);
  assert.doesNotMatch(procurement, /BUG-47/);
  assert.doesNotMatch(procurement, /coming soon banner/);
  assert.doesNotMatch(procurement, /demo data/);
  assert.doesNotMatch(procurement, /fallback to demo/i);
});

test('warehouse screen is API-backed and does not mask failures with mock logistics data', () => {
  const warehouse = read('public/warehouse.html');

  assert.match(warehouse, /src="\/auth-client\.js"/);
  assert.match(warehouse, /src="\/safe-dom\.js"/);
  assert.match(warehouse, /\/api\/packages/);
  assert.match(warehouse, /\/api\/deliveries/);
  assert.match(warehouse, /\/api\/suppliers/);
  assert.match(warehouse, /\/api\/inventory/);
  assert.doesNotMatch(warehouse, /getMockPackages/);
  assert.doesNotMatch(warehouse, /getMockDeliveries/);
  assert.doesNotMatch(warehouse, /getMockSuppliers/);
  assert.doesNotMatch(warehouse, /getMockReceipts/);
  assert.doesNotMatch(warehouse, /Mock success/i);
  assert.doesNotMatch(warehouse, /Use mock data/i);
});

test('inventory screen is authenticated and covered by safe API loading', () => {
  const inventory = read('public/inventory.html');
  const intake = read('public/intake.html');
  const inventoryRoutes = read('routes/inventory.js');

  assert.match(inventory, /src="\/auth-client\.js"/);
  assert.match(inventory, /src="\/safe-dom\.js"/);
  assert.match(inventory, /\/api\/inventory\/summary/);
  assert.match(inventory, /\/api\/inventory/);
  assert.match(inventory, /\/api\/suppliers/);
  assert.match(inventory, /\/api\/waste\/summary/);
  assert.match(inventory, /value="bent"/);
  assert.match(inventory, /bending_shape_segments/);
  assert.match(inventory, /\/api\/inventory\/analyze-bending-shape/);
  assert.match(inventory, /\/api\/inventory\/receipt-reviews/);
  assert.match(inventory, /receiptSourcePreview/);
  assert.match(inventory, /receiptCompareModal/);
  assert.match(inventory, /openReceiptCompare/);
  assert.match(inventory, /receipt-fullscreen/);
  assert.match(inventory, /השוואה במסך מלא/);
  assert.match(inventory, /approveReceiptReview/);
  assert.match(inventory, /parseBendingShapeSegments/);
  assert.match(inventory, /renderShapePreview/);
  assert.match(inventory, /ocrSetupMessage/);
  assert.match(inventory, /insufficient_quota/);
  assert.match(inventory, /Billing ב-OpenAI/);
  assert.match(intake, /value="bending_shape"/);
  assert.match(inventoryRoutes, /getIntakeTrainingGuidance\(12, \['bending_shape', 'bar_schedule', 'general'\]\)/);
  assert.match(inventory, /חסר OpenAI API Key/);
  assert.match(inventory, /OCR כבוי/);
  assert.match(inventory, /IronBendSafe\.escapeHtml/);
  assert.match(inventory, /שגיאה בטעינת ספקים/);
  assert.doesNotMatch(inventory, /mock[A-Z]/);
  assert.doesNotMatch(inventory, /demo data/i);
});

test('local server command skips startup snapshot outside production', () => {
  const server = read('server.js');
  const pkg = JSON.parse(read('package.json'));
  const localStart = read('scripts/start-local.js');

  assert.match(server, /SKIP_STARTUP_DB_SNAPSHOT/);
  assert.match(server, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(server, /AUTH_BYPASS.*NODE_ENV !== 'production'/);
  assert.equal(pkg.scripts['start:local'], 'node scripts/start-local.js');
  assert.match(localStart, /PORT.*3100/);
  assert.match(localStart, /SKIP_STARTUP_DB_SNAPSHOT/);
  assert.match(localStart, /AUTH_BYPASS/);
  assert.match(localStart, /AUTH_BYPASS_ROLE/);
});

test('supplier portal is frozen instead of serving demo supplier data', () => {
  const supplier = read('public/supplier.html');

  assert.match(supplier, /פורטל הספקים מוקפא/);
  assert.match(supplier, /מסך הרכש הפנימי/);
  assert.doesNotMatch(supplier, /DEMO_SUPPLIERS/);
  assert.doesNotMatch(supplier, /SUP-042/);
  assert.doesNotMatch(supplier, /supplier_code/);
  assert.doesNotMatch(supplier, /\/api\/purchase-orders\/' \+ activePO \+ '\/eta/);
  assert.doesNotMatch(supplier, /method: 'POST',\s*body: fd/);
});

test('driver portal uses authenticated API calls and server delivery statuses', () => {
  const driver = read('public/driver.html');

  const authIndex = driver.indexOf('src="/auth-client.js"');
  const safeIndex = driver.indexOf('src="/safe-dom.js"');
  const navIndex = driver.indexOf('src="/nav.js"');

  assert.notEqual(authIndex, -1, 'driver should load auth-client.js');
  assert.notEqual(safeIndex, -1, 'driver should load safe-dom.js');
  assert.notEqual(navIndex, -1, 'driver should load nav.js');
  assert.ok(authIndex < navIndex, 'driver should load auth before nav');
  assert.match(driver, /DELIVERY_STATUS/);
  assert.match(driver, /PLANNED: 'מתוכנן'/);
  assert.match(driver, /\[DELIVERY_STATUS\.WAITING, DELIVERY_STATUS\.PLANNED\]\.includes/);
  assert.match(driver, /escHtml\(d\.order_num\)/);
  assert.match(driver, /escHtml\(d\.delivery_address \|\| 'לא הוזנה'\)/);
  assert.doesNotMatch(driver, /selectDriver\(\$\{JSON\.stringify/);
});

test('maintenance screen is API-backed and no longer falls back to mock maintenance data', () => {
  const maintenance = read('public/maintenance.html');

  assert.match(maintenance, /src="\/auth-client\.js"/);
  assert.match(maintenance, /src="\/safe-dom\.js"/);
  assert.match(maintenance, /\/api\/maintenance/);
  assert.match(maintenance, /\/api\/loto/);
  assert.match(maintenance, /\/api\/pm-schedule/);
  assert.doesNotMatch(maintenance, /BUG-47/);
  assert.doesNotMatch(maintenance, /coming soon banner/);
  assert.doesNotMatch(maintenance, /mockMachines/);
  assert.doesNotMatch(maintenance, /mockStats/);
  assert.doesNotMatch(maintenance, /mockLogs/);
  assert.doesNotMatch(maintenance, /mockLoto/);
  assert.doesNotMatch(maintenance, /mockPm/);
});

test('projects screen is API-backed and no longer owns finance credit workflows', () => {
  const projects = read('public/projects.html');

  assert.match(projects, /src="\/auth-client\.js"/);
  assert.match(projects, /src="\/safe-dom\.js"/);
  assert.match(projects, /\/api\/projects/);
  assert.match(projects, /\/api\/sites/);
  assert.doesNotMatch(projects, /BUG-47/);
  assert.doesNotMatch(projects, /coming soon banner/);
  assert.doesNotMatch(projects, /\/api\/credit/);
  assert.doesNotMatch(projects, /creditTable/);
  assert.doesNotMatch(projects, /openCreditModal/);
  assert.doesNotMatch(projects, /מסגרות אשראי/);
});

test('war room is API-backed and does not fall back to local mock incidents', () => {
  const warroom = read('public/warroom.html');

  assert.match(warroom, /src="\/auth-client\.js"/);
  assert.match(warroom, /src="\/safe-dom\.js"/);
  assert.match(warroom, /\/api\/incidents/);
  assert.match(warroom, /\/api\/machines/);
  assert.match(warroom, /normalizeIncident/);
  assert.match(warroom, /update_text/);
  assert.doesNotMatch(warroom, /BUG-47/);
  assert.doesNotMatch(warroom, /coming soon banner/);
  assert.doesNotMatch(warroom, /MOCK_/);
  assert.doesNotMatch(warroom, /local-\'+Date\.now/);
  assert.doesNotMatch(warroom, /API not available/);
  assert.doesNotMatch(warroom, /timelineEntry/);
});

test('quality screen is API-backed and does not fall back to local NCR or CAPA demo data', () => {
  const quality = read('public/quality.html');
  const qualityRoute = read('routes/quality.js');

  assert.match(quality, /src="\/auth-client\.js"/);
  assert.match(quality, /src="\/safe-dom\.js"/);
  assert.match(quality, /\/api\/quality/);
  assert.match(quality, /\/api\/ncr/);
  assert.match(quality, /\/api\/capa/);
  assert.match(quality, /normalizeNCR/);
  assert.match(quality, /normalizeCAPA/);
  assert.match(quality, /return false/);
  assert.doesNotMatch(quality, /Generate local IDs for demo/);
  assert.doesNotMatch(quality, /seedNCR/);
  assert.doesNotMatch(quality, /seedCAPA/);
  assert.doesNotMatch(quality, /_ncrSeq/);
  assert.doesNotMatch(quality, /_capaSeq/);
  assert.doesNotMatch(quality, /NCR-101/);
  assert.doesNotMatch(quality, /CAPA-201/);
  assert.doesNotMatch(quality, /ncrList\.unshift/);
  assert.doesNotMatch(quality, /capaList\.unshift/);
  assert.match(qualityRoute, /verification_method = COALESCE/);
});

test('shared navigation exposes modules converted from stubs', () => {
  const nav = read('public/nav.js');

  assert.match(nav, /\/projects\.html/);
  assert.match(nav, /\/warroom\.html/);
  assert.match(nav, /\/maintenance\.html/);
  assert.match(nav, /\/quality\.html/);
  assert.doesNotMatch(nav, /warroom removed \(stub\)/);
  assert.doesNotMatch(nav, /stub pages hidden/);
});


test('server hardens production auth and websocket upgrades', () => {
  const server = read('server.js');
  const authClient = read('public/auth-client.js');
  const wsClients = [
    'public/dashboard.html',
    'public/kiosk.html',
    'public/machine.html',
    'public/orders.html',
    'public/worker-visual.html',
  ];

  assert.match(server, /const helmet\s+=\s+require\('helmet'\)/);
  assert.match(server, /app\.use\(helmet\(\{ contentSecurityPolicy: false \}\)\)/);
  assert.match(server, /STRICT_SECRET_ENVS = new Set\(\['production', 'staging'\]\)/);
  assert.match(server, /JWT_SECRET is required in production\/staging/);
  assert.match(server, /new WebSocketServer\(\{ noServer: true \}\)/);
  assert.match(server, /server\.on\('upgrade'/);
  assert.match(server, /authService\.verifyAccessToken\(token\)/);
  assert.match(server, /HTTP\/1\.1 401 Unauthorized/);
  assert.match(authClient, /function webSocketUrl/);
  assert.match(authClient, /searchParams\.set\('token', token\)/);

  for (const file of wsClients) {
    assert.match(read(file), /IronBendAuth\?\.webSocketUrl/, file);
  }
});
