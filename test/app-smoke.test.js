const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-smoke-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'smoke.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

let baseUrl;

function seedUser(username, role, pin) {
  db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString());
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function token(username, pin) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

test('core app smoke loads critical screens and authenticated APIs', async (t) => {
  seedUser('admin-smoke', 'admin', '9001');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const htmlScreens = [
    '/login.html',
    '/admin.html',
    '/customers.html',
    '/dashboard.html',
    '/reports.html',
    '/orders.html',
    '/machine.html',
    '/production-queue.html',
    '/kiosk.html',
    '/worker-visual.html',
    '/intake.html',
    '/production-setup.html',
    '/finance.html',
    '/pricing.html',
    '/projects.html',
    '/procurement.html',
    '/warroom.html',
    '/quality.html',
    '/inventory.html',
    '/warehouse.html',
    '/delivery-admin.html',
    '/driver.html',
    '/maintenance.html',
    '/customer.html',
    '/portal.html',
  ];

  for (const screen of htmlScreens) {
    const response = await request(screen);
    assert.equal(response.status, 200, `${screen} should load`);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(await response.text(), /<html/i);
  }

  for (const asset of ['/auth-client.js', '/nav.js', '/safe-dom.js', '/status-contracts-client.js', '/theme.css']) {
    const response = await request(asset);
    assert.equal(response.status, 200, `${asset} should load`);
  }

  const admin = await token('admin-smoke', '9001');
  const endpoints = [
    '/api/settings',
    '/api/dashboard',
    '/api/production-queue',
    '/api/customers',
    '/api/pricing/price-books',
    '/api/audit-log',
  ];

  for (const endpoint of endpoints) {
    const response = await request(endpoint, { headers: authHeaders(admin) });
    assert.equal(response.status, 200, `${endpoint} should work for admin`);
    await response.json();
  }

  const bentInventory = {
    material_type: 'bent',
    diameter: 10,
    weight_received: 120,
    received_date: '2026-06-02',
    bending_shape_name: 'U - אסדה',
    bending_shape_segments: [
      { length_mm: 300, angle_deg: 90 },
      { length_mm: 600, angle_deg: 90 },
      { length_mm: 300, angle_deg: 180 },
    ],
  };
  const createBent = await request('/api/inventory', {
    method: 'POST',
    headers: authHeaders(admin),
    body: JSON.stringify(bentInventory),
  });
  assert.equal(createBent.status, 200);
  const bentRows = await (await request('/api/inventory', { headers: authHeaders(admin) })).json();
  const savedBent = bentRows.find(row => row.material_type === 'bent');
  assert.ok(savedBent);
  assert.equal(savedBent.bending_shape_name, 'U - אסדה');
  assert.match(savedBent.bending_shape_segments, /length_mm/);

  const reviewPayload = {
    supplier_name: 'Smoke Supplier',
    delivery_note_num: 'DN-SMOKE-1',
    received_date: '2026-06-02',
    items: [{
      material_type: 'coil',
      diameter: 12,
      lot_number: 'HEAT-SMOKE',
      certificate_num: 'CERT-SMOKE',
      grade: 'B500B',
      weight_kg: 250,
      purchase_price: 3800,
      warehouse_loc: 'A1',
      shape_name: null,
      segments: [],
      confidence: 0.91,
      notes: null,
    }],
    notes: 'smoke review',
  };
  const reviewId = db.prepare(`
    INSERT INTO inventory_receipt_reviews
      (original_filename,original_mime,original_data_url,supplier_name,delivery_note_num,parsed_data,status)
    VALUES (?,?,?,?,?,?,?)
  `).run('smoke.png', 'image/png', 'data:image/png;base64,AA==', 'Smoke Supplier', 'DN-SMOKE-1', JSON.stringify(reviewPayload), 'pending_review').lastInsertRowid;
  const approveReview = await request(`/api/inventory/receipt-reviews/${reviewId}/approve`, {
    method: 'POST',
    headers: authHeaders(admin),
    body: JSON.stringify({ notes: 'smoke approved' }),
  });
  assert.equal(approveReview.status, 200);
  const reviewResult = await approveReview.json();
  assert.equal(reviewResult.raw_material_ids.length, 1);
  const approvedMaterial = db.prepare('SELECT * FROM raw_material WHERE id=?').get(reviewResult.raw_material_ids[0]);
  assert.equal(approvedMaterial.lot_number, 'HEAT-SMOKE');
  assert.equal(approvedMaterial.weight_received, 250);

  const stockOrder = await request('/api/orders', {
    method: 'POST',
    headers: authHeaders(admin),
    body: JSON.stringify({
      customer: { name: 'Stock Smoke', phone: '050-9000000' },
      order: { channel: 'manual', totalWeight: 4, inventoryAllocationPolicy: 'auto_fifo' },
      pallets: [{ totalWeight: 4, items: [{ shapeId: 's1', shapeName: 'straight', diameter: 12, length: 1000, qty: 4 }] }],
    }),
  });
  assert.equal(stockOrder.status, 200);
  const stockOrderBody = await stockOrder.json();
  const usedAfterOrder = db.prepare('SELECT weight_used FROM raw_material WHERE id=?').get(reviewResult.raw_material_ids[0]).weight_used;
  assert.ok(usedAfterOrder > 0, 'order should consume matching inventory by default');
  const usageRow = db.prepare('SELECT * FROM raw_material_usage WHERE order_id=?').get(stockOrderBody.orderId);
  assert.equal(usageRow.raw_material_id, reviewResult.raw_material_ids[0]);

  const shortageOrder = await request('/api/orders', {
    method: 'POST',
    headers: authHeaders(admin),
    body: JSON.stringify({
      customer: { name: 'Shortage Smoke', phone: '050-9000001' },
      order: { channel: 'manual', totalWeight: 10, inventoryAllocationPolicy: 'auto_fifo' },
      pallets: [{ totalWeight: 10, items: [{ shapeId: 's2', shapeName: 'straight', diameter: 32, length: 1000, qty: 10 }] }],
    }),
  });
  assert.equal(shortageOrder.status, 200);
  const shortageBody = await shortageOrder.json();
  assert.equal(shortageBody.inventoryShortages.length, 1);
  assert.equal(shortageBody.inventoryShortages[0].diameter, 32);
  const shortageAlert = db.prepare('SELECT * FROM alerts WHERE type=? AND order_id=?').get('inventory_shortage', shortageBody.orderId);
  assert.ok(shortageAlert, 'stock shortage should create an alert');
  const procurementRequest = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(shortageBody.inventoryShortages[0].purchase_order_id);
  assert.equal(procurementRequest.status, 'inventory_shortage');
  assert.equal(procurementRequest.diameter, 32);
  assert.ok(procurementRequest.quantity_ton > 0, 'procurement request should include required purchase quantity');
  const manualIntake = await request('/api/intake/parse-text', {
    method: 'POST',
    headers: authHeaders(admin),
    body: JSON.stringify({ source: 'phone', text: 'מאיר 050-1234567\n03/06/2026\n12 6000 4' }),
  });
  assert.equal(manualIntake.status, 200);
  const manualIntakeBody = await manualIntake.json();
  assert.equal(manualIntakeBody.success, true);
  assert.equal(manualIntakeBody.item_count, 1);
  const savedIntake = db.prepare('SELECT * FROM intake_log WHERE id=?').get(manualIntakeBody.id);
  assert.equal(savedIntake.status, 'pending_review');
});
