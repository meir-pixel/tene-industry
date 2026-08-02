'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { requireAnyRole } = require('../permissions');
const recommendations = require('../services/procurementRecommendationV2');
const createRouter = require('../routes/purchaseOrdersV2');
function db() { const value = new Database(':memory:'); value.pragma('foreign_keys=ON'); ensureCoreSchema(value); value.prepare("INSERT INTO suppliers (id,name,active) VALUES (1,'API Steel',1)").run(); value.prepare("INSERT INTO orders (id,order_num,inventory_lifecycle_version) VALUES (1,'API-PO',2)").run(); value.prepare('INSERT INTO items (id,order_id,diameter,total_weight) VALUES (1,1,12,10)').run(); value.prepare("INSERT INTO material_requirements_v2 (id,requirement_uid,order_id,item_id,lifecycle_version,diameter,material_type,required_kg,need_by_source,status,source,source_revision) VALUES (1,'API-REQ',1,1,2,12,'coil',10,'unknown','open','manual','r1')").run(); const recommendation = recommendations.createDraft(value,{idempotency_key:'api-rec',specification:{diameter:12,material_type:'coil'},recommended_kg:10,links:[{material_requirement_id:1,recommended_kg:10}]}); recommendations.approveRecommendation(value,{recommendation_id:recommendation.id,idempotency_key:'api-rec-approve',decided_by:1}); return { value, recommendationId: recommendation.id }; }
function request(port, method, path, role, body) { return new Promise((resolve, reject) => { const data = body ? JSON.stringify(body) : ''; const headers = { 'content-type':'application/json', 'content-length':Buffer.byteLength(data) }; if (role) headers['x-role']=role; const req = http.request({port,method,path,headers},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:raw?JSON.parse(raw):null}));});req.on('error',reject);req.end(data); }); }
function payload(key, recommendationId) { return { idempotency_key:key, lines:[{source_recommendation_id:recommendationId,specification:{diameter:12,material_type:'coil'},ordered_kg:1,unit_price_per_kg:2}] }; }
test('B5B2 HTTP roles enforce draft, finance update, approval and issue authority', async () => {
  const { value, recommendationId } = db(); const app=express(); app.use(express.json()); app.use((req,_res,next)=>{req.auth=req.headers['x-role']?{role:req.headers['x-role'],sub:8}:null;next();}); app.use('/api',createRouter({db:value,requireAnyRole})); const server=await new Promise(resolve=>{const item=app.listen(0,()=>resolve(item));}); const port=server.address().port;
  try {
    assert.equal((await request(port,'GET','/api/procurement/purchase-orders-v2',null)).status,401);
    assert.equal((await request(port,'GET','/api/procurement/purchase-orders-v2','warehouse')).status,200);
    assert.equal((await request(port,'POST','/api/procurement/purchase-orders-v2','warehouse',payload('blocked',recommendationId))).status,403);
    const created=await request(port,'POST','/api/procurement/purchase-orders-v2','office',payload('office',recommendationId)); assert.equal(created.status,201); assert.equal(created.body.supplier_id,null);
    const updated=await request(port,'PATCH',`/api/procurement/purchase-orders-v2/${created.body.id}`,'finance',{...payload('finance-update',recommendationId),expected_revision:1,supplier_id:1,currency_code:'eur'}); assert.equal(updated.status,200); assert.equal(updated.body.currency_code,'EUR');
    assert.equal((await request(port,'POST',`/api/procurement/purchase-orders-v2/${created.body.id}/approve`,'office',{idempotency_key:'office-approve',expected_revision:2})).status,403);
    const approved=await request(port,'POST',`/api/procurement/purchase-orders-v2/${created.body.id}/approve`,'manager',{idempotency_key:'approve',expected_revision:2}); assert.equal(approved.status,200); assert.equal(approved.body.status,'approved');
    assert.equal((await request(port,'POST',`/api/procurement/purchase-orders-v2/${created.body.id}/issue`,'finance',{idempotency_key:'finance-issue',expected_revision:3})).status,403);
    const issued=await request(port,'POST',`/api/procurement/purchase-orders-v2/${created.body.id}/issue`,'admin',{idempotency_key:'issue',expected_revision:3}); assert.equal(issued.status,200); assert.equal(issued.body.status,'issued');
  } finally { await new Promise(resolve=>server.close(resolve)); value.close(); }
});
