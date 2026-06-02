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
process.env.AUTH_ENFORCEMENT = 'false';

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
    '/api/price-list',
    '/api/audit-log',
  ];

  for (const endpoint of endpoints) {
    const response = await request(endpoint, { headers: authHeaders(admin) });
    assert.equal(response.status, 200, `${endpoint} should work for admin`);
    await response.json();
  }
});
