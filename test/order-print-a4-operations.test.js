'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-a4-operations-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'a4-operations.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

let baseUrl;

function seedOffice() {
  db.prepare(`
    INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at)
    VALUES ('a4-office','A4 Office','office','1234',?,1,?)
  `).run(hashPin('1234', 4), new Date().toISOString());
}

function seedOrder() {
  const customerId = db.prepare('INSERT INTO customers (name,phone) VALUES (?,?)')
    .run('Production summary customer', '0500000000').lastInsertRowid;
  const orderId = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,status,total_weight)
    VALUES ('HZ-2026-045-SUMMARY',?,'משרד','ממתין',1491.43)
  `).run(customerId).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num) VALUES (?,?)')
    .run(orderId, 1).lastInsertRowid;
  return { orderId, palletId };
}

function seedItem(palletId, { quantity, totalLengthMm, totalWeight, segments }) {
  db.prepare(`
    INSERT INTO items
      (pallet_id,shape_name,diameter,segments,quantity,total_weight,total_length_mm,status)
    VALUES (?,'מוט',12,?,?,?,?, 'ממתין')
  `).run(palletId, JSON.stringify(segments), quantity, totalWeight, totalLengthMm);
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

test('A4 production summary counts cutting and bending as overlapping operations', async (t) => {
  seedOffice();
  const { orderId, palletId } = seedOrder();

  // This is the same aggregate operation contract as HZ-2026-045:
  // 87 straight cut bars + 132 bent bars = 219 cutting operations.  The
  // second bent item contains three bends but contributes its one bar only.
  seedItem(palletId, {
    quantity: 87,
    totalLengthMm: 4400,
    totalWeight: 523.10,
    segments: [{ length_mm: 4400, angle_deg: null }],
  });
  seedItem(palletId, {
    quantity: 131,
    totalLengthMm: 4905,
    totalWeight: 950.00,
    segments: [{ length_mm: 1000, angle_deg: 90 }, { length_mm: 3905, angle_deg: null }],
  });
  seedItem(palletId, {
    quantity: 1,
    totalLengthMm: 4875,
    totalWeight: 8.33,
    segments: [
      { length_mm: 1000, angle_deg: 90 },
      { length_mm: 1500, angle_deg: 90 },
      { length_mm: 1000, angle_deg: 135 },
      { length_mm: 1375, angle_deg: null },
    ],
  });
  // A full 6 m straight bar remains visible but is not billed as cutting.
  seedItem(palletId, {
    quantity: 2,
    totalLengthMm: 6000,
    totalWeight: 10.00,
    segments: [{ length_mm: 6000, angle_deg: null }],
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => closeServer(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'a4-office', pin: '1234' }),
  });
  assert.equal(login.status, 200);
  const { access_token: accessToken } = await login.json();
  const response = await request(`/api/orders/${orderId}/print-a4`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 200);
  const html = await response.text();

  // Cutting includes every bent bar plus non-stock straight bars.
  assert.match(html, /<span>סה"כ לחיתוך<\/span><b>219 יח<\/b>/);
  assert.match(html, /<span>אורך לחיתוך<\/span><b>1,030\.23 מ<\/b>/);
  assert.match(html, /<span>משקל לחיתוך<\/span><b>1,481\.43 קג<\/b>/);
  assert.match(html, /חיתוך — כולל מוטות לכיפוף<\/td><td>1,481\.43 קג \| 219 יח \| 1,030\.23 מ<\/td>/);

  // Bending is an overlapping subset and is counted once per bar, not per angle.
  assert.match(html, /<span>מתוכם לכיפוף<\/span><b>132 יח<br>958\.33 קג<\/b>/);
  assert.match(html, /כיפוף — מתוך החיתוך<\/td><td>958\.33 קג \| 132 יח \| 647\.43 מ<\/td>/);
  assert.match(html, /מוטות ישרים לחיתוך — ללא כיפוף<\/td><td>523\.10 קג \| 87 יח \| 382\.80 מ<\/td>/);

  // Commercial full-length straight stock is explicitly not a cutting operation.
  assert.match(html, /מוטות ישרים 6\/12 מ׳ — ללא חיתוך<\/td><td>10\.00 קג \| 2 יח \| 12\.00 מ<\/td>/);
  assert.doesNotMatch(html, /<span>סה"כ לחיתוך<\/span><b>221 יח<\/b>/);
});
