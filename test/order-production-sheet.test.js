'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-production-sheet-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'production-sheet.db');
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

function seedOrder() {
  const customerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)').run('Live production customer', '0500000000').lastInsertRowid;
  const orderId = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,status,total_weight)
    VALUES (?,?,?,?,?)
  `).run('LIVE-PROD-1', customerId, 'משרד', ORDER_STATUS.DONE_WAITING_PICKUP, 500).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num) VALUES (?,?)').run(orderId, 1).lastInsertRowid;
  return { orderId, palletId };
}

function seedItem(palletId, values) {
  return db.prepare(`
    INSERT INTO items
      (pallet_id,shape_name,diameter,segments,quantity,produced_qty,total_weight,total_length_mm,status,shape_snapshot_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    palletId,
    values.shape_name || 'מוט ישר',
    values.diameter,
    values.segments || JSON.stringify([{ length_mm: 1000, angle_deg: null }]),
    values.quantity || 1,
    values.produced_qty || 0,
    values.total_weight || 1,
    values.total_length_mm || 1000,
    values.status || ITEM_STATUS.WAITING,
    values.shape_snapshot_json || null,
  ).lastInsertRowid;
}

function seedApprovedLot(diameter, kg) {
  db.prepare(`
    INSERT INTO raw_material (material_type,diameter,verification_status,weight_received,active)
    VALUES ('coil',?,'approved',?,1)
  `).run(diameter, kg);
}

function pileSnapshot() {
  return calculatePileCage({
    shapeId: 'live-production-pile',
    roundPileCage: true,
    pileDiameterMm: 600,
    pileLengthMm: 12000,
    longitudinalBars: {
      totalBars: 10,
      defaultDiameterMm: 20,
      defaultLengthMm: 12000,
      pattern: [
        { type: 'straight', lengthMm: 12000 },
        { type: 'L', lengthMm: 12000, bendLengthMm: 200 },
      ],
    },
    spiral: {
      barDiameterMm: 8,
      outerDiameterMm: 480,
      pitchMode: 'zones',
      zones: [
        { name: 'A', lengthMm: 3000, pitchMm: 150 },
        { name: 'B', lengthMm: 2000, noWrap: true },
        { name: 'C', lengthMm: 7000, pitchMm: 200 },
      ],
    },
    hoops: { enabled: true, hoopBarDiameterMm: 18, outerDiameterMm: 420, spacingMode: 'byQuantity', quantity: 5, firstHoopOffsetMm: 1500, spacingMm: 300 },
  });
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function token(username, pin) {
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

test('live order production sheet projects real item, material and canonical pile-card states without writes', async (t) => {
  seedUser('live-warehouse', 'warehouse', '4011');
  seedUser('live-production', 'production', '4012');
  seedUser('live-office', 'office', '4013');
  const { orderId, palletId } = seedOrder();
  seedItem(palletId, { diameter: 12, status: ITEM_STATUS.DONE, quantity: 4, produced_qty: 4, total_weight: 20 });
  seedItem(palletId, { diameter: 14, status: ITEM_STATUS.IN_PRODUCTION, quantity: 3, total_weight: 22 });
  const shortageItemId = seedItem(palletId, { diameter: 16, status: ITEM_STATUS.WAITING, quantity: 2, total_weight: 30 });
  const snapshot = pileSnapshot();
  seedItem(palletId, {
    shape_name: 'PILE CAGE', diameter: 20, status: ITEM_STATUS.WAITING,
    quantity: 1, total_weight: snapshot.calculated.totalWeightKg, total_length_mm: 12000,
    shape_snapshot_json: JSON.stringify(snapshot), segments: '[]',
  });
  db.prepare(`INSERT INTO inventory_reservations (order_id,item_id,diameter,material_type,reserved_kg,status) VALUES (?,?,?,?,?,'active')`)
    .run(orderId, shortageItemId, 16, 'coil', 30);
  seedApprovedLot(8, 1000);
  seedApprovedLot(18, 1000);
  seedApprovedLot(20, 1000);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const warehouse = await token('live-warehouse', '4011');
  const production = await token('live-production', '4012');
  const office = await token('live-office', '4013');
  const before = {
    items: db.prepare('SELECT COUNT(*) AS count FROM items').get().count,
    reservations: db.prepare('SELECT COUNT(*) AS count FROM inventory_reservations').get().count,
    rawMaterial: db.prepare('SELECT COUNT(*) AS count FROM raw_material').get().count,
    scans: db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count,
    loadingSessions: db.prepare('SELECT COUNT(*) AS count FROM order_loading_sessions').get().count,
  };

  assert.equal((await request(`/api/production/orders/${orderId}/live-sheet`)).status, 401);
  const warehouseResponse = await request(`/api/production/orders/${orderId}/live-sheet`, { headers: authHeaders(warehouse) });
  assert.equal(warehouseResponse.status, 200);
  const sheet = await warehouseResponse.json();
  assert.equal(sheet.order.order_num, 'LIVE-PROD-1');
  assert.equal(sheet.may_start_loading, true);
  assert.equal(sheet.loading_state, 'ready_to_start');
  assert.equal(sheet.loading_entry_url, `/warehouse.html?load_order=${orderId}&autostart=1`);
  assert.ok(sheet.cards.some(card => card.state.code === 'completed'));
  assert.ok(sheet.cards.some(card => card.state.code === 'in_production'));
  const shortage = sheet.cards.find(card => card.state.code === 'material_shortage');
  assert.ok(shortage);
  assert.equal(shortage.diameter_mm, 16);
  assert.equal(shortage.material.shortage_kg, 30);

  const pileCards = sheet.cards.filter(card => card.item_id !== shortage.item_id && card.component_type);
  assert.equal(pileCards.length, 5);
  assert.deepEqual(pileCards.map(card => card.component_type), [
    'longitudinal_straight_bar', 'longitudinal_l_bar', 'spiral_consolidated', 'hoop_ring', 'pile_assembly',
  ]);
  assert.equal(pileCards.find(card => card.component_type === 'pile_assembly').material, null);
  assert.match(pileCards.find(card => card.component_type === 'spiral_consolidated').shape_svg, /pile-spiral-component/);

  const productionResponse = await request(`/api/production/orders/${orderId}/live-sheet`, { headers: authHeaders(production) });
  assert.equal(productionResponse.status, 200);
  assert.equal((await productionResponse.json()).may_start_loading, false);
  assert.equal((await request(`/api/production/orders/${orderId}/live-sheet`, { headers: authHeaders(office) })).status, 200);
  assert.equal((await request('/production-order-sheet.html')).status, 200);

  assert.deepEqual({
    items: db.prepare('SELECT COUNT(*) AS count FROM items').get().count,
    reservations: db.prepare('SELECT COUNT(*) AS count FROM inventory_reservations').get().count,
    rawMaterial: db.prepare('SELECT COUNT(*) AS count FROM raw_material').get().count,
    scans: db.prepare('SELECT COUNT(*) AS count FROM scan_log').get().count,
    loadingSessions: db.prepare('SELECT COUNT(*) AS count FROM order_loading_sessions').get().count,
  }, before);
});
