'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-quotation-http-auth-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'quotation-http-auth-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

function seedUser(username, role, pin) {
  db.prepare('INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at) VALUES (?,?,?,?,?,?,?)')
    .run(username, username, role, pin, hashPin(pin, 4), 1, new Date().toISOString());
}

async function login(baseUrl, username, pin) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).access_token;
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function payload(key) {
  return {
    idempotency_key: key,
    prospect: { name: 'JWT Prospect' },
    lines: [{ description: 'JWT line', quantity: 1, unit: 'pcs', pricing_quantity: 1, pricing_unit: 'pcs', unit_price: 25 }],
  };
}

test('quotation routes enforce the application JWT roles over HTTP', async t => {
  seedUser('quote-sales', 'sales', '3101');
  seedUser('quote-office', 'office', '3102');
  seedUser('quote-finance', 'finance', '3103');
  seedUser('quote-manager', 'manager', '3104');
  seedUser('quote-warehouse', 'warehouse', '3105');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const [sales, office, finance, manager, warehouse] = await Promise.all([
    login(baseUrl, 'quote-sales', '3101'),
    login(baseUrl, 'quote-office', '3102'),
    login(baseUrl, 'quote-finance', '3103'),
    login(baseUrl, 'quote-manager', '3104'),
    login(baseUrl, 'quote-warehouse', '3105'),
  ]);

  assert.equal((await fetch(`${baseUrl}/api/quotations`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/quotations`, { headers: headers(warehouse) })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/quotations`, { headers: headers(finance) })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/quotations`, { method: 'POST', headers: headers(finance), body: JSON.stringify(payload('finance-no-write')) })).status, 403);

  const createdResponse = await fetch(`${baseUrl}/api/quotations`, {
    method: 'POST', headers: headers(sales), body: JSON.stringify(payload('jwt-create')),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal((await fetch(`${baseUrl}/api/quotations/${created.id}/issue`, {
    method: 'POST', headers: headers(sales), body: JSON.stringify({ idempotency_key: 'sales-no-issue', expected_version: 1 }),
  })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/quotations/${created.id}/issue`, {
    method: 'POST', headers: headers(office), body: JSON.stringify({ idempotency_key: 'office-issue', expected_version: 1 }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/quotations/${created.id}/accept`, {
    method: 'POST', headers: headers(office), body: JSON.stringify({ idempotency_key: 'office-no-accept' }),
  })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/quotations/${created.id}/accept`, {
    method: 'POST', headers: headers(manager), body: JSON.stringify({ idempotency_key: 'manager-accept' }),
  })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
});
