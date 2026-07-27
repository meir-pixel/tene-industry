'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { requireAnyRole } = require('../permissions');
const createRouter = require('../routes/materialAllocationPlanning');

function createDb() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); ensureCoreSchema(db);
  for (const id of [1, 2, 3]) {
    db.prepare('INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (?,?,2)').run(id, `API-${id}`);
    db.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (?,?,12,10)').run(id, id);
    db.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (?,?,?, ?,2,12,'coil',10,'unknown','open','manual','r1')").run(id, `api-${id}`, id, id);
    db.prepare('INSERT INTO raw_material (id,diameter,material_type,weight_received,verification_status,active) VALUES (?,12,\'coil\',10,\'approved\',1)').run(id);
  }
  return db;
}
function request(port, method, path, role, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ port, method, path, headers: { 'x-role': role, 'content-type': 'application/json', ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}) } }, res => {
      let raw = ''; res.on('data', chunk => { raw += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
test('allocation endpoints enforce planner writes and warehouse read-only access', async () => {
  const db = createDb(); const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.auth = { role: req.headers['x-role'], sub: 9 }; next(); });
  app.use('/api', createRouter({ db, requireAnyRole }));
  const server = await new Promise(resolve => { const value = app.listen(0, () => resolve(value)); });
  const port = server.address().port;
  try {
    const warehouseRead = await request(port, 'GET', '/api/material-allocation-plans/suggest?material_requirement_id=1', 'warehouse');
    assert.equal(warehouseRead.status, 200);
    const warehouseWrite = await request(port, 'POST', '/api/material-allocation-plans', 'warehouse', { material_requirement_id: 1, idempotency_key: 'warehouse', lines: [] });
    assert.equal(warehouseWrite.status, 403);
    for (const [role, requirementId, lotId] of [['production_planner', 1, 1], ['manager', 2, 2], ['admin', 3, 3]]) {
      const response = await request(port, 'POST', '/api/material-allocation-plans', role, { material_requirement_id: requirementId, idempotency_key: role, lines: [{ raw_material_id: lotId, allocated_kg: 10 }] });
      assert.equal(response.status, 201);
    }
    const warehouseRelease = await request(port, 'POST', '/api/material-allocation-plans/1/release', 'warehouse', { reason: 'no' });
    const warehouseReconcile = await request(port, 'POST', '/api/material-allocation-plans/reconcile', 'warehouse', { material_requirement_id: 1, idempotency_key: 'no' });
    assert.equal(warehouseRelease.status, 403); assert.equal(warehouseReconcile.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
