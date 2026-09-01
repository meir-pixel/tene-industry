'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tene-commercial-summary-http-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'commercial-summary-test-secret';
process.env.BCRYPT_ROUNDS = '4';
process.env.DB_PATH = path.join(tmpDir, 'commercial-summary.db');
process.env.BACKUP_DIR = path.join(tmpDir, 'backups');

const { closeServer, db, server } = require('../server');
const { hashPin } = require('../auth-core');

let baseUrl;

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

test('order API, A4 and delivery certificate share the computed commercial summary', async (t) => {
  const pinHash = hashPin('1234', 4);
  db.prepare(`INSERT INTO users (username,display_name,role,pin,pin_hash,active,password_changed_at) VALUES ('summary-office','Summary Office','office','1234',?,1,?)`)
    .run(pinHash, new Date().toISOString());
  const customerId = db.prepare("INSERT INTO customers (name,phone) VALUES ('Summary customer','0500000000')").run().lastInsertRowid;
  const orderId = db.prepare("INSERT INTO orders (order_num,customer_id,channel,status,total_weight) VALUES ('SUMMARY-HTTP-1',?,'משרד','ממתין',10)").run(customerId).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num,total_weight) VALUES (?,1,10)').run(orderId).lastInsertRowid;
  db.prepare(`INSERT INTO items (pallet_id,order_id,shape_name,diameter,segments,total_length_mm,quantity,total_weight,note,status) VALUES (?,?,'מוט מכופף',12,?,5000,4,10,'נוסף ידנית, בעורך הצורות','ממתין')`)
    .run(palletId, orderId, JSON.stringify([{ length_mm: 1000, angle_deg: 90 }, { length_mm: 4000, angle_deg: null }]));

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
    body: JSON.stringify({ username: 'summary-office', pin: '1234' }),
  });
  assert.equal(login.status, 200);
  const { access_token: accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const orderResponse = await request(`/api/orders/${orderId}`, { headers });
  assert.equal(orderResponse.status, 200);
  const order = await orderResponse.json();
  assert.equal(order.commercial_summary.version, 'ORDER_COMMERCIAL_SUMMARY_V1');
  assert.equal(order.commercial_summary.calculation, 'computed_on_read');
  assert.equal(order.commercial_summary.lines.find(line => line.key === 'cutting_kg').value, 10);
  assert.equal(order.commercial_summary.lines.find(line => line.key === 'bending_kg').value, 10);
  const materialLine = order.commercial_summary.lines.find(line => line.key === 'processed_rebar_kg');
  assert.equal(materialLine.label, 'ברזל בניין מעובד');
  assert.equal(materialLine.value, 10);
  assert.equal(materialLine.contributors[0].material_source, 'straight');
  assert.equal(materialLine.contributors[0].material_source_basis, 'default_processed_rebar');
  assert.equal(Object.hasOwn(order.commercial_summary.lines.find(line => line.key === 'cutting_kg'), 'units'), false);

  const a4Response = await request(`/api/orders/${orderId}/print-a4`, { headers });
  assert.equal(a4Response.status, 200);
  const a4 = await a4Response.text();
  assert.match(a4, /data-commercial-summary-line="cutting_kg"/);
  assert.match(a4, /<td>ברזל בניין מעובד<\/td><td>10\.00 קג<\/td>/);
  assert.match(a4, /<td>חיתוך<\/td><td>10\.00 קג<\/td>/);
  assert.doesNotMatch(a4, /חיתוך<\/td><td>[^<]*יח/);
  assert.doesNotMatch(a4, /נוסף ידנית/);

  const thaiA4Response = await request(`/api/orders/${orderId}/print-a4?lang=th`, { headers });
  assert.equal(thaiA4Response.status, 200);
  const thaiA4 = await thaiA4Response.text();
  assert.match(thaiA4, /<html lang="th" dir="ltr">/);
  assert.match(thaiA4, /ใบสั่งผลิต – ดัดเหล็กเสริม/);
  assert.match(thaiA4, /<td>เหล็กเส้นแปรรูป<\/td><td>10\.00 กก\.<\/td>/);
  assert.match(thaiA4, /<td>ตัด<\/td><td>10\.00 กก\.<\/td>/);
  assert.match(thaiA4, /Noto Sans Thai/);
  assert.doesNotMatch(thaiA4, /טופס ייצור – כיפוף ברזל/);

  const deliveryResponse = await request(`/api/orders/${orderId}/delivery-certificate?waste3=0`, { headers });
  const delivery = await deliveryResponse.text();
  assert.equal(deliveryResponse.status, 200, delivery);
  assert.match(delivery, /data-commercial-summary-line="cutting_kg"/);
  assert.match(delivery, /ברזל בניין מעובד:<\/span><span class="sum-val">10\.00/);
  assert.match(delivery, /חיתוך:<\/span><span class="sum-val">10\.00/);
  assert.doesNotMatch(delivery, /חיתוך:<\/span><span class="sum-val">[^<]*יח/);
});

test('order summary drilldown opens only on double-click and contributor navigation also requires double-click', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'orders.html'), 'utf8');
  assert.match(html, /ondblclick="openCommercialBreakdown\(event,/);
  assert.match(html, /ondblclick="focusCommercialContributor\(event,/);
  assert.doesNotMatch(html, /onclick="openCommercialBreakdown\(event,/);
  assert.doesNotMatch(html, /onclick="focusCommercialContributor\(event,/);
  assert.match(html, /לחיצה כפולה על שורה מציגה את הכרטיסים/);
  assert.match(html, /מקור משוער לפי קוטר, צורה ואורך/);
  assert.match(html, /מקור שנבחר במפורש/);
});
