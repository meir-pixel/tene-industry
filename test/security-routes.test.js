const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-security-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');
const statusContracts = require('../status-contracts');
const dataContracts = require('../public/data-contracts-client.js');

let baseUrl;

function seedUser(username, role, pin) {
  db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString());
}

function seedCustomer() {
  return db.prepare(`
    INSERT INTO customers (name,phone,email,price_tier,discount_pct)
    VALUES (?,?,?,?,?)
  `).run('Security Test Customer', '0500000000', 'security@example.com', 'retail', 0).lastInsertRowid;
}

function seedPortalCustomer(name, phone, tokenValue) {
  return db.prepare(`
    INSERT INTO customers (name,phone,portal_token,price_tier,discount_pct)
    VALUES (?,?,?,?,?)
  `).run(name, phone, tokenValue, 'retail', 0).lastInsertRowid;
}

function seedPortalOrder(customerId, orderNum, status = 'ממתינה לאישור לקוח') {
  return db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,status,portal_order,portal_price)
    VALUES (?,?,?,?,?,?)
  `).run(orderNum, customerId, 'פורטל לקוח', status, 1, 100).lastInsertRowid;
}


function seedPortalUser(customerId, phone, role = 'orderer', tokenValue = `portal-user-${Date.now()}`) {
  db.prepare(`
    INSERT INTO portal_users (customer_id,phone,name,role,active,token,token_expires_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(customerId, phone, phone, role, 1, tokenValue, new Date(Date.now() + 86400000).toISOString());
  return tokenValue;
}

