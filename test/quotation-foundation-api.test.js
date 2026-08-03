'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { requireAnyRole } = require('../permissions');
const { createQuotationNumberAllocator } = require('../services/quotationNumbers');
const { createCustomerQuotationService } = require('../services/customerQuotationV1');
const createQuotationsRouter = require('../routes/quotations');

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  ensureCoreSchema(db);
  const quotationService = createCustomerQuotationService(db, {
    generateQuotationNumber: createQuotationNumberAllocator(db),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = req.headers['x-role'] ? { role: req.headers['x-role'], sub: 17 } : null;
    next();
  });
  app.use('/api', createQuotationsRouter({ quotationService, requireAnyRole }));
  return { db, app };
}

function request(port, method, path, role, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    if (role) headers['x-role'] = role;
    const req = http.request({ port, method, path, headers }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '');
        resolve({ status: res.statusCode, headers: res.headers, raw, body: contentType.includes('json') && raw ? JSON.parse(raw) : raw });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function payload(key) {
  return {
    idempotency_key: key,
    prospect: { name: 'HTTP Prospect' },
    lines: [{
      description: 'Commercial line',
      quantity: 2,
      unit: 'pcs',
      pricing_mode: 'manual',
      pricing_quantity: 2,
      pricing_unit: 'pcs',
      unit_price: 50,
    }],
  };
}

test('quotation HTTP routes enforce read, draft, issue and decision authority', async () => {
  const { db, app } = setup();
  const server = await new Promise(resolve => { const running = app.listen(0, () => resolve(running)); });
  const port = server.address().port;
  try {
    assert.equal((await request(port, 'GET', '/api/quotations', null)).status, 401);
    assert.equal((await request(port, 'GET', '/api/quotations', 'warehouse')).status, 403);
    assert.equal((await request(port, 'GET', '/api/quotations', 'finance')).status, 200);
    assert.equal((await request(port, 'POST', '/api/quotations', 'finance', payload('finance-no'))).status, 403);

    for (const role of ['sales', 'office', 'manager', 'admin']) {
      const response = await request(port, 'POST', '/api/quotations', role, payload(`create-${role}`));
      assert.equal(response.status, 201, role);
    }
    const created = await request(port, 'POST', '/api/quotations', 'sales', payload('main-create'));
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal((await request(port, 'POST', `/api/quotations/${id}/issue`, 'sales', { idempotency_key: 'sales-issue', expected_version: 1 })).status, 403);
    const issued = await request(port, 'POST', `/api/quotations/${id}/issue`, 'office', { idempotency_key: 'office-issue', expected_version: 1 });
    assert.equal(issued.status, 200);
    assert.equal(issued.body.lifecycle_status, 'issued');
    assert.equal((await request(port, 'POST', `/api/quotations/${id}/accept`, 'office', { idempotency_key: 'office-accept' })).status, 403);
    assert.equal((await request(port, 'POST', `/api/quotations/${id}/accept`, 'manager', { idempotency_key: 'manager-accept' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('quotation PDF endpoint exposes issued revision only and does not create an order', async () => {
  const { db, app } = setup();
  const server = await new Promise(resolve => { const running = app.listen(0, () => resolve(running)); });
  const port = server.address().port;
  try {
    const created = await request(port, 'POST', '/api/quotations', 'office', payload('pdf-create'));
    const id = created.body.id;
    const draftPdf = await request(port, 'GET', `/api/quotations/${id}/pdf`, 'finance');
    assert.equal(draftPdf.status, 409);
    const issued = await request(port, 'POST', `/api/quotations/${id}/issue`, 'manager', { idempotency_key: 'pdf-issue', expected_version: 1 });
    const pdf = await request(port, 'GET', `/api/quotations/${id}/pdf?revision=1`, 'finance');
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.headers['content-type']), /^text\/html/);
    assert.match(pdf.raw, /data-document-kind="customer-quotation"/);
    assert.match(pdf.raw, new RegExp(issued.body.quotation_num));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM items').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM pallets').get().count, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
