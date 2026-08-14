'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-order-loading-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'order-loading.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

let baseUrl;

function seedUser(username, role, pin) {
  return db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString()).lastInsertRowid;
}

function seedOrder(orderNum) {
  const customerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run('Loading Customer', '0500000000').lastInsertRowid;
  return db.prepare(`INSERT INTO orders (order_num,customer_id,channel,status,total_weight) VALUES (?,?,?,?,?)`)
    .run(orderNum, customerId, 'משרד', 'הושלם – ממתין לאיסוף', 123).lastInsertRowid;
}

function seedPackage({ code, orderId, orderNum, status = 'packed', quantity = 10, weight = 12.5 }) {
  return db.prepare(`
    INSERT INTO packages (package_code,qr_data,order_id,order_num,item_ids,quantity,weight,status)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(code, JSON.stringify({ code, order_num: orderNum }), orderId, orderNum, '[]', quantity, weight, status).lastInsertRowid;
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
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

test('order-sheet QR opens the live production sheet while package loading remains server-authoritative', async (t) => {
  seedUser('load-warehouse', 'warehouse', '3011');
  seedUser('load-office', 'office', '3012');
  seedUser('load-production', 'production', '3013');
  const orderId = seedOrder('LOAD-ORDER-1');
  const otherOrderId = seedOrder('LOAD-ORDER-2');
  const blockedOrderId = db.prepare('INSERT INTO orders (order_num,customer_id,channel,status,total_weight) VALUES (?,?,?,?,?)')
    .run('LOAD-BLOCKED', db.prepare('SELECT customer_id FROM orders WHERE id=?').get(orderId).customer_id, 'משרד', 'בייצור', 10).lastInsertRowid;
  const packageA = seedPackage({ code: 'PKG-LOAD-A', orderId, orderNum: 'LOAD-ORDER-1', weight: 12.5 });
  const packageB = seedPackage({ code: 'PKG-LOAD-B', orderId, orderNum: 'LOAD-ORDER-1', weight: 8.75 });
  seedPackage({ code: 'PKG-OTHER', orderId: otherOrderId, orderNum: 'LOAD-ORDER-2', weight: 7 });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const warehouse = await token('load-warehouse', '3011');
  const office = await token('load-office', '3012');
  const production = await token('load-production', '3013');
  const productionScanCountBefore = db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count;
  const deliveriesBefore = db.prepare('SELECT COUNT(*) AS count FROM deliveries').get().count;

  assert.equal((await request(`/api/loading/orders/${orderId}`)).status, 401);
  assert.equal((await request(`/api/loading/orders/${orderId}`, { headers: authHeaders(office) })).status, 403);
  assert.equal((await request(`/api/loading/orders/${orderId}`, { headers: authHeaders(production) })).status, 403);
  assert.equal((await request('/api/loading/sessions', {
    method: 'POST', headers: authHeaders(office), body: JSON.stringify({ order_id: orderId }),
  })).status, 403);
  const blockedStart = await request('/api/loading/sessions', {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: blockedOrderId }),
  });
  assert.equal(blockedStart.status, 409);
  assert.equal((await blockedStart.json()).error, 'order_not_ready_for_loading');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_loading_sessions WHERE order_id=?').get(blockedOrderId).count, 0);

  const printResponse = await request(`/api/orders/${orderId}/print-a4`, { headers: authHeaders(office) });
  assert.equal(printResponse.status, 200);
  const printHtml = await printResponse.text();
  assert.match(printHtml, new RegExp(`production-order-sheet[.]html[?]order=${orderId}`));
  assert.match(printHtml, /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(printHtml, /cdn[.]jsdelivr[.]net\/npm\/qrcode/);
  assert.doesNotMatch(printHtml, />QR<\/div>/);

  const preflight = await request(`/api/loading/orders/${orderId}`, { headers: authHeaders(warehouse) });
  assert.equal(preflight.status, 200);
  const preflightBody = await preflight.json();
  assert.deepEqual({
    order: preflightBody.order,
    active_session_uid: preflightBody.active_session_uid,
    eligible_package_count: preflightBody.eligible_package_count,
    eligible_package_weight: preflightBody.eligible_package_weight,
  }, {
    order: { id: orderId, order_num: 'LOAD-ORDER-1', status: 'הושלם – ממתין לאיסוף', total_weight: 123 },
    active_session_uid: null,
    eligible_package_count: 2,
    eligible_package_weight: 21.25,
  });

  const started = await request('/api/loading/sessions', {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }),
  });
  assert.equal(started.status, 201);
  const session = await started.json();
  assert.match(session.session_uid, /^LOAD-/);
  assert.equal(session.expected_count, 2);
  assert.equal(session.loaded_count, 0);
  assert.equal(session.missing_count, 2);
  assert.equal(session.expected_weight, 21.25);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, 'בהעמסה');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type='order' AND entity_id=? AND new_value='בהעמסה'").get(orderId).count, 1);

  // The package scanner is fail-closed if the order has left the loading
  // state, even when an old active session URL is still open on a device.
  db.prepare('UPDATE orders SET status=? WHERE id=?').run('הושלם – ממתין לאיסוף', orderId);
  const blockedScan = await request(`/api/loading/sessions/${session.session_uid}/scan`, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: 'PKG-LOAD-A' }),
  });
  assert.equal(blockedScan.status, 409);
  assert.equal((await blockedScan.json()).error, 'order_not_in_loading');
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageA).status, 'packed');
  db.prepare('UPDATE orders SET status=? WHERE id=?').run('בהעמסה', orderId);

  const resumed = await request('/api/loading/sessions', {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }),
  });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).session_uid, session.session_uid);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_loading_sessions').get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_loading_events WHERE event_type='started'").get().count, 1);

  async function scan(value) {
    const response = await request(`/api/loading/sessions/${session.session_uid}/scan`, {
      method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: value }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  assert.equal((await scan('NOT-A-PACKAGE')).outcome, 'unknown');
  assert.equal((await scan('PKG-OTHER')).outcome, 'wrong_order');
  assert.equal(db.prepare('SELECT loaded_count FROM (SELECT COUNT(*) AS loaded_count FROM order_loading_session_packages WHERE state=\'loaded\')').get().loaded_count, 0);

  const race = await Promise.all([
    scan(JSON.stringify({ code: 'PKG-LOAD-A' })),
    scan('PKG-LOAD-A'),
  ]);
  assert.deepEqual(race.map(row => row.outcome).sort(), ['duplicate', 'loaded']);
  assert.equal(db.prepare("SELECT state FROM order_loading_session_packages WHERE session_id=? AND package_id=?").get(session.id, packageA).state, 'loaded');

  const incomplete = await request(`/api/loading/sessions/${session.session_uid}/complete`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(incomplete.status, 409);
  const incompleteBody = await incomplete.json();
  assert.equal(incompleteBody.error, 'packages_missing');
  assert.equal(incompleteBody.missing_count, 1);

  // A truck may depart with the package scanned so far. Its delivery note
  // must contain only that package; the remaining package stays available to
  // the next loading session for the same order.
  const noReason = await request(`/api/loading/sessions/${session.session_uid}/partial-departure`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(noReason.status, 400);
  assert.equal((await noReason.json()).error, 'partial_departure_reason_required');

  const partial = await request(`/api/loading/sessions/${session.session_uid}/partial-departure`, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ reason: 'משאית מלאה' }),
  });
  assert.equal(partial.status, 200);
  const partialState = await partial.json();
  assert.equal(partialState.status, 'completed');
  assert.equal(partialState.departure_type, 'partial');
  assert.equal(partialState.delivery_note.total_weight, 12.5);
  assert.match(partialState.delivery_note.note_num, /^DN-\d{8}-L\d+$/);
  assert.match(partialState.delivery_note.print_url, /\/api\/delivery-notes\/\d+\/print$/);
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageA).status, 'loaded');
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageB).status, 'packed');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, 'אספקה חלקית');
  const firstNote = db.prepare('SELECT * FROM delivery_notes WHERE id=?').get(partialState.delivery_note.id);
  assert.equal(JSON.parse(firstNote.packages_json).length, 1);
  assert.equal(JSON.parse(firstNote.packages_json)[0].package_code, 'PKG-LOAD-A');
  assert.equal(firstNote.total_weight, 12.5);
  const notePrint = await request(partialState.delivery_note.print_url, { headers: authHeaders(warehouse) });
  assert.equal(notePrint.status, 200);
  const notePrintHtml = await notePrint.text();
  assert.match(notePrintHtml, /PKG-LOAD-A/);
  assert.doesNotMatch(notePrintHtml, /PKG-LOAD-B/);

  const secondStarted = await request('/api/loading/sessions', {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }),
  });
  assert.equal(secondStarted.status, 201);
  const secondSession = await secondStarted.json();
  assert.equal(secondSession.expected_count, 1);
  assert.equal(secondSession.packages[0].package_code, 'PKG-LOAD-B');
  const secondScan = await request(`/api/loading/sessions/${secondSession.session_uid}/scan`, {
    method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: 'PKG-LOAD-B' }),
  });
  assert.equal(secondScan.status, 200);
  assert.equal((await secondScan.json()).outcome, 'loaded');

  const completed = await request(`/api/loading/sessions/${secondSession.session_uid}/complete`, {
    method: 'POST', headers: authHeaders(warehouse), body: '{}',
  });
  assert.equal(completed.status, 200);
  const completedState = await completed.json();
  assert.equal(completedState.status, 'completed');
  assert.equal(completedState.departure_type, 'full');
  assert.equal(completedState.loaded_weight, 8.75);
  assert.equal(completedState.delivery_note.total_weight, 8.75);
  assert.notEqual(completedState.delivery_note.id, partialState.delivery_note.id);
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageA).status, 'loaded');
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageB).status, 'loaded');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delivery_notes WHERE order_id=?').get(orderId).count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count, productionScanCountBefore);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM deliveries').get().count, deliveriesBefore);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, 'בדרך ללקוח');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type='order' AND entity_id=? AND new_value='בדרך ללקוח'").get(orderId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_loading_events WHERE event_type='wrong_order_scan'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM order_loading_events WHERE event_type='duplicate_scan'").get().count, 1);
});