function seedInternalOrder(customerId, orderNum = `ORDER-${Date.now()}`) {
  return db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,status,total_weight,billing_weight)
    VALUES (?,?,?,?,?,?)
  `).run(orderNum, customerId, 'משרד', 'ממתינה לאישור', 0, 0).lastInsertRowid;
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

function shapeV2Envelope() {
  return {
    contractVersion: 2,
    shapeVersion: 7,
    shapeId: 'shape-v2-u-001',
    shapeType: 'u_bar',
    family: 'steel_rebar',
    displayName: 'Shape V2 U bar',
    data: {
      diameter: 12,
      sides: [350, 1200, 350],
      angles: [90, 90],
    },
    calculated: {
      totalLengthMm: 1900,
      weightKg: 1.69,
      bendCount: 2,
    },
    machineOutput: {
      generic: {
        diameter: 12,
        totalLengthMm: 1900,
        bendCount: 2,
        segments: [
          { index: 1, lengthMm: 350, bendAfterDeg: 90 },
          { index: 2, lengthMm: 1200, bendAfterDeg: 90 },
          { index: 3, lengthMm: 350, bendAfterDeg: null },
        ],
      },
      machineProfiles: {
        MEP: { program: [] },
        PEDAX: { program: [] },
        SCHNELL: { program: [] },
      },
    },
    validation: {
      valid: true,
      errors: [],
    },
  };
}

test('protected P0 routes enforce JWT roles over HTTP', async (t) => {
  seedUser('admin', 'admin', '1001');
  seedUser('manager', 'manager', '1002');
  seedUser('office', 'office', '1003');
  seedUser('production', 'production', '1004');
  seedUser('finance', 'finance', '1005');
  seedUser('kiosk', 'operator', '1006');
  seedUser('warehouse', 'warehouse', '1007');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const admin = await token('admin', '1001');
  const manager = await token('manager', '1002');
  const office = await token('office', '1003');
  const production = await token('production', '1004');
  const finance = await token('finance', '1005');
  const kiosk = await token('kiosk', '1006');
  const warehouse = await token('warehouse', '1007');

  await t.test('users require admin', async () => {
    assert.equal((await request('/api/users')).status, 401);
    assert.equal((await request('/api/users', { headers: { 'x-user-role': 'admin' } })).status, 401);
    assert.equal((await request('/api/users', { headers: authHeaders(manager) })).status, 403);
    assert.equal((await request('/api/users', { headers: authHeaders(admin) })).status, 200);
  });

  await t.test('kiosk operator list is scoped and never exposes PIN data', async () => {
    assert.equal((await request('/api/kiosk/operators')).status, 401);
    assert.equal((await request('/api/kiosk/operators', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/kiosk/operators', { headers: authHeaders(kiosk) })).status, 200);
    assert.equal((await request('/api/kiosk/operators', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/kiosk/operators', { headers: authHeaders(admin) })).status, 200);

    const response = await request('/api/kiosk/operators', { headers: authHeaders(kiosk) });
    const body = await response.json();
    assert.ok(body.length >= 1);
    assert.equal(Object.hasOwn(body[0], 'pin'), false);
    assert.equal(Object.hasOwn(body[0], 'pin_hash'), false);
  });

  await t.test('settings require admin', async () => {
    assert.equal((await request('/api/settings')).status, 401);
    assert.equal((await request('/api/settings', { headers: authHeaders(manager) })).status, 403);
    assert.equal((await request('/api/settings', { headers: authHeaders(admin) })).status, 200);
  });

  await t.test('audit log allows manager but rejects office', async () => {
    assert.equal((await request('/api/audit-log')).status, 401);
    assert.equal((await request('/api/audit-log', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/audit-log', { headers: authHeaders(manager) })).status, 200);
  });

  await t.test('admin database download requires admin', async () => {
    assert.equal((await request('/api/admin/database/download')).status, 401);
    assert.equal((await request('/api/admin/database/download', { headers: authHeaders(manager) })).status, 403);
    assert.equal((await request('/api/admin/database/download', { headers: authHeaders(admin) })).status, 200);
  });

  await t.test('admin database upload reaches maintenance gate only for admin', async () => {
    assert.equal((await request('/api/admin/database/upload', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/admin/database/upload', { method: 'POST', headers: authHeaders(manager) })).status, 403);

    const response = await request('/api/admin/database/upload', { method: 'POST', headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Database upload is disabled/);
  });

  await t.test('data audit is manager scoped and reports order item counts', async () => {
    const customerId = seedCustomer();
    const orderId = seedInternalOrder(customerId, 'AUDIT-ORDER-1');
    const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,?,?)')
      .run(orderId, 1, 12.5).lastInsertRowid;
    db.prepare(`
      INSERT INTO items (pallet_id,shape_id,shape_name,diameter,total_length_mm,quantity,weight_per_unit,total_weight,status,machine)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(palletId, 's1', 'straight', 12, 1000, 2, 0.888, 1.776, 'ממתין', 'A');

    assert.equal((await request('/api/admin/data-audit')).status, 401);
    assert.equal((await request('/api/admin/data-audit', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/admin/data-audit', { headers: authHeaders(manager) })).status, 200);

    const response = await request('/api/admin/data-audit?limit=5', { headers: authHeaders(admin) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(body.summary.orders >= 1);
    assert.ok(body.recent_orders.some(order => order.order_num === 'AUDIT-ORDER-1' && order.item_count === 1));
  });

  await t.test('auth logout requires an active session signal', async () => {
    assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  });

  await t.test('finance route allows finance but rejects office', async () => {
    assert.equal((await request('/api/finance/kpis')).status, 401);
    assert.equal((await request('/api/finance/kpis', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/finance/kpis', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/orders/1/costs/snapshots')).status, 401);
    assert.equal((await request('/api/orders/1/costs/snapshots', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/orders/1/costs/snapshots', { headers: authHeaders(finance) })).status, 200);
  });

  await t.test('order mutation allows office but rejects viewer', async () => {
    const body = JSON.stringify({});
    assert.equal((await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await request('/api/orders', { method: 'POST', headers: authHeaders(production), body })).status, 403);
    assert.notEqual((await request('/api/orders', { method: 'POST', headers: authHeaders(office), body })).status, 401);
    assert.notEqual((await request('/api/orders', { method: 'POST', headers: authHeaders(office), body })).status, 403);
  });

  await t.test('order creation stores selected customer site only for that customer', async () => {
    const customerId = seedCustomer();
    const siteId = db.prepare('INSERT INTO customer_sites (customer_id,name,address,status) VALUES (?,?,?,?)')
      .run(customerId, 'Site A', 'Site A address', 'active').lastInsertRowid;
    const response = await request('/api/orders', {
      method: 'POST',
      headers: authHeaders(office),
      body: JSON.stringify({
        customer: { id: customerId, name: 'Security Test Customer', phone: '0500000000' },
        order: { orderNum: 'ORDER-SITE-BOUND', channel: 'office', deliveryAddress: 'Site A address', siteId, totalWeight: 0 },
        pallets: [{ items: [{ shapeName: 'straight', diameter: 12, length: 1000, qty: 1 }] }],
      }),
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    const order = db.prepare('SELECT customer_id,site_id,delivery_address FROM orders WHERE id=?').get(created.orderId);
    assert.equal(order.customer_id, customerId);
    assert.equal(order.site_id, siteId);
    assert.equal(order.delivery_address, 'Site A address');
  });
  await t.test('order contract requires manager approval and rejects draft-to-production', async () => {
    const customerId = seedCustomer();
    const directProductionOrder = seedInternalOrder(customerId, 'ORDER-CONTRACT-SKIP');
    let response = await request(`/api/orders/${directProductionOrder}/status`, {
      method: 'PATCH',
      headers: authHeaders(manager),
      body: JSON.stringify({ status: statusContracts.ORDER_STATUS.IN_PRODUCTION }),
    });
    assert.equal(response.status, 409);

    const approvalOrder = seedInternalOrder(customerId, 'ORDER-CONTRACT-APPROVE');
    response = await request(`/api/orders/${approvalOrder}/status`, {
      method: 'PATCH',
      headers: authHeaders(production),
      body: JSON.stringify({ status: statusContracts.ORDER_STATUS.APPROVED_WAITING_PRODUCTION }),
    });
    assert.equal(response.status, 403);

    response = await request(`/api/orders/${approvalOrder}/status`, {
      method: 'PATCH',
      headers: authHeaders(manager),
      body: JSON.stringify({ status: statusContracts.ORDER_STATUS.APPROVED_WAITING_PRODUCTION }),
    });
    assert.equal(response.status, 200);
    const updated = db.prepare('SELECT status,approved_by,approved_at,stable_order_id FROM orders WHERE id=?').get(approvalOrder);
    assert.equal(updated.status, statusContracts.ORDER_STATUS.APPROVED_WAITING_PRODUCTION);
    assert.ok(updated.approved_by);
    assert.ok(updated.approved_at);
    assert.equal(updated.stable_order_id, 'ORDER-CONTRACT-APPROVE');
  });

  await t.test('order item contract stores quantity on item and preserves shape snapshot', async () => {
    const customerId = seedCustomer();
    const orderId = seedInternalOrder(customerId, 'ORDER-CONTRACT-ITEM');
    const createBody = JSON.stringify({
      shape_name: 'contract-bend',
      diameter: 12,
      quantity: 5,
      total_length_mm: 1200,
      segments: [{ length_mm: 1200, angle_deg: 0 }],
      shape: { quantity: 999 },
    });
    const createResponse = await request(`/api/orders/${orderId}/items`, { method: 'POST', headers: authHeaders(manager), body: createBody });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    const item = db.prepare('SELECT * FROM items WHERE id=?').get(created.itemId);
    assert.equal(item.order_id, orderId);
    assert.equal(item.quantity, 5);
    assert.equal(item.item_uid, `order-${orderId}:item-${created.itemId}`);
    const snapshot = JSON.parse(item.shape_snapshot_json);
    assert.equal(snapshot.shapeName, 'contract-bend');
    assert.equal(Object.hasOwn(snapshot, 'quantity'), false);

    const updateBody = JSON.stringify({
      shape_name: 'contract-updated',
      diameter: 12,
      quantity: 7,
      total_length_mm: 1500,
      segments: [{ length_mm: 1500, angle_deg: 0 }],
    });
    const updateResponse = await request(`/api/orders/${orderId}/items/${created.itemId}`, { method: 'PATCH', headers: authHeaders(manager), body: updateBody });
    assert.equal(updateResponse.status, 200);
    const updated = db.prepare('SELECT quantity,shape_name,shape_snapshot_json FROM items WHERE id=?').get(created.itemId);
    assert.equal(updated.quantity, 7);
    assert.equal(updated.shape_name, 'contract-updated');
    assert.equal(updated.shape_snapshot_json, item.shape_snapshot_json);
  });

  await t.test('orders persist full Shape V2 envelope and compatibility fields from order payload', async () => {
    const envelope = shapeV2Envelope();
    const createResponse = await request('/api/orders', {
      method: 'POST',
      headers: authHeaders(manager),
      body: JSON.stringify({
        customer: { name: 'Shape Contract Customer', phone: '0500000001' },
        order: { orderNum: 'ORDER-SHAPE-V2', channel: 'office', totalWeight: 0, priority: 'regular' },
        pallets: [{ items: [{ shapeSnapshot: envelope, qty: 4, note: 'shape v2 order payload' }] }],
      }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    const item = db.prepare('SELECT * FROM items WHERE order_id=?').get(created.orderId);
    assert.equal(item.shape_id, envelope.shapeId);
    assert.equal(item.shape_name, envelope.displayName);
    assert.equal(item.diameter, 12);
    assert.equal(item.total_length_mm, 1900);
    assert.equal(item.quantity, 4);
    const segments = JSON.parse(item.segments);
    assert.equal(segments.length, 3);
    const snapshot = JSON.parse(item.shape_snapshot_json);
    for (const field of ['contractVersion', 'shapeVersion', 'shapeId', 'shapeType', 'family', 'data', 'calculated', 'machineOutput', 'validation']) {
      assert.ok(Object.hasOwn(snapshot, field), `missing ${field}`);
    }
    assert.deepEqual(snapshot, envelope);
  });

  await t.test('order item add persists full Shape V2 envelope unchanged', async () => {
    const customerId = seedCustomer();
    const orderId = seedInternalOrder(customerId, 'ORDER-SHAPE-V2-ITEM');
    const envelope = shapeV2Envelope();
    const createResponse = await request(`/api/orders/${orderId}/items`, {
      method: 'POST',
      headers: authHeaders(manager),
      body: JSON.stringify({ shapeSnapshot: envelope, quantity: 3, note: 'shape v2 add item' }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    const item = db.prepare('SELECT * FROM items WHERE id=?').get(created.itemId);
    assert.equal(item.shape_name, envelope.displayName);
    assert.equal(item.diameter, 12);
    assert.equal(item.quantity, 3);
    assert.equal(item.total_length_mm, 1900);
    const segments = JSON.parse(item.segments);
    assert.equal(segments.length, 3);
    const snapshot = JSON.parse(item.shape_snapshot_json);
    for (const field of ['contractVersion', 'shapeVersion', 'shapeId', 'shapeType', 'family', 'data', 'calculated', 'machineOutput', 'validation']) {
      assert.ok(Object.hasOwn(snapshot, field), `missing ${field}`);
    }
    assert.deepEqual(snapshot, envelope);
  });

  await t.test('order import preview allows office but rejects production', async () => {
    assert.equal((await request('/api/order-imports/preview', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/order-imports/preview', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/order-imports/preview', { method: 'POST', headers: { Authorization: `Bearer ${office}` } })).status, 400);
  });

  await t.test('customer token and pricing require office or higher', async () => {
    const customerId = seedCustomer();
    assert.equal((await request(`/api/customers/${customerId}/token`)).status, 401);
    assert.equal((await request(`/api/customers/${customerId}/token`, { headers: authHeaders(production) })).status, 403);
    const tokenResponse = await request(`/api/customers/${customerId}/token`, { headers: authHeaders(office) });
    assert.equal(tokenResponse.status, 200);
    const tokenBody = await tokenResponse.json();
    assert.equal(typeof tokenBody.token, 'string');
    assert.equal(typeof tokenBody.expiresAt, 'string');

    assert.equal((await request(`/api/customers/${customerId}/token/rotate`, { method: 'POST' })).status, 401);
    assert.equal((await request(`/api/customers/${customerId}/token/rotate`, { method: 'POST', headers: authHeaders(production) })).status, 403);
    const rotateResponse = await request(`/api/customers/${customerId}/token/rotate`, { method: 'POST', headers: authHeaders(office) });
    assert.equal(rotateResponse.status, 200);
    const rotated = await rotateResponse.json();
    assert.notEqual(rotated.token, tokenBody.token);
    assert.equal((await request(`/api/c/me?token=${tokenBody.token}`)).status, 401);

    assert.equal((await request(`/api/customers/${customerId}/token`, { method: 'DELETE' })).status, 401);
    assert.equal((await request(`/api/customers/${customerId}/token`, { method: 'DELETE', headers: authHeaders(production) })).status, 403);
    assert.equal((await request(`/api/customers/${customerId}/token`, { method: 'DELETE', headers: authHeaders(office) })).status, 200);
    assert.equal((await request(`/api/c/me?token=${rotated.token}`)).status, 401);

    const body = JSON.stringify({ price_tier: 'retail', discount_pct: 5 });
    assert.equal((await request(`/api/customers/${customerId}/pricing`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await request(`/api/customers/${customerId}/pricing`, { method: 'PATCH', headers: authHeaders(production), body })).status, 403);
    assert.equal((await request(`/api/customers/${customerId}/pricing`, { method: 'PATCH', headers: authHeaders(office), body })).status, 200);
  });

  await t.test('customer CRM base routes require internal customer roles', async () => {
    const customerId = seedCustomer();
    assert.equal((await request('/api/customers')).status, 401);
    assert.equal((await request('/api/customers', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/customers', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request(`/api/customers/${customerId}`)).status, 401);
    assert.equal((await request(`/api/customers/${customerId}`, { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request(`/api/customers/${customerId}`, { headers: authHeaders(office) })).status, 200);

    const createBody = JSON.stringify({});
    assert.equal((await request('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: createBody })).status, 401);
    assert.equal((await request('/api/customers', { method: 'POST', headers: authHeaders(production), body: createBody })).status, 403);
    assert.equal((await request('/api/customers', { method: 'POST', headers: authHeaders(office), body: createBody })).status, 400);

    const updateBody = JSON.stringify({ name: 'Updated Customer' });
    assert.equal((await request(`/api/customers/${customerId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: updateBody })).status, 401);
    assert.equal((await request(`/api/customers/${customerId}`, { method: 'PATCH', headers: authHeaders(production), body: updateBody })).status, 403);
    assert.equal((await request(`/api/customers/${customerId}`, { method: 'PATCH', headers: authHeaders(office), body: updateBody })).status, 200);
  });

  await t.test('order reads and documents require appropriate internal roles', async () => {
    const customerId = seedCustomer();
    const orderId = seedInternalOrder(customerId, 'SEC-ORDER-READ');

    assert.equal((await request('/api/orders')).status, 401);
    assert.equal((await request('/api/orders', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/orders', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request(`/api/orders/${orderId}`)).status, 401);
    assert.equal((await request(`/api/orders/${orderId}`, { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request(`/api/orders/${orderId}`, { headers: authHeaders(production) })).status, 200);

    assert.equal((await request(`/api/orders/${orderId}/print-cards`)).status, 401);
    assert.equal((await request(`/api/orders/${orderId}/print-cards`, { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request(`/api/orders/${orderId}/print-cards`, { headers: authHeaders(production) })).status, 200);

    assert.equal((await request(`/api/orders/${orderId}/print-a4`)).status, 401);
    assert.equal((await request(`/api/orders/${orderId}/print-a4`, { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request(`/api/orders/${orderId}/print-a4`, { headers: authHeaders(office) })).status, 200);

    assert.equal((await request(`/api/orders/${orderId}/delivery-certificate`)).status, 401);
    assert.equal((await request(`/api/orders/${orderId}/delivery-certificate`, { headers: authHeaders(production) })).status, 403);
    assert.equal((await request(`/api/orders/${orderId}/delivery-certificate`, { headers: authHeaders(office) })).status, 200);
  });

  await t.test('intake parse/log require office while OCR training is manager-only', async () => {
    assert.equal((await request('/api/intake/log')).status, 401);
    assert.equal((await request('/api/intake/log', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/intake/log', { headers: authHeaders(office) })).status, 200);

    const emptyBody = JSON.stringify({});
    assert.equal((await request('/api/intake/parse-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/intake/parse-text', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/intake/parse-text', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);
    assert.equal((await request('/api/intake/1/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/intake/1/draft', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    const textBody = JSON.stringify({ source: 'phone', text: '12 6000 4' });
    assert.equal((await request('/api/intake/parse-text', { method: 'POST', headers: authHeaders(office), body: textBody })).status, 200);

    assert.equal((await request('/api/intake/training')).status, 401);
    assert.equal((await request('/api/intake/training', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/intake/training', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/intake/training', { headers: authHeaders(manager) })).status, 200);

    assert.equal((await request('/api/intake/training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/intake/training', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/intake/training', { method: 'POST', headers: authHeaders(manager), body: emptyBody })).status, 400);
    assert.equal((await request('/api/intake/training/1', { method: 'DELETE', headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/intake/training/1', { method: 'DELETE', headers: authHeaders(manager) })).status, 200);
  });

  await t.test('intake file and BVBS endpoints require office role before disabled or parse gates', async () => {
    const anonymousAnalyzeImage = await request('/api/analyze-image', { method: 'POST' });
    assert.equal(anonymousAnalyzeImage.status, 401);
    const anonymousAnalyzeImageBody = await anonymousAnalyzeImage.json();
    assert.equal(anonymousAnalyzeImageBody.error, 'נדרשת התחברות מחדש לפני ניתוח תמונה');
    assert.equal(anonymousAnalyzeImageBody.code, 'ocr_auth_required');

    const productionAnalyzeImage = await request('/api/analyze-image', { method: 'POST', headers: authHeaders(production) });
    assert.equal(productionAnalyzeImage.status, 403);
    const productionAnalyzeImageBody = await productionAnalyzeImage.json();
    assert.equal(productionAnalyzeImageBody.error, 'אין למשתמש הנוכחי הרשאה לניתוח תמונה');
    assert.equal(productionAnalyzeImageBody.code, 'ocr_forbidden');
    assert.equal((await request('/api/analyze-image', { method: 'POST', headers: { Authorization: `Bearer ${office}` } })).status, 501);
    assert.equal((await request('/api/inventory/analyze-bending-shape', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/inventory/analyze-bending-shape', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/inventory/analyze-bending-shape', { method: 'POST', headers: { Authorization: `Bearer ${warehouse}` } })).status, 501);
    assert.equal((await request('/api/inventory/analyze-bending-shape', { method: 'POST', headers: { Authorization: `Bearer ${office}` } })).status, 501);
    assert.equal((await request('/api/inventory/receipt-reviews')).status, 401);
    assert.equal((await request('/api/inventory/receipt-reviews', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/inventory/receipt-reviews', { headers: authHeaders(warehouse) })).status, 200);
    assert.equal((await request('/api/inventory/receipt-reviews/analyze', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/inventory/receipt-reviews/analyze', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/inventory/receipt-reviews/analyze', { method: 'POST', headers: { Authorization: `Bearer ${warehouse}` } })).status, 501);
    assert.equal((await request('/api/inventory/receipt-reviews/1/approve', { method: 'POST', headers: authHeaders(warehouse) })).status, 403);
    assert.equal((await request('/api/inventory/receipt-reviews/1/reject', { method: 'POST', headers: authHeaders(warehouse) })).status, 403);

    assert.equal((await request('/api/intake/image', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/intake/image', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/intake/image', { method: 'POST', headers: { Authorization: `Bearer ${office}` } })).status, 501);

    assert.equal((await request('/api/intake/email/poll', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/intake/email/poll', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/intake/email/poll', { method: 'POST', headers: authHeaders(office) })).status, 501);

    const emptyBody = JSON.stringify({});
    assert.equal((await request('/api/bvbs/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/bvbs/parse', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/bvbs/parse', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);

    assert.equal((await request('/api/bvbs/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/bvbs/create-order', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/bvbs/create-order', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);
  });

  await t.test('whatsapp webhook is public only with provider verification when configured', async () => {
    const previousSecret = process.env.WHATSAPP_APP_SECRET;
    const previousVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    process.env.WHATSAPP_APP_SECRET = 'webhook-secret';
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token';

    try {
      assert.equal((await request('/api/intake/whatsapp?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=abc')).status, 403);
      const verifyResponse = await request('/api/intake/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc');
      assert.equal(verifyResponse.status, 200);
      assert.equal(await verifyResponse.text(), 'abc');

      const body = JSON.stringify({ entry: [] });
      assert.equal((await request('/api/intake/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })).status, 403);

      const signature = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(Buffer.from(body)).digest('hex')}`;
      assert.equal((await request('/api/intake/whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body,
      })).status, 200);
    } finally {
      if (previousSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
      else process.env.WHATSAPP_APP_SECRET = previousSecret;
      if (previousVerifyToken === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN;
      else process.env.WHATSAPP_VERIFY_TOKEN = previousVerifyToken;
    }
  });

  await t.test('customer portal phone bootstrap requires OTP before token issue', async () => {
    seedPortalCustomer('Portal OTP Existing', '0500000091', null);
    seedPortalCustomer('Portal OTP Formatted', '050-000-0093', null);

    const startResponse = await request('/api/c/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '050-000-0091' }),
    });
    assert.equal(startResponse.status, 200);
    const start = await startResponse.json();
    assert.equal(start.otpRequired, true);
    assert.equal(typeof start.devOtp, 'string');
    assert.equal(start.devOtp.length, 6);
    assert.equal(start.token, undefined);

    const wrongResponse = await request('/api/c/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000091', code: '000000' }),
    });
    assert.equal(wrongResponse.status, 401);

    const verifyResponse = await request('/api/c/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000091', code: start.devOtp }),
    });
    assert.equal(verifyResponse.status, 200);
    const verified = await verifyResponse.json();
    assert.equal(typeof verified.token, 'string');
    assert.equal(verified.customer.phone, '0500000091');

    const reuseResponse = await request('/api/c/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000091', code: start.devOtp }),
    });
    assert.equal(reuseResponse.status, 401);

    assert.equal((await request(`/api/c/me?token=${verified.token}`)).status, 200);

    const formattedStartResponse = await request('/api/c/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '050-000-0093' }),
    });
    assert.equal(formattedStartResponse.status, 200);
    const formattedStart = await formattedStartResponse.json();
    assert.equal(formattedStart.otpRequired, true);
    assert.equal(formattedStart.customer.name, 'Portal OTP Formatted');

    const formattedVerifyResponse = await request('/api/c/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000093', code: formattedStart.devOtp }),
    });
    assert.equal(formattedVerifyResponse.status, 200);
  });

  await t.test('customer portal auth can create a new customer before OTP verification', async () => {
    const needNameResponse = await request('/api/c/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000092' }),
    });
    assert.equal(needNameResponse.status, 200);
    assert.equal((await needNameResponse.json()).needName, true);

    const startResponse = await request('/api/c/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000092', name: 'Portal OTP New' }),
    });
    assert.equal(startResponse.status, 200);
    const start = await startResponse.json();
    assert.equal(start.otpRequired, true);
    assert.equal(start.token, undefined);

    const verifyResponse = await request('/api/c/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000092', code: start.devOtp }),
    });
    assert.equal(verifyResponse.status, 200);
    const verified = await verifyResponse.json();
    assert.equal(verified.customer.name, 'Portal OTP New');
    assert.equal(typeof verified.token, 'string');

    const unauthenticatedOrder = await request('/api/c/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0500000094', name: 'Bypass Attempt', items: [] }),
    });
    assert.equal(unauthenticatedOrder.status, 401);
  });

  await t.test('customer profile first edit is direct and later changes require internal approval', async () => {
    const customerId = seedPortalCustomer('Profile Customer', '0505555555', 'profile-legacy-token');
    const portalToken = seedPortalUser(customerId, '0505555555', 'customer_admin', 'profile-user-token');

    const first = await request('/api/c/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: portalToken, name: 'Profile Customer Updated', email: 'first@example.com', address: 'First Address' }),
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.firstUpdate, true);
    let customer = db.prepare('SELECT name,email,address,portal_profile_locked_at FROM customers WHERE id=?').get(customerId);
    assert.equal(customer.name, 'Profile Customer Updated');
    assert.ok(customer.portal_profile_locked_at);

    const second = await request('/api/c/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: portalToken, name: 'Needs Approval', email: 'pending@example.com', address: 'Pending Address' }),
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.pendingApproval, true);
    customer = db.prepare('SELECT name,email,address FROM customers WHERE id=?').get(customerId);
    assert.equal(customer.name, 'Profile Customer Updated');
    const changeRequest = db.prepare('SELECT * FROM customer_profile_change_requests WHERE customer_id=? AND status=?').get(customerId, 'pending');
    assert.ok(changeRequest);

    assert.equal((await request('/api/customers/' + customerId + '/profile-change-requests/' + changeRequest.id + '/approve', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/customers/' + customerId + '/profile-change-requests/' + changeRequest.id + '/approve', { method: 'POST', headers: authHeaders(production) })).status, 403);
    const approved = await request('/api/customers/' + customerId + '/profile-change-requests/' + changeRequest.id + '/approve', { method: 'POST', headers: authHeaders(office) });
    assert.equal(approved.status, 200);
    customer = db.prepare('SELECT name,email,address FROM customers WHERE id=?').get(customerId);
    assert.equal(customer.name, 'Needs Approval');
    assert.equal(customer.email, 'pending@example.com');
    assert.equal(customer.address, 'Pending Address');
    assert.equal(db.prepare('SELECT status FROM customer_profile_change_requests WHERE id=?').get(changeRequest.id).status, 'approved');
  });

  await t.test('customer portal order detail is scoped to portal token owner', async () => {
    const customerA = seedPortalCustomer('Portal Customer A', '0500000001', 'portal-token-a');
    const customerB = seedPortalCustomer('Portal Customer B', '0500000002', 'portal-token-b');
    const orderA = seedPortalOrder(customerA, 'PORTAL-A-1');
    const orderB = seedPortalOrder(customerB, 'PORTAL-B-1');

    assert.equal((await request(`/api/c/orders/${orderA}`)).status, 401);
    assert.equal((await request(`/api/c/orders/${orderA}?token=portal-token-b`)).status, 404);
    assert.equal((await request(`/api/c/orders/${orderA}?token=portal-token-a`)).status, 200);
    assert.equal((await request(`/api/c/orders/${orderB}?token=portal-token-a`)).status, 404);
  });

  await t.test('customer portal guarantee documents are token scoped and file type checked', async () => {
    const customerA = seedPortalCustomer('Portal Guarantee A', '0500000011', 'portal-guarantee-a');
    const customerB = seedPortalCustomer('Portal Guarantee B', '0500000012', 'portal-guarantee-b');
    db.prepare(`
      INSERT INTO customer_guarantee_documents
        (customer_id, original_name, file_name, mime_type, data_url, status)
      VALUES (?,?,?,?,?,?)
    `).run(customerA, 'a.pdf', 'a.pdf', 'application/pdf', 'data:application/pdf;base64,QQ==', 'uploaded_pending_review');
    db.prepare(`
      INSERT INTO customer_guarantee_documents
        (customer_id, original_name, file_name, mime_type, data_url, status)
      VALUES (?,?,?,?,?,?)
    `).run(customerB, 'b.pdf', 'b.pdf', 'application/pdf', 'data:application/pdf;base64,Qg==', 'approved');

    assert.equal((await request('/api/c/guarantee-documents')).status, 401);

    const listA = await request('/api/c/guarantee-documents?token=portal-guarantee-a');
    assert.equal(listA.status, 200);
    const bodyA = await listA.json();
    assert.deepEqual(bodyA.documents.map(doc => doc.original_name), ['a.pdf']);

    const badForm = new FormData();
    badForm.append('token', 'portal-guarantee-a');
    badForm.append('file', new Blob(['not allowed'], { type: 'text/plain' }), 'guarantee.txt');
    assert.equal((await request('/api/c/guarantee-documents', { method: 'POST', body: badForm })).status, 400);

    const goodForm = new FormData();
    goodForm.append('token', 'portal-guarantee-a');
    goodForm.append('file', new Blob(['png'], { type: 'image/png' }), 'guarantee.png');
    const uploadResponse = await request('/api/c/guarantee-documents', { method: 'POST', body: goodForm });
    assert.equal(uploadResponse.status, 200);
    const uploaded = await uploadResponse.json();
    assert.equal(uploaded.status, 'uploaded_pending_review');

    const rowsForA = db.prepare('SELECT original_name FROM customer_guarantee_documents WHERE customer_id=? ORDER BY id').all(customerA);
    assert.deepEqual(rowsForA.map(row => row.original_name), ['a.pdf', 'guarantee.png']);
  });

  await t.test('portal orderer cannot approve an order', async () => {
    const customerId = seedPortalCustomer('Portal Contract Orderer', '0500000090', 'portal-contract-legacy');
    const portalToken = seedPortalUser(customerId, '0500000191', 'orderer', 'portal-contract-orderer');
    const orderId = seedPortalOrder(customerId, 'PORTAL-CONTRACT-NO-APPROVE');
    const response = await request('/api/c/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: portalToken, orderId }),
    });
    assert.equal(response.status, 403);
  });

  await t.test('customer portal approval is scoped to portal token owner', async () => {
    const customerA = seedPortalCustomer('Portal Customer C', '0500000003', 'portal-token-c');
    const customerB = seedPortalCustomer('Portal Customer D', '0500000004', 'portal-token-d');
    const orderA = seedPortalOrder(customerA, 'PORTAL-C-1');
    const body = (tokenValue) => JSON.stringify({ token: tokenValue, orderId: orderA });

    assert.equal((await request('/api/c/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('') })).status, 401);
    assert.equal((await request('/api/c/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('portal-token-d') })).status, 404);

    const response = await request('/api/c/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('portal-token-c') });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);

    const updated = db.prepare('SELECT status, confirm_token FROM orders WHERE id=?').get(orderA);
    assert.equal(updated.status, 'ממתינה לאישור');
    assert.equal(updated.confirm_token, null);

    assert.ok(customerB);
  });

  await t.test('dashboard reports and KPI routes require internal reporting roles', async () => {
    assert.equal((await request('/api/dashboard')).status, 401);
    assert.equal((await request('/api/dashboard', { headers: authHeaders(production) })).status, 200);

    const customerId = seedCustomer();
    const orderId = seedInternalOrder(customerId, 'DASH-KPI-CONSISTENCY');
    db.prepare('UPDATE orders SET total_weight=? WHERE id=?').run(9999, orderId);
    const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,?,?)')
      .run(orderId, 1, 25).lastInsertRowid;
    db.prepare(`
      INSERT INTO items (pallet_id,shape_id,shape_name,diameter,total_length_mm,quantity,weight_per_unit,total_weight,status,completed_at,machine)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(palletId, 's1', 'straight', 12, 1000, 3, 0.888, 25, statusContracts.ITEM_STATUS.DONE, new Date().toISOString(), 'A');

    const dashboardResponse = await request('/api/dashboard', { headers: authHeaders(production) });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.producedWeightToday, 25);
    assert.equal(dashboard.producedTonsToday, 0);
    assert.ok(dashboard.totalWeightToday >= 9999);
    assert.notEqual(dashboard.producedWeightToday, dashboard.totalWeightToday);

    const dashboardContracts = Object.values(dataContracts.WIDGET_CONTRACTS)
      .filter(contract => contract.source.api === '/api/dashboard');
    for (const contract of dashboardContracts) {
      for (const field of contract.source.fields) {
        assert.ok(Object.hasOwn(dashboard, field), `dashboard response should include contracted field ${field}`);
      }
    }

    assert.equal((await request('/api/reports/waste')).status, 401);
    assert.equal((await request('/api/reports/waste', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/reports/summary')).status, 401);
    assert.equal((await request('/api/reports/summary', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/reports/summary', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/waste/summary')).status, 401);
    assert.equal((await request('/api/waste/summary', { headers: authHeaders(production) })).status, 200);

    assert.equal((await request('/api/kpi/tons-today')).status, 401);
    assert.equal((await request('/api/kpi/tons-today', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/kpi/tons-today', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/kpi/monthly')).status, 401);
    assert.equal((await request('/api/kpi/monthly', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/kpi/monthly', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/kpi/shift-summary')).status, 401);
    assert.equal((await request('/api/kpi/shift-summary', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/kpi/shift-summary', { headers: authHeaders(production) })).status, 200);
  });

  await t.test('alerts search and export routes require scoped internal roles', async () => {
    const body = JSON.stringify({ message: 'security test alert' });

    assert.equal((await request('/api/alerts')).status, 401);
    assert.equal((await request('/api/alerts', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/alerts', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await request('/api/alerts', { method: 'POST', headers: authHeaders(finance), body })).status, 403);
    assert.equal((await request('/api/alerts', { method: 'POST', headers: authHeaders(production), body })).status, 200);
    assert.equal((await request('/api/alerts', { method: 'POST', headers: authHeaders(kiosk), body })).status, 200);

    assert.equal((await request('/api/alerts/1/resolve', { method: 'PATCH', headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/alerts/1/resolve', { method: 'PATCH', headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/search?q=SEC')).status, 401);
    assert.equal((await request('/api/search?q=SEC', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/export/orders')).status, 401);
    assert.equal((await request('/api/export/orders', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/export/orders', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/export/packages')).status, 401);
    assert.equal((await request('/api/export/packages', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/export/packages', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/export/inventory')).status, 401);
    assert.equal((await request('/api/export/inventory', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/export/inventory', { headers: authHeaders(office) })).status, 200);
  });

  await t.test('public health check does not expose business counts', async () => {
    const response = await request('/api/health');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(Object.hasOwn(body, 'orders'), false);
  });

  await t.test('production read routes require production or operational roles', async () => {
    assert.equal((await request('/api/workers')).status, 401);
    assert.equal((await request('/api/workers', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/workers', { headers: authHeaders(production) })).status, 200);

    assert.equal((await request('/api/machines')).status, 401);
    assert.equal((await request('/api/machines', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/machines', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/machines', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/machines/1/state-log')).status, 401);
    assert.equal((await request('/api/machines/1/state-log', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/machines/1/state-log', { headers: authHeaders(production) })).status, 200);

    assert.equal((await request('/api/shifts')).status, 401);
    assert.equal((await request('/api/shifts', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/shifts', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/shifts', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/downtime-reasons')).status, 401);
    assert.equal((await request('/api/downtime-reasons', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/downtime-reasons', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/downtime-reasons', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/machine-stops')).status, 401);
    assert.equal((await request('/api/machine-stops', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/machine-stops', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/machine-stops', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/production-queue')).status, 401);
    assert.equal((await request('/api/production-queue', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/production-queue', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/production-queue', { headers: authHeaders(kiosk) })).status, 200);

    assert.equal((await request('/api/production-events')).status, 401);
    assert.equal((await request('/api/production-events', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/production-events', { headers: authHeaders(production) })).status, 200);

    assert.equal((await request('/api/machines/oee')).status, 401);
    assert.equal((await request('/api/machines/oee', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/machines/oee', { headers: authHeaders(production) })).status, 200);
  });

  await t.test('warehouse delivery and inventory routes require logistics roles', async () => {
    const emptyBody = JSON.stringify({});

    assert.equal((await request('/api/drivers')).status, 401);
    assert.equal((await request('/api/drivers', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/drivers', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: emptyBody })).status, 401);
    assert.equal((await request('/api/drivers', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/drivers', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);

    assert.equal((await request('/api/vehicles')).status, 401);
    assert.equal((await request('/api/vehicles', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/vehicles', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/vehicles', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/vehicles', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);
    assert.equal((await request('/api/vehicles/1/events')).status, 401);
    assert.equal((await request('/api/vehicles/1/events', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/vehicles/1/events', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/vehicles/1/events', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/vehicles/1/events', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);
    assert.equal((await request('/api/vehicles/1/documents')).status, 401);
    assert.equal((await request('/api/vehicles/1/documents', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/vehicles/1/documents', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/drivers/1/location', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/drivers/1/location', { method: 'PATCH', headers: authHeaders(office), body: emptyBody })).status, 200);

    assert.equal((await request('/api/drivers/1/vehicle-events')).status, 401);
    assert.equal((await request('/api/drivers/1/vehicle-events', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/drivers/1/vehicle-events', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/drivers/1/vehicle-events', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/drivers/1/vehicle-events', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);

    assert.equal((await request('/api/deliveries')).status, 401);
    assert.equal((await request('/api/deliveries', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/deliveries', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/deliveries', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/deliveries', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 401);
    assert.notEqual((await request('/api/deliveries', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);

    assert.equal((await request('/api/deliveries/1/depart', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.notEqual((await request('/api/deliveries/1/depart', { method: 'POST', headers: authHeaders(office) })).status, 401);
    assert.notEqual((await request('/api/deliveries/1/depart', { method: 'POST', headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/deliveries/1/confirm', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.notEqual((await request('/api/deliveries/1/confirm', { method: 'POST', headers: authHeaders(office) })).status, 401);
    assert.notEqual((await request('/api/deliveries/1/confirm', { method: 'POST', headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/deliveries/1/problem', { method: 'POST', headers: authHeaders(production) })).status, 403);
    assert.notEqual((await request('/api/deliveries/1/problem', { method: 'POST', headers: authHeaders(office) })).status, 401);
    assert.notEqual((await request('/api/deliveries/1/problem', { method: 'POST', headers: authHeaders(office) })).status, 403);

    assert.equal((await request('/api/suppliers')).status, 401);
    assert.equal((await request('/api/suppliers', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/suppliers', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/suppliers', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/suppliers', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);

    assert.equal((await request('/api/inventory')).status, 401);
    assert.equal((await request('/api/inventory', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/inventory', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/inventory/summary')).status, 401);
    assert.equal((await request('/api/inventory/summary', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/inventory/forecast')).status, 401);
    assert.equal((await request('/api/inventory/forecast', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/inventory', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/inventory', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 400);

    assert.equal((await request('/api/packages')).status, 401);
    assert.equal((await request('/api/packages', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/packages', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/packages', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/packages', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 401);
    assert.notEqual((await request('/api/packages', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/packages/1/ship', { method: 'PATCH', headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/packages/1/ship', { method: 'PATCH', headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/delivery-notes')).status, 401);
    assert.equal((await request('/api/delivery-notes', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/delivery-notes', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/delivery-notes', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/delivery-notes', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 401);
    assert.notEqual((await request('/api/delivery-notes', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
  });

  await t.test('quality maintenance incidents LOTO and PM routes require module roles', async () => {
    const emptyBody = JSON.stringify({});

    assert.equal((await request('/api/quality')).status, 401);
    assert.equal((await request('/api/quality', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/quality', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/quality/stats')).status, 401);
    assert.equal((await request('/api/quality/stats', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/quality', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/quality', { method: 'POST', headers: authHeaders(manager), body: emptyBody })).status, 400);

    assert.equal((await request('/api/maintenance')).status, 401);
    assert.equal((await request('/api/maintenance', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/maintenance', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/maintenance/stats')).status, 401);
    assert.equal((await request('/api/maintenance/stats', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/maintenance', { method: 'POST', headers: authHeaders(finance), body: emptyBody })).status, 403);
    assert.equal((await request('/api/maintenance', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 400);
    assert.equal((await request('/api/maintenance/1', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/maintenance/1', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 404);

    assert.equal((await request('/api/incidents')).status, 401);
    assert.equal((await request('/api/incidents', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/incidents', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/incidents', { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ title: 'security incident' }) })).status, 403);
    assert.equal((await request('/api/incidents', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ title: 'security incident' }) })).status, 200);
    assert.equal((await request('/api/incidents/1', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/incidents/1', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 401);
    assert.notEqual((await request('/api/incidents/1', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 403);

    assert.equal((await request('/api/ncr')).status, 401);
    assert.equal((await request('/api/ncr', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/ncr', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/ncr', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ description: 'ncr security test' }) })).status, 403);
    assert.notEqual((await request('/api/ncr', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ description: 'ncr security test' }) })).status, 401);
    assert.equal((await request('/api/ncr/1', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/ncr/1', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 401);

    assert.equal((await request('/api/capa')).status, 401);
    assert.equal((await request('/api/capa', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/capa', { headers: authHeaders(manager) })).status, 200);
    assert.equal((await request('/api/capa', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ title: 'capa security test' }) })).status, 403);
    assert.notEqual((await request('/api/capa', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ title: 'capa security test' }) })).status, 401);
    assert.equal((await request('/api/capa/1', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/capa/1', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 401);

    assert.equal((await request('/api/loto')).status, 401);
    assert.equal((await request('/api/loto', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/loto', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/loto', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ machine_id: 999 }) })).status, 403);
    assert.notEqual((await request('/api/loto', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ machine_id: 999 }) })).status, 401);
    assert.equal((await request('/api/loto/1/release', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/loto/1/release', { method: 'PATCH', headers: authHeaders(manager), body: emptyBody })).status, 401);

    assert.equal((await request('/api/pm-schedule')).status, 401);
    assert.equal((await request('/api/pm-schedule', { headers: authHeaders(finance) })).status, 403);
    assert.equal((await request('/api/pm-schedule', { headers: authHeaders(production) })).status, 200);
    assert.equal((await request('/api/pm-schedule', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ machine_id: 1, pm_type: 'security test' }) })).status, 403);
    assert.notEqual((await request('/api/pm-schedule', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ machine_id: 1, pm_type: 'security test' }) })).status, 401);
  });

  await t.test('catalog company project pricing AI and purchase routes require scoped roles', async () => {
    const emptyBody = JSON.stringify({});

    assert.equal((await request('/api/shapes')).status, 401);
    assert.equal((await request('/api/shapes', { headers: authHeaders(finance) })).status, 403);
    assert.notEqual((await request('/api/shapes', { headers: authHeaders(production) })).status, 401);
    assert.notEqual((await request('/api/shapes', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/shapes', { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ id: 'sec-shape', name: 'Security Shape' }) })).status, 403);
    assert.notEqual((await request('/api/shapes', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ id: 'sec-shape', name: 'Security Shape' }) })).status, 401);
    assert.notEqual((await request('/api/shapes', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ id: 'sec-shape', name: 'Security Shape' }) })).status, 403);
    assert.equal((await request('/api/shapes/seed', { method: 'POST', headers: authHeaders(office) })).status, 403);
    assert.notEqual((await request('/api/shapes/seed', { method: 'POST', headers: authHeaders(manager) })).status, 401);
    assert.notEqual((await request('/api/shapes/seed', { method: 'POST', headers: authHeaders(manager) })).status, 403);

    assert.equal((await request('/api/companies')).status, 401);
    assert.equal((await request('/api/companies', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/companies', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/companies', { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ name: 'Security Company' }) })).status, 403);
    assert.equal((await request('/api/companies', { method: 'POST', headers: authHeaders(manager), body: JSON.stringify({ name: 'Security Company' }) })).status, 200);
    assert.equal((await request('/api/companies/1', { method: 'PATCH', headers: authHeaders(office), body: JSON.stringify({ color: '#000000' }) })).status, 403);
    assert.equal((await request('/api/companies/1', { method: 'PATCH', headers: authHeaders(manager), body: JSON.stringify({ color: '#000000' }) })).status, 200);

    assert.equal((await request('/api/holdings')).status, 401);
    assert.equal((await request('/api/holdings', { headers: authHeaders(office) })).status, 403);
    assert.equal((await request('/api/holdings', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/priority/status')).status, 401);
    assert.equal((await request('/api/priority/status', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/priority/status', { headers: authHeaders(office) })).status, 200);

    assert.equal((await request('/api/pricing/price-books')).status, 401);
    assert.equal((await request('/api/pricing/price-books', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/pricing/price-books', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/pricing/price-books', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/pricing/price-books', { method: 'POST', headers: authHeaders(finance), body: emptyBody })).status, 400);
    assert.equal((await request('/api/pricing/price-books/analyze-upload', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/pricing/price-books/analyze-upload', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/pricing/price-books/analyze-upload', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/pricing/price-books/analyze-upload', { method: 'POST', headers: authHeaders(finance), body: emptyBody })).status, 501);
    const priceBookResponse = await request('/api/pricing/price-books', {
      method: 'POST',
      headers: authHeaders(finance),
      body: JSON.stringify({
        code: 'SEC-PRICE-BOOK',
        name: 'Security Price Book',
        customer_name: 'Security Customer',
      }),
    });
    assert.equal(priceBookResponse.status, 200);
    const priceBook = (await priceBookResponse.json()).price_book;
    assert.ok(priceBook.id);

    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items`)).status, 401);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items`, { headers: authHeaders(production) })).status, 403);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items`, { headers: authHeaders(office) })).status, 200);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items`, { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items`, { method: 'POST', headers: authHeaders(finance), body: emptyBody })).status, 400);
    const priceItemResponse = await request(`/api/pricing/price-books/${priceBook.id}/items`, {
      method: 'POST',
      headers: authHeaders(finance),
      body: JSON.stringify({
        sku: 'SEC-SKU-1',
        description: 'Security test item',
        category: 'Security',
        unit: 'kg',
        price_before_vat: 12.5,
      }),
    });
    assert.equal(priceItemResponse.status, 200);
    const priceItem = (await priceItemResponse.json()).item;
    assert.ok(priceItem.id);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}`, { method: 'PATCH', headers: authHeaders(office), body: JSON.stringify({ name: 'Bad Update' }) })).status, 403);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}`, { method: 'PATCH', headers: authHeaders(finance), body: JSON.stringify({ status: 'active' }) })).status, 200);

    const customerPriceBookCustomerId = seedCustomer();
    const customerPriceBookResponse = await request('/api/pricing/price-books', {
      method: 'POST',
      headers: authHeaders(finance),
      body: JSON.stringify({
        code: 'SEC-CUSTOMER-PRICE-BOOK',
        name: 'Security Customer Price Book',
        customer_id: customerPriceBookCustomerId,
        customer_name: 'Security Customer',
        price_type: 'customer',
        status: 'draft',
      }),
    });
    assert.equal(customerPriceBookResponse.status, 200);
    const customerPriceBook = (await customerPriceBookResponse.json()).price_book;
    assert.equal(db.prepare('SELECT price_tier FROM customers WHERE id = ?').get(customerPriceBookCustomerId).price_tier, 'retail');
    assert.equal((await request(`/api/pricing/price-books/${customerPriceBook.id}`, {
      method: 'PATCH',
      headers: authHeaders(finance),
      body: JSON.stringify({ status: 'active' }),
    })).status, 200);
    assert.equal(db.prepare('SELECT price_tier FROM customers WHERE id = ?').get(customerPriceBookCustomerId).price_tier, 'customer');

    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items/${priceItem.id}`, { method: 'PATCH', headers: authHeaders(office), body: JSON.stringify({ price_before_vat: 13 }) })).status, 403);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items/${priceItem.id}`, { method: 'PATCH', headers: authHeaders(finance), body: JSON.stringify({ price_before_vat: 13 }) })).status, 200);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items/${priceItem.id}`, { method: 'DELETE', headers: authHeaders(office) })).status, 403);
    assert.equal((await request(`/api/pricing/price-books/${priceBook.id}/items/${priceItem.id}`, { method: 'DELETE', headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/steel-prices')).status, 401);
    assert.equal((await request('/api/steel-prices', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/steel-prices', { headers: authHeaders(finance) })).status, 200);

    assert.equal((await request('/api/ai/waste-patterns')).status, 401);
    assert.equal((await request('/api/ai/waste-patterns', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/ai/waste-patterns', { headers: authHeaders(manager) })).status, 200);
    assert.equal((await request('/api/ai/machine-efficiency')).status, 401);
    assert.equal((await request('/api/ai/machine-efficiency', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/ai/machine-efficiency', { headers: authHeaders(manager) })).status, 200);
    assert.equal((await request('/api/ai/predict', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/ai/predict', { method: 'POST', headers: authHeaders(manager), body: emptyBody })).status, 400);
    assert.equal((await request('/api/ai/predict-order/999999', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/ai/predict-order/999999', { headers: authHeaders(manager) })).status, 404);

    assert.equal((await request('/api/projects')).status, 401);
    assert.equal((await request('/api/projects', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/projects', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/projects/999999')).status, 401);
    assert.equal((await request('/api/projects/999999', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/projects/999999', { headers: authHeaders(office) })).status, 404);
    assert.equal((await request('/api/projects', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ name: 'Security Project' }) })).status, 403);
    assert.equal((await request('/api/projects', { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ name: 'Security Project' }) })).status, 200);
    assert.equal((await request('/api/projects/1', { method: 'PATCH', headers: authHeaders(production), body: JSON.stringify({ name: 'Security Project Updated' }) })).status, 403);
    assert.equal((await request('/api/projects/1', { method: 'PATCH', headers: authHeaders(office), body: JSON.stringify({ name: 'Security Project Updated' }) })).status, 200);

    assert.equal((await request('/api/sites')).status, 401);
    assert.equal((await request('/api/sites', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/sites', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/sites', { method: 'POST', headers: authHeaders(production), body: JSON.stringify({ name: 'Security Site' }) })).status, 403);
    assert.equal((await request('/api/sites', { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ name: 'Security Site' }) })).status, 200);
    assert.equal((await request('/api/sites/1', { method: 'PATCH', headers: authHeaders(production), body: JSON.stringify({ name: 'Security Site Updated' }) })).status, 403);
    assert.equal((await request('/api/sites/1', { method: 'PATCH', headers: authHeaders(office), body: JSON.stringify({ name: 'Security Site Updated' }) })).status, 200);

    assert.equal((await request('/api/purchase-orders')).status, 401);
    assert.equal((await request('/api/purchase-orders', { headers: authHeaders(production) })).status, 403);
    assert.equal((await request('/api/purchase-orders', { headers: authHeaders(office) })).status, 200);
    assert.equal((await request('/api/purchase-orders', { method: 'POST', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.equal((await request('/api/purchase-orders', { method: 'POST', headers: authHeaders(office), body: emptyBody })).status, 200);
    assert.equal((await request('/api/purchase-orders/1', { method: 'PATCH', headers: authHeaders(office), body: emptyBody })).status, 403);
    assert.equal((await request('/api/purchase-orders/1', { method: 'PATCH', headers: authHeaders(finance), body: emptyBody })).status, 200);
    assert.equal((await request('/api/purchase-orders/1/receive', { method: 'PATCH', headers: authHeaders(production), body: emptyBody })).status, 403);
    assert.notEqual((await request('/api/purchase-orders/1/receive', { method: 'PATCH', headers: authHeaders(office), body: emptyBody })).status, 401);
    assert.notEqual((await request('/api/purchase-orders/1/receive', { method: 'PATCH', headers: authHeaders(office), body: emptyBody })).status, 403);
  });

  await t.test('production mutation allows production but rejects office', async () => {
    const body = JSON.stringify({ status: 'bad-status' });
    assert.equal((await request('/api/items/1/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await request('/api/items/1/status', { method: 'PATCH', headers: authHeaders(office), body })).status, 403);
    assert.notEqual((await request('/api/items/1/status', { method: 'PATCH', headers: authHeaders(production), body })).status, 401);
    assert.notEqual((await request('/api/items/1/status', { method: 'PATCH', headers: authHeaders(production), body })).status, 403);
    assert.notEqual((await request('/api/items/1/status', { method: 'PATCH', headers: authHeaders(kiosk), body })).status, 401);
    assert.notEqual((await request('/api/items/1/status', { method: 'PATCH', headers: authHeaders(kiosk), body })).status, 403);

    const wasteBody = JSON.stringify({ produced_qty: 1, actual_waste: 0 });
    assert.equal((await request('/api/items/1', { method: 'PATCH', headers: authHeaders(office), body: wasteBody })).status, 403);
    assert.notEqual((await request('/api/items/1', { method: 'PATCH', headers: authHeaders(kiosk), body: wasteBody })).status, 401);
    assert.notEqual((await request('/api/items/1', { method: 'PATCH', headers: authHeaders(kiosk), body: wasteBody })).status, 403);

    const shiftBody = JSON.stringify({ shift_type: 'morning', date: '2026-06-02', operator_id: 1, machine_id: 1 });
    assert.equal((await request('/api/shifts', { method: 'POST', headers: authHeaders(office), body: shiftBody })).status, 403);
    assert.equal((await request('/api/shifts', { method: 'POST', headers: authHeaders(kiosk), body: shiftBody })).status, 200);

    const stopBody = JSON.stringify({ machine_id: 1, reason_code: 'OTHER', reported_by: 1 });
    assert.equal((await request('/api/machine-stops', { method: 'POST', headers: authHeaders(office), body: stopBody })).status, 403);
    const stopResponse = await request('/api/machine-stops', { method: 'POST', headers: authHeaders(kiosk), body: stopBody });
    assert.equal(stopResponse.status, 200);
    const stop = await stopResponse.json();
    assert.equal((await request(`/api/machine-stops/${stop.id}/end`, { method: 'PATCH', headers: authHeaders(office) })).status, 403);
    assert.equal((await request(`/api/machine-stops/${stop.id}/end`, { method: 'PATCH', headers: authHeaders(kiosk) })).status, 200);
  });
});
