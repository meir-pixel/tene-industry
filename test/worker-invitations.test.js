'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-worker-invitations-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'worker-invitation-test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'worker-invitations.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
delete process.env.ALLOW_UNINVITED_DEVICE_ENROLLMENT;

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

test('a personal worker invitation expires, creates a pending person/device pair, and approval activates it', async (t) => {
  seedUser('invite-admin', 'admin', '7701');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const legacyAttempt = await request('/api/device-enrollment/requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_name: 'אורח', device_name: 'טלפון' }),
  });
  assert.equal(legacyAttempt.status, 403);
  assert.equal((await legacyAttempt.json()).error, 'worker_invitation_required');

  const adminToken = await login('invite-admin', '7701');
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const create = await request('/api/worker-invitations', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ worker_name: 'דוד כהן', phone: '050-1234567', role: 'production' }),
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  const activation = new URL(created.activation_url);
  const rawToken = activation.searchParams.get('token');
  assert.match(rawToken, /^WINV-[A-F0-9]{16}\./);
  assert.equal(created.invitation.status, 'pending');

  const inspect = await request(`/api/worker-invitations/activation?token=${encodeURIComponent(rawToken)}`);
  assert.equal(inspect.status, 200);
  assert.deepEqual((({ worker_name, role, status }) => ({ worker_name, role, status }))(await inspect.json()), {
    worker_name: 'דוד כהן', role: 'production', status: 'opened',
  });

  const claim = await request('/api/worker-invitations/activation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: rawToken, username: 'david.cohen', pin: '1234', device_name: 'טלפון דוד', platform: 'Android' }),
  });
  assert.equal(claim.status, 201);
  const claimed = await claim.json();
  assert.equal(claimed.status, 'pending_approval');
  assert.match(claimed.device_credential, /^DEV-[A-F0-9]{16}\./);

  const inactiveUser = db.prepare('SELECT id,active,role,phone FROM users WHERE username=?').get('david.cohen');
  assert.equal(inactiveUser.active, 0);
  assert.equal(inactiveUser.role, 'production');
  assert.equal(inactiveUser.phone, '050-1234567');
  const device = db.prepare('SELECT * FROM device_enrollment_requests WHERE requester_user_id=?').get(inactiveUser.id);
  assert.equal(device.status, 'pending');
  assert.ok(device.invitation_id);

  const earlyLogin = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'david.cohen', pin: '1234' }),
  });
  assert.equal(earlyLogin.status, 401);

  const approval = await request(`/api/device-enrollment/requests/${device.id}`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approval.status, 200);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(inactiveUser.id).active, 1);

  const workerToken = await login('david.cohen', '1234');
  assert.ok(workerToken);
  const status = await request('/api/device-enrollment/status', { headers: { 'X-IronBend-Device': claimed.device_credential } });
  assert.equal((await status.json()).status, 'approved');

  const reused = await request('/api/worker-invitations/activation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: rawToken, username: 'another.worker', pin: '1234', device_name: 'טלפון אחר' }),
  });
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).error, 'invitation_already_used');

  const expiring = await request('/api/worker-invitations', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ worker_name: 'נועה לוי', role: 'warehouse' }),
  });
  const expiringBody = await expiring.json();
  const expiredToken = new URL(expiringBody.activation_url).searchParams.get('token');
  db.prepare("UPDATE worker_invitations SET expires_at=datetime('now','-1 minute') WHERE id=?").run(expiringBody.invitation.id);
  const expired = await request(`/api/worker-invitations/activation?token=${encodeURIComponent(expiredToken)}`);
  assert.equal(expired.status, 410);
  assert.equal((await expired.json()).error, 'invitation_expired');
});
