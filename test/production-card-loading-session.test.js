'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-card-loading-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'card-loading.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');
const { calculatePileCage } = require('../modules/steel-rebar/pile-cage-engine');
const { ITEM_STATUS, ORDER_STATUS } = require('../status-contracts');

let baseUrl;

function seedUser(username, role, pin) {
  return db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString()).lastInsertRowid;
}

function seedOrder(orderNum, status = ORDER_STATUS.DONE_WAITING_PICKUP) {
  const customerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run(`Customer ${orderNum}`, '0500000000').lastInsertRowid;
  const orderId = db.prepare(`INSERT INTO orders (order_num,customer_id,channel,status,total_weight) VALUES (?,?,?,?,?)`)
    .run(orderNum, customerId, 'משרד', status, 500).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num) VALUES (?,?)').run(orderId, 1).lastInsertRowid;
  return { orderId, palletId };
}

function seedItem(palletId, values = {}) {
  return db.prepare(`
    INSERT INTO items
      (pallet_id,shape_name,diameter,segments,quantity,produced_qty,total_weight,total_length_mm,status,shape_snapshot_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    palletId,
    values.shape_name || 'מוט ישר',
    values.diameter || 12,
    values.segments || JSON.stringify([{ length_mm: 1200, angle_deg: null }]),
    values.quantity || 1,
    values.produced_qty == null ? values.quantity || 1 : values.produced_qty,
    values.total_weight || 10,
    values.total_length_mm || 1200,
    values.status || ITEM_STATUS.DONE,
    values.shape_snapshot_json || null,
  ).lastInsertRowid;
}

function pileSnapshot() {
  return calculatePileCage({
    shapeId: 'loading-pile', roundPileCage: true, pileDiameterMm: 600, pileLengthMm: 12000,
    longitudinalBars: { totalBars: 10, defaultDiameterMm: 20, defaultLengthMm: 12000, pattern: [
      { type: 'straight', lengthMm: 12000 }, { type: 'L', lengthMm: 12000, bendLengthMm: 200 },
    ] },
    spiral: { barDiameterMm: 8, outerDiameterMm: 480, pitchMode: 'zones', zones: [
      { name: 'A', lengthMm: 3000, pitchMm: 150 }, { name: 'B', lengthMm: 2000, noWrap: true }, { name: 'C', lengthMm: 7000, pitchMm: 200 },
    ] },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  });
}

async function request(pathname, options = {}) { return fetch(`${baseUrl}${pathname}`, options); }
async function token(username, pin) {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }) });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}
function authHeaders(accessToken) { return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }; }
function workerUrl(token) { return `https://scan.example/worker-visual.html?scan=1&card=${encodeURIComponent(token)}`; }

test('one printed worker-card QR supports persisted, partial, fail-closed truck loading without package-label side effects', async (t) => {
  seedUser('card-warehouse', 'warehouse', '7011');
  seedUser('card-office', 'office', '7012');
  seedUser('card-production', 'production', '7013');
  const { orderId, palletId } = seedOrder('CARD-LOAD-1');
  seedItem(palletId, { shape_name: 'Ø12 CARD A', diameter: 12, quantity: 2, total_weight: 18, total_length_mm: 2400 });
  seedItem(palletId, { shape_name: 'Ø16 CARD B', diameter: 16, quantity: 3, total_weight: 27, total_length_mm: 3000 });
  const { orderId: blockedOrderId, palletId: blockedPalletId } = seedOrder('CARD-LOAD-BLOCKED');
  seedItem(blockedPalletId, { shape_name: 'Ø20 WAIT', diameter: 20, quantity: 1, total_weight: 11, status: ITEM_STATUS.WAITING });
  const { orderId: otherOrderId, palletId: otherPalletId } = seedOrder('CARD-LOAD-OTHER');
  seedItem(otherPalletId, { shape_name: 'Ø10 OTHER', diameter: 10, total_weight: 7 });
  const { orderId: racingOrderId, palletId: racingPalletId } = seedOrder('CARD-LOAD-RACE');
  seedItem(racingPalletId, { shape_name: 'Ø14 RACE', diameter: 14, total_weight: 9 });
  const packageId = db.prepare(`INSERT INTO packages (package_code,order_id,order_num,status,weight) VALUES (?,?,?,?,?)`)
    .run('LEGACY-PKG-CARD', orderId, 'CARD-LOAD-1', 'packed', 999).lastInsertRowid;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => closeServer(resolve)); db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const warehouse = await token('card-warehouse', '7011');
  const office = await token('card-office', '7012');
  const production = await token('card-production', '7013');
  const packageBefore = db.prepare('SELECT status,shipped_at FROM packages WHERE id=?').get(packageId);
  const scansBefore = db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count;

  assert.equal((await request('/api/loading/card-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId }) })).status, 401);
  for (const denied of [office, production]) {
    assert.equal((await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(denied), body: JSON.stringify({ order_id: orderId }) })).status, 403);
  }
  const blockedStart = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: blockedOrderId }) });
  assert.equal(blockedStart.status, 409);
  assert.equal((await blockedStart.json()).error, 'production_cards_not_completed');

  const racingStarts = await Promise.all([
    request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: racingOrderId }) }),
    request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: racingOrderId }) }),
  ]);
  assert.deepEqual(racingStarts.map(response => response.status).sort(), [200, 201]);
  const racingSessions = await Promise.all(racingStarts.map(response => response.json()));
  assert.equal(racingSessions[0].session_uid, racingSessions[1].session_uid);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM order_loading_sessions WHERE order_id=? AND status='active'`).get(racingOrderId).count, 1);

  const startedResponse = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }) });
  assert.equal(startedResponse.status, 201);
  const started = await startedResponse.json();
  assert.equal(started.scan_unit, 'production_card');
  assert.equal(started.expected_count, 2);
  assert.equal(started.expected_weight, 45);
  assert.equal(started.cards.length, 2);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, ORDER_STATUS.LOADING);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_loading_session_packages WHERE session_id=?').get(started.id).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_loading_card_events WHERE session_id=? AND event_type=?').get(started.id, 'started').count, 1);

  const resumedResponse = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }) });
  assert.equal(resumedResponse.status, 200);
  assert.equal((await resumedResponse.json()).session_uid, started.session_uid);

  // A card introduced after the session begins is not silently accepted. It
  // remains a real, not-yet-produced production card and is reported as such.
  const notReadyItemId = seedItem(palletId, { shape_name: 'Ø20 WAIT', diameter: 20, quantity: 1, total_weight: 11, status: ITEM_STATUS.WAITING });

  const firstToken = started.cards[0].worker_card_token;
  const secondToken = started.cards[1].worker_card_token;
  const otherStartedResponse = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: otherOrderId }) });
  assert.equal(otherStartedResponse.status, 201);
  const otherStarted = await otherStartedResponse.json();
  const otherToken = otherStarted.cards[0].worker_card_token;
  assert.equal((await request(`/api/loading/card-sessions/${otherStarted.session_uid}/partial-departure`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ reason: 'test cleanup' }) })).status, 409);

  async function scan(value) {
    const response = await request(`/api/loading/card-sessions/${started.session_uid}/scan`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: value }) });
    assert.equal(response.status, 200);
    return response.json();
  }
  assert.equal((await scan('UNKNOWN-CARD-QR')).outcome, 'unknown');
  assert.equal((await scan(workerUrl(otherToken))).outcome, 'wrong_order');
  const waitToken = `CARD-LOAD-1-${String(notReadyItemId).padStart(6, '0')}`;
  assert.equal((await scan(waitToken)).outcome, 'not_ready');
  db.prepare('DELETE FROM items WHERE id=?').run(notReadyItemId);

  const concurrent = await Promise.all([scan(firstToken), scan(workerUrl(firstToken))]);
  assert.deepEqual(concurrent.map(row => row.outcome).sort(), ['duplicate', 'loaded']);
  assert.equal(db.prepare(`SELECT state FROM order_loading_session_cards WHERE session_id=? AND worker_card_token=?`).get(started.id, firstToken).state, 'loaded');
  assert.equal(db.prepare('SELECT status FROM packages WHERE id=?').get(packageId).status, packageBefore.status);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count, scansBefore);

  const incomplete = await request(`/api/loading/card-sessions/${started.session_uid}/complete`, { method: 'POST', headers: authHeaders(warehouse), body: '{}' });
  assert.equal(incomplete.status, 409);
  assert.equal((await incomplete.json()).error, 'cards_missing');
  const partial = await request(`/api/loading/card-sessions/${started.session_uid}/partial-departure`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ reason: 'משאית מלאה' }) });
  assert.equal(partial.status, 200);
  const partialState = await partial.json();
  assert.equal(partialState.status, 'completed');
  assert.equal(partialState.departure_type, 'partial');
  assert.equal(partialState.delivery_note.total_weight, 18);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, ORDER_STATUS.PARTIAL_DELIVERY);
  const firstNote = db.prepare('SELECT * FROM delivery_notes WHERE id=?').get(partialState.delivery_note.id);
  assert.deepEqual(JSON.parse(firstNote.packages_json), []);
  assert.equal(JSON.parse(firstNote.items_json).length, 1);
  assert.equal(JSON.parse(firstNote.items_json)[0].worker_card_token, firstToken);
  const printed = await request(partialState.delivery_note.print_url, { headers: authHeaders(warehouse) });
  assert.equal(printed.status, 200);
  const printHtml = await printed.text();
  assert.match(printHtml, /כרטיס עבודה/);
  assert.match(printHtml, new RegExp(firstToken));
  assert.doesNotMatch(printHtml, /LEGACY-PKG-CARD/);

  const secondStartResponse = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }) });
  assert.equal(secondStartResponse.status, 201);
  const secondStart = await secondStartResponse.json();
  assert.equal(secondStart.expected_count, 1);
  assert.equal(secondStart.cards[0].worker_card_token, secondToken);
  const secondScan = await request(`/api/loading/card-sessions/${secondStart.session_uid}/scan`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: secondToken }) });
  assert.equal((await secondScan.json()).outcome, 'loaded');
  const full = await request(`/api/loading/card-sessions/${secondStart.session_uid}/complete`, { method: 'POST', headers: authHeaders(warehouse), body: '{}' });
  assert.equal(full.status, 200);
  const fullState = await full.json();
  assert.equal(fullState.departure_type, 'full');
  assert.equal(fullState.delivery_note.total_weight, 27);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, ORDER_STATUS.ON_THE_WAY);
  assert.deepEqual(db.prepare('SELECT status,shipped_at FROM packages WHERE id=?').get(packageId), packageBefore);
  await t.test('a pile cage loads once via the assembly QR while its four steel cards remain production-only', async () => {
  seedUser('pile-loading-warehouse', 'warehouse', '7021');
  const { orderId, palletId } = seedOrder('PILE-LOAD-1');
  const snapshot = pileSnapshot();
  seedItem(palletId, { shape_name: 'PILE CAGE', diameter: 20, quantity: 1, total_weight: snapshot.calculated.totalWeightKg, total_length_mm: 12000, shape_snapshot_json: JSON.stringify(snapshot), segments: '[]' });
  const warehouse = await token('pile-loading-warehouse', '7021');
  const response = await request('/api/loading/card-sessions', { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ order_id: orderId }) });
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal(session.expected_count, 1);
  assert.match(session.cards[0].card_key, /assembly/i);
  const parentItemId = db.prepare('SELECT id FROM items WHERE pallet_id=?').get(palletId).id;
  const componentToken = `PILE-LOAD-1-${String(parentItemId).padStart(6, '0')}-C1`;
  const componentScan = await request(`/api/loading/card-sessions/${session.session_uid}/scan`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: componentToken }) });
  assert.equal(componentScan.status, 200);
  assert.equal((await componentScan.json()).outcome, 'not_final_card');
  const assemblyScan = await request(`/api/loading/card-sessions/${session.session_uid}/scan`, { method: 'POST', headers: authHeaders(warehouse), body: JSON.stringify({ qr_data: session.cards[0].worker_card_token }) });
  assert.equal((await assemblyScan.json()).outcome, 'loaded');
  const complete = await request(`/api/loading/card-sessions/${session.session_uid}/complete`, { method: 'POST', headers: authHeaders(warehouse), body: '{}' });
  assert.equal(complete.status, 200);
  const note = db.prepare('SELECT * FROM delivery_notes WHERE id=?').get((await complete.json()).delivery_note.id);
  assert.equal(note.total_weight, snapshot.calculated.totalWeightKg);
  assert.equal(JSON.parse(note.items_json).length, 1);
  });
});
