const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');

const createIntakeReviewRouter = require('../routes/intakeReview');
const createOrdersRouter = require('../routes/orders');
const intakeWorkflow = require('../services/intakeWorkflow');
const { findSourceIdentityDuplicate, sourceIdentityConflictPayload } = require('../services/importSourceIdentity');

function allow() {
  return (req, res, next) => next();
}

async function startApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  return { baseUrl, close: () => new Promise(resolve => server.close(resolve)) };
}

function createIdentityDb() {
  const db = new Database(':memory:');
  db.exec([
    'CREATE TABLE intake_log (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'source TEXT,',
    'source_system TEXT,',
    'external_id TEXT,',
    'raw_content TEXT,',
    'parsed_data TEXT,',
    'order_id INTEGER,',
    "status TEXT DEFAULT 'pending_review',",
    'created_at TEXT DEFAULT CURRENT_TIMESTAMP',
    ');',
    'CREATE TABLE order_imports (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'filename TEXT,',
    'source_system TEXT,',
    'external_id TEXT,',
    'preview_data TEXT,',
    "status TEXT DEFAULT 'preview',",
    'order_ids_json TEXT,',
    'created_at TEXT DEFAULT CURRENT_TIMESTAMP,',
    'approved_at TEXT',
    ');',
    'CREATE TABLE orders (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'order_num TEXT UNIQUE,',
    'status TEXT,',
    'general_notes TEXT',
    ');',
    'CREATE TABLE items (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT,',
    'order_id INTEGER,',
    'quantity INTEGER,',
    'review_notes TEXT',
    ');',
  ].join('\n'));
  return db;
}

test('intake parse-text detects duplicate source identity before creating another review row', async (t) => {
  const db = createIdentityDb();
  t.after(() => db.close());
  const router = createIntakeReviewRouter({
    db,
    requireAnyRole: allow,
    wsBroadcast: () => {},
    enrichIntakeRow: row => row,
    createOrderFromPayload: () => { throw new Error('should not create order during parse-text'); },
    intakeToOrderPayload: value => value,
    intakeWorkflow,
    intake: { parseOCRText: text => ({ items: [{ diameter: 10, length: 1000, quantity: 1 }], text }) },
  });
  const app = await startApp(router);
  t.after(app.close);

  const body = { source: 'phone', text: '10 1000 1', source_system: 'whatsapp', external_id: 'msg-1' };
  const first = await fetch(app.baseUrl + '/api/intake/parse-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const second = await fetch(app.baseUrl + '/api/intake/parse-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(second.status, 409);
  const duplicate = await second.json();
  assert.equal(duplicate.code, 'source_identity_conflict');
  assert.equal(duplicate.reviewRequired, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM intake_log').get().count, 1);
});

test('order import preview rejects duplicate source identity without creating another import', async (t) => {
  const db = createIdentityDb();
  t.after(() => db.close());
  const router = createOrdersRouter({
    db,
    requireAnyRole: allow,
    requireRole: allow,
    upload: multer({ storage: multer.memoryStorage() }),
    modbus: {},
    intake: {},
    listPage: () => ({ limit: 100, offset: 0 }),
    industry: { weightPerUnit: () => 0 },
    normalizeOrderStatus: value => value,
    isValidOrderTransition: () => true,
    allowedOrderTransitions: () => [],
    createOrderFromPayload: () => { throw new Error('duplicate preview must not create orders'); },
    createOrderTransaction: () => { throw new Error('not used'); },
    buildOrderImportPreview: intakeWorkflow.buildOrderImportPreview,
    wsBroadcast: () => {},
    auditLog: () => {},
  });
  const app = await startApp(router);
  t.after(app.close);

  async function preview() {
    const form = new FormData();
    form.set('source_system', 'spreadsheet');
    form.set('external_id', 'file-1');
    form.set('file', new Blob(['customer_name,diameter,length,qty\nA,10,1000,2\n'], { type: 'text/csv' }), 'orders.csv');
    return fetch(app.baseUrl + '/api/order-imports/preview', { method: 'POST', body: form });
  }

  assert.equal((await preview()).status, 200);
  const second = await preview();
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.equal(body.code, 'source_identity_conflict');
  assert.equal(body.reviewRequired, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_imports').get().count, 1);
});

test('re-import of an approved source identity returns conflict and does not mutate the approved order', async (t) => {
  const db = createIdentityDb();
  t.after(() => db.close());
  const orderId = db.prepare('INSERT INTO orders (order_num,status,general_notes) VALUES (?,?,?)')
    .run('ORD-APPROVED', 'approved', 'keep me').lastInsertRowid;
  db.prepare('INSERT INTO order_imports (filename,source_system,external_id,preview_data,status,order_ids_json,approved_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)')
    .run('orders.csv', 'spreadsheet', 'file-approved', '{}', 'approved', JSON.stringify([orderId]));
  const itemId = db.prepare('INSERT INTO items (order_id,quantity,review_notes) VALUES (?,?,?)')
    .run(orderId, 7, 'keep item').lastInsertRowid;

  const duplicate = findSourceIdentityDuplicate(db, 'order_imports', {
    source_system: 'spreadsheet',
    external_id: 'file-approved',
  });
  assert.ok(duplicate);
  const body = sourceIdentityConflictPayload('order_import', duplicate);
  assert.equal(body.code, 'source_identity_conflict');
  assert.equal(body.reviewRequired, true);
  assert.equal(body.conflict.status, 'approved');
  assert.deepEqual(body.conflict.orderIds, [orderId]);

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  assert.equal(order.order_num, 'ORD-APPROVED');
  assert.equal(order.status, 'approved');
  assert.equal(order.general_notes, 'keep me');
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(itemId);
  assert.equal(item.quantity, 7);
  assert.equal(item.review_notes, 'keep item');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_imports').get().count, 1);
});


test('legacy intake parsing without source identity still produces review data', () => {
  const parsed = intakeWorkflow.withStructuredReviewNotes(intakeWorkflow.parseManualIntakeText({
    text: '10 1000 1',
    source: 'phone',
    parseWhatsAppMessage: () => { throw new Error('not used'); },
    parseOCRText: text => ({
      customer_name: 'Legacy customer',
      delivery_date: '2026-06-03',
      delivery_address: 'Legacy site',
      items: [{ diameter: 10, length: 1000, quantity: 1, shape_name: 'straight' }],
      text,
    }),
  }), { sourceIdentity: null });

  assert.equal(parsed.source, 'phone');
  assert.equal(parsed.items.length, 1);
  assert.ok(parsed.review_notes.some(note => note.field === 'source_identity'));
});
