'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-b3-http-auth-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'b3-http-auth-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');
const allocation = require('../services/materialAllocationPlanningV2');

let baseUrl;

function seedUser(username, role, pin) {
  db.prepare('INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at) VALUES (?,?,?,?,?,?,?)')
    .run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString());
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function login(username, pin) {
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

function auth(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('B3 consumption routes enforce the application JWT roles over HTTP', async (t) => {
  seedUser('b3-operator', 'production', '2001');
  seedUser('b3-planner', 'production_planner', '2002');
  seedUser('b3-manager', 'manager', '2003');
  seedUser('b3-admin', 'admin', '2004');
  seedUser('b3-warehouse', 'warehouse', '2005');
  db.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (91001,'B3-HTTP',2)").run();
  db.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (91001,91001,12,10)').run();
  db.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (91001,'b3-http-req',91001,91001,2,12,'coil',10,'unknown','open','manual','r1')").run();
  db.prepare("INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (91001,12,'coil',10,'approved',1)").run();
  allocation.confirmAllocationPlan(db, { material_requirement_id: 91001, idempotency_key: 'b3-http-plan', lines: [{ raw_material_id: 91001, allocated_kg: 10 }] });
  const allocationLineId = db.prepare('SELECT id FROM allocation_plan_lines_v2 WHERE allocation_plan_id=1').get().id;

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const [operator, planner, manager, admin, warehouse] = await Promise.all([
    login('b3-operator', '2001'), login('b3-planner', '2002'), login('b3-manager', '2003'), login('b3-admin', '2004'), login('b3-warehouse', '2005'),
  ]);
  const body = { material_requirement_id: 91001, lines: [{ allocation_plan_line_id: allocationLineId, raw_material_id: 91001, consumed_kg: 5 }] };

  assert.equal((await request('/api/material-consumption-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  assert.equal((await request('/api/material-consumption-reports', { method: 'POST', headers: auth(warehouse), body: JSON.stringify(body) })).status, 403);
  const draftResponse = await request('/api/material-consumption-reports', { method: 'POST', headers: auth(operator), body: JSON.stringify(body) });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();

  assert.equal((await request(`/api/material-consumption-reports/${draft.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: 'unauth-approve' }) })).status, 401);
  assert.equal((await request(`/api/material-consumption-reports/${draft.id}/approve`, { method: 'POST', headers: auth(operator), body: JSON.stringify({ idempotency_key: 'operator-approve' }) })).status, 403);
  const approvedResponse = await request(`/api/material-consumption-reports/${draft.id}/approve`, { method: 'POST', headers: auth(planner), body: JSON.stringify({ idempotency_key: 'planner-approve' }) });
  assert.equal(approvedResponse.status, 200);
  const event = await approvedResponse.json();

  assert.equal((await request(`/api/material-consumption-events/${event.id}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: 'unauth-reverse', lines: [] }) })).status, 401);
  assert.equal((await request(`/api/material-consumption-events/${event.id}/reverse`, { method: 'POST', headers: auth(operator), body: JSON.stringify({ idempotency_key: 'operator-reverse', lines: [] }) })).status, 403);
  assert.equal((await request(`/api/material-consumption-events?material_requirement_id=91001`, { headers: auth(warehouse) })).status, 200);
  const reversal = await request(`/api/material-consumption-events/${event.id}/reverse`, { method: 'POST', headers: auth(manager), body: JSON.stringify({ idempotency_key: 'manager-reverse', lines: [{ original_event_line_id: event.lines[0].id, raw_material_id: 91001, consumed_kg: 5 }] }) });
  assert.equal(reversal.status, 200);

  const adminDraftResponse = await request('/api/material-consumption-reports', { method: 'POST', headers: auth(admin), body: JSON.stringify(body) });
  assert.equal(adminDraftResponse.status, 201);
  const adminDraft = await adminDraftResponse.json();
  assert.equal((await request(`/api/material-consumption-reports/${adminDraft.id}/approve`, { method: 'POST', headers: auth(admin), body: JSON.stringify({ idempotency_key: 'admin-approve' }) })).status, 200);
});
