'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-device-enrollment-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'device-enrollment-test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'device-enrollment.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
// This test covers the supervised legacy migration path. Production defaults
// to invitation-only enrollment (covered by worker-invitations.test.js).
process.env.ALLOW_UNINVITED_DEVICE_ENROLLMENT = 'true';

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

let baseUrl;

function seedUser(username, role, pin) {
  return db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString()).lastInsertRowid;
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function login(username, pin) {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

test('device enrollment stays blocked until an admin approves and can revoke it', async (t) => {
  seedUser('device-admin', 'admin', '8801');
  seedUser('device-worker', 'production', '8802');

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const adminToken = await login('device-admin', '8801');
  const workerToken = await login('device-worker', '8802');

  const initial = await request('/api/device-enrollment/status');
  assert.equal(initial.status, 200);
  assert.deepEqual((({ registered, status, approved }) => ({ registered, status, approved }))(await initial.json()), {
    registered: false,
    status: 'unregistered',
    approved: false,
  });

  const createdResponse = await request('/api/device-enrollment/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requester_name: 'עובד ייצור',
      device_name: 'טלפון אולם ייצור',
      platform: 'Android',
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, 'pending');
  assert.equal(created.approved, false);
  assert.match(created.credential, /^DEV-[A-F0-9]{16}\./);

  const deviceHeaders = { 'X-IronBend-Device': created.credential };
  const pending = await request('/api/device-enrollment/status', { headers: deviceHeaders });
  assert.equal((await pending.json()).status, 'pending');

  const workerList = await request('/api/device-enrollment/requests', {
    headers: { Authorization: `Bearer ${workerToken}` },
  });
  assert.equal(workerList.status, 403);

  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const listResponse = await request('/api/device-enrollment/requests', { headers: adminHeaders });
  assert.equal(listResponse.status, 200);
  const requests = await listResponse.json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'pending');
  assert.equal('credential' in requests[0], false);
  assert.equal('credential_hash' in requests[0], false);

  const approvedResponse = await request(`/api/device-enrollment/requests/${created.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approvedResponse.status, 200);
  assert.equal((await approvedResponse.json()).approved, true);

  const approved = await request('/api/device-enrollment/status', { headers: deviceHeaders });
  const approvedBody = await approved.json();
  assert.equal(approvedBody.status, 'approved');
  assert.equal(approvedBody.approved, true);

  const revokedResponse = await request(`/api/device-enrollment/requests/${created.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'revoked' }),
  });
  assert.equal(revokedResponse.status, 200);
  const revoked = await request('/api/device-enrollment/status', { headers: deviceHeaders });
  assert.equal((await revoked.json()).status, 'revoked');

  const audit = db.prepare(`
    SELECT old_value,new_value,user_name FROM audit_log
    WHERE entity_type='device_enrollment' AND entity_id=?
    ORDER BY id
  `).all(created.id);
  assert.deepEqual(audit.map(row => [row.old_value, row.new_value]), [
    ['pending', 'approved'],
    ['approved', 'revoked'],
  ]);
});
