'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-multi-order-delivery-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'multi-order-delivery.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');
const { ITEM_STATUS, ORDER_STATUS } = require('../status-contracts');

let baseUrl;

function seedUser(username, role, pin) {
  return db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString()).lastInsertRowid;
}

function seedOrder({ orderNum, customerId, address, weight = 10 }) {
  const orderId = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,status,total_weight,delivery_address)
    VALUES (?,?,?,?,?,?)
  `).run(orderNum, customerId, 'משרד', ORDER_STATUS.DONE_WAITING_PICKUP, weight, address).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num) VALUES (?,?)').run(orderId, 1).lastInsertRowid;
  db.prepare(`
    INSERT INTO items
      (pallet_id,shape_name,diameter,segments,quantity,produced_qty,total_weight,total_length_mm,status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(palletId, `${orderNum} מוט`, 12, JSON.stringify([{ length_mm: 1200, angle_deg: null }]), 1, 1, weight, 1200, ITEM_STATUS.DONE);
  return orderId;
}

async function request(pathname, options = {}) { return fetch(`${baseUrl}${pathname}`, options); }
async function token(username, pin) {
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}
function authHeaders(accessToken) { return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }; }

test('one truck can load several compatible orders and issue one grouped delivery note', async (t) => {
  seedUser('multi-warehouse', 'warehouse', '8111');
  seedUser('multi-office', 'office', '8112');
  const customerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run('לקוח מאוחד', '0500000000').lastInsertRowid;
  const otherCustomerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run('לקוח אחר', '0500000001').lastInsertRowid;
  const orderA = seedOrder({ orderNum: 'MULTI-A', customerId, address: 'אתר צפון 1', weight: 12.5 });
  const orderB = seedOrder({ orderNum: 'MULTI-B', customerId, address: 'אתר צפון 1', weight: 17.5 });
  const wrongCustomer = seedOrder({ orderNum: 'MULTI-C', customerId: otherCustomerId, address: 'אתר צפון 1', weight: 8 });
  const wrongAddress = seedOrder({ orderNum: 'MULTI-D', customerId, address: 'אתר דרום 2', weight: 9 });
  const partialA = seedOrder({ orderNum: 'MULTI-PART-A', customerId, address: 'אתר חלקי', weight: 5 });
  const partialB = seedOrder({ orderNum: 'MULTI-PART-B', customerId, address: 'אתר חלקי', weight: 6 });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const warehouse = await token('multi-warehouse', '8111');
  const office = await token('multi-office', '8112');
  const endpoint = '/api/loading/multi-order-card-sessions';
  assert.equal((await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_ids: [orderA, orderB] }) })).status, 401);
  assert.equal((await request(endpoint, { method: 'POST', headers: authHeaders(office), body: JSON.stringify({ order_ids: [orderA, orderB] }) })).status, 403);

  const candidates = await request('/api/loading/multi-order-candidates', { headers: authHeaders(warehouse) });
  assert.equal(candidates.status, 200);
  assert.ok((await candidates.json()).some(row => row.id === orderA && row.card_count === 1));

  const customerMismatch = await request(endpoint, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_ids: [orderA, wrongCustomer] }),
  });
  assert.equal(customerMismatch.status, 409);
  assert.equal((await customerMismatch.json()).error, 'multi_order_customer_mismatch');
  const addressMismatch = await request(endpoint, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_ids: [orderA, wrongAddress] }),
  });
  assert.equal(addressMismatch.status, 409);
  assert.equal((await addressMismatch.json()).error, 'multi_order_destination_mismatch');

  const startedResponse = await request(endpoint, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_ids: [orderA, orderB] }),
  });
  assert.equal(startedResponse.status, 201);
  const started = await startedResponse.json();
  assert.equal(started.multi_order, true);
  assert.equal(started.order_count, 2);
  assert.equal(started.expected_count, 2);
  assert.equal(started.expected_weight, 30);
  assert.deepEqual(started.orders.map(order => order.order_num), ['MULTI-A', 'MULTI-B']);
  assert.ok(started.cards.every(card => card.order_id && card.order_num));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_loading_sessions WHERE loading_group_uid=? AND status='active'").get(started.group_uid).count, 2);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderA).status, ORDER_STATUS.LOADING);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderB).status, ORDER_STATUS.LOADING);

  const resumedResponse = await request(endpoint, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_ids: [orderB, orderA] }),
  });
  assert.equal(resumedResponse.status, 200);
  assert.equal((await resumedResponse.json()).group_uid, started.group_uid);

  async function scan(value) {
    const response = await request(`/api/loading/multi-order-card-sessions/${started.group_uid}/scan`, {
      method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: value }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const tokenA = started.cards.find(card => card.order_id === orderA).worker_card_token;
  const tokenB = started.cards.find(card => card.order_id === orderB).worker_card_token;
  assert.equal((await scan(tokenA)).outcome, 'loaded');
  assert.equal((await scan(tokenA)).outcome, 'duplicate');

  const premature = await request(`/api/loading/multi-order-card-sessions/${started.group_uid}/complete`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(premature.status, 409);
  assert.equal((await premature.json()).error, 'cards_missing');
  assert.equal((await scan(tokenB)).outcome, 'loaded');

  const completeResponse = await request(`/api/loading/multi-order-card-sessions/${started.group_uid}/complete`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(completeResponse.status, 200);
  const completed = await completeResponse.json();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.delivery_note.total_weight, 30);
  assert.match(completed.delivery_note.note_num, /^DN-\d{8}-G\d+$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_notes').get().count, 1);
  const links = db.prepare('SELECT * FROM delivery_note_orders WHERE delivery_note_id=? ORDER BY order_num').all(completed.delivery_note.id);
  assert.deepEqual(links.map(link => [link.order_num, link.total_weight]), [['MULTI-A', 12.5], ['MULTI-B', 17.5]]);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderA).status, ORDER_STATUS.ON_THE_WAY);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderB).status, ORDER_STATUS.ON_THE_WAY);

  const print = await request(completed.delivery_note.print_url, { headers: authHeaders(warehouse) });
  assert.equal(print.status, 200);
  const printHtml = await print.text();
  assert.match(printHtml, /הזמנות:/);
  assert.match(printHtml, /MULTI-A/);
  assert.match(printHtml, /MULTI-B/);
  assert.match(printHtml, /12[.]5 ק"ג/);
  assert.match(printHtml, /17[.]5 ק"ג/);
  assert.match(printHtml, /סה"כ למשאית זו: 30 ק"ג/);

  const bySecondOrder = await request(`/api/delivery-notes?order_id=${orderB}`, { headers: authHeaders(warehouse) });
  assert.equal(bySecondOrder.status, 200);
  assert.equal((await bySecondOrder.json())[0].id, completed.delivery_note.id);
  const replay = await request(`/api/loading/multi-order-card-sessions/${started.group_uid}/complete`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).delivery_note.id, completed.delivery_note.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_notes').get().count, 1);

  const partialStartResponse = await request(endpoint, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_ids: [partialA, partialB] }),
  });
  assert.equal(partialStartResponse.status, 201);
  const partialStart = await partialStartResponse.json();
  const partialAToken = partialStart.cards.find(card => card.order_id === partialA).worker_card_token;
  const partialScan = await request(`/api/loading/multi-order-card-sessions/${partialStart.group_uid}/scan`, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: partialAToken }),
  });
  assert.equal((await partialScan.json()).outcome, 'loaded');
  const partialDeparture = await request(`/api/loading/multi-order-card-sessions/${partialStart.group_uid}/partial-departure`, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ reason: 'משאית מלאה' }),
  });
  assert.equal(partialDeparture.status, 200);
  const partialResult = await partialDeparture.json();
  assert.equal(partialResult.delivery_note.total_weight, 5);
  assert.deepEqual(
    db.prepare('SELECT order_num,total_weight FROM delivery_note_orders WHERE delivery_note_id=?').all(partialResult.delivery_note.id),
    [{ order_num: 'MULTI-PART-A', total_weight: 5 }],
  );
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(partialA).status, ORDER_STATUS.ON_THE_WAY);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(partialB).status, ORDER_STATUS.DONE_WAITING_PICKUP);
});

test('warehouse UI exposes a responsive multi-order selector and reuses the card scanner', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'warehouse.html'), 'utf8');
  assert.match(html, /בחר כמה הזמנות לאותה תעודת משלוח/);
  assert.match(html, /\/api\/loading\/multi-order-candidates/);
  assert.match(html, /\/api\/loading\/multi-order-card-sessions/);
  assert.match(html, /currentLoadingSession[.]multi_order/);
  assert.match(html, /row[.]order_num/);
});
