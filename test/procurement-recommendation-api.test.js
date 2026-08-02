'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { requireAnyRole } = require('../permissions');
const createRouter = require('../routes/procurementRecommendationsV2');
function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); value.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,'API-B5B1',2)").run(); value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,12,10)').run(); value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (1,'API-R',1,1,2,12,'coil',10,'unknown','open','manual','r1')").run(); return value; }
function request(port, method, path, role, body) { return new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : ''; const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }; if (role) headers['x-role'] = role; const req = http.request({ port, method, path, headers }, res => { let raw=''; res.on('data', chunk => raw += chunk); res.on('end', () => resolve({ status:res.statusCode, body:raw ? JSON.parse(raw) : null })); }); req.on('error', reject); req.end(data); }); }
const payload = key => ({ idempotency_key:key, specification:{diameter:12,material_type:'coil'}, recommended_kg:10, links:[{material_requirement_id:1,recommended_kg:10}] });
test('B5B1 HTTP roles enforce read, draft and decision authority', async () => {
  const value = db(); const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = req.headers['x-role'] ? { role:req.headers['x-role'], sub:7 } : null; next(); }); app.use('/api', createRouter({ db:value, requireAnyRole })); const server = await new Promise(resolve => { const result=app.listen(0,()=>resolve(result)); }); const port=server.address().port;
  try {
    assert.equal((await request(port,'GET','/api/procurement/recommendations-v2',null)).status,401);
    assert.equal((await request(port,'GET','/api/procurement/recommendations-v2','warehouse')).status,200);
    assert.equal((await request(port,'POST','/api/procurement/recommendations-v2','warehouse',payload('no'))).status,403);
    const created=await request(port,'POST','/api/procurement/recommendations-v2','office',payload('office')); assert.equal(created.status,201);
    assert.equal((await request(port,'POST',`/api/procurement/recommendations-v2/${created.body.id}/approve`,'office',{idempotency_key:'no'})).status,403);
    for (const role of ['manager','admin']) { const item=await request(port,'POST','/api/procurement/recommendations-v2','office',payload(`draft-${role}`)); assert.equal((await request(port,'POST',`/api/procurement/recommendations-v2/${item.body.id}/approve`,role,{idempotency_key:`approve-${role}`})).status,200); }
  } finally { await new Promise(resolve=>server.close(resolve)); value.close(); }
});
