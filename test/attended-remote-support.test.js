'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { requireAnyRole, requireRole } = require('../permissions');
const createRouter = require('../routes/attendedRemoteSupport');
const { createAttendedRemoteSupportService } = require('../services/attendedRemoteSupport');

async function makeApp({ now = new Date('2026-08-19T08:00:00.000Z') } = {}) {
  const db = new Database(':memory:');
  ensureCoreSchema(db);
  let clock = new Date(now);
  const support = createAttendedRemoteSupportService({ db, clock: () => new Date(clock), ttlSeconds: 600 });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, _res, next) => {
    const role = req.headers['x-test-role'];
    req.auth = role ? {
      role: String(role),
      sub: String(req.headers['x-test-user'] || 'worker-a'),
      username: String(req.headers['x-test-user'] || 'worker-a'),
    } : null;
    next();
  });
  app.use('/api', createRouter({ support, requireAnyRole, requireRole }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, () => resolve(value));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}, identity = {}) => {
    const headers = new Headers(options.headers || {});
    if (identity.role) headers.set('x-test-role', identity.role);
    if (identity.user) headers.set('x-test-user', identity.user);
    const response = await fetch(baseUrl + path, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    return { response, body };
  };
  return {
    db, support, request,
    setClock(value) { clock = new Date(value); },
    async close() { await new Promise(resolve => server.close(resolve)); db.close(); },
  };
}

function identity(role, user) { return { role, user }; }

test('native support bundle is a Windows executable and contains no unattended-service or shell pathway', () => {
  const root = path.join(__dirname, '..');
  const agentSource = fs.readFileSync(path.join(root, 'support-agent', 'IronBendSupportAgent.cs'), 'utf8');
  const agentBinary = fs.readFileSync(path.join(root, 'public', 'downloads', 'IronBend-Support.exe'));
  assert.equal(agentBinary.subarray(0, 2).toString('ascii'), 'MZ');
  assert.match(agentSource, /remote-support\/agent\/activate/);
  assert.match(agentSource, /MessageBoxButtons\.YesNo/);
  assert.match(agentSource, /factory_agent_closed/);
  assert.doesNotMatch(agentSource, /Registry|ServiceProcessInstaller|schtasks|powershell|cmd\.exe|Process\.Start/i);
});

test('native attended support creates only a short-lived secret-hashed session and prevents cross-owner access', async () => {
  const app = await makeApp();
  try {
    const noAuth = await app.request('/api/remote-support/sessions', { method: 'POST', body: '{}' });
    assert.equal(noAuth.response.status, 401);

    const finance = await app.request('/api/remote-support/sessions', { method: 'POST', body: '{}' }, identity('finance', 'fin'));
    assert.equal(finance.response.status, 403);

    const created = await app.request('/api/remote-support/sessions', { method: 'POST', body: '{}' }, identity('production', 'worker-a'));
    assert.equal(created.response.status, 201);
    assert.match(created.body.support_code, /^\d{4}-\d{4}$/);
    assert.equal(created.body.session.status, 'requested');
    assert.equal(created.body.session.expires_at, '2026-08-19T08:10:00.000Z');
    assert.equal(Object.hasOwn(created.body, 'agent_token'), false);
    assert.equal(created.body.agent_download_path, '/downloads/IronBend-Support.exe');

    const sessionRow = app.db.prepare('SELECT * FROM remote_support_sessions').get();
    assert.equal(sessionRow.requested_by, 'worker-a');
    assert.notEqual(sessionRow.support_code_hash, created.body.support_code);
    assert.equal(sessionRow.agent_token_hash, null);

    const foreignRead = await app.request(`/api/remote-support/sessions/${created.body.session.id}`, {}, identity('production', 'worker-b'));
    assert.equal(foreignRead.response.status, 404);
    const invalidActivation = await app.request('/api/remote-support/agent/activate', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ support_code:'invalid' }) });
    assert.equal(invalidActivation.response.status, 400);
    const activation = await app.request('/api/remote-support/agent/activate', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ support_code:created.body.support_code }) });
    assert.equal(activation.response.status, 200);
    assert.match(activation.body.agent_token, /^[A-Za-z0-9_-]{20,}$/);
    assert.notEqual(app.db.prepare('SELECT agent_token_hash FROM remote_support_sessions WHERE id=?').get(created.body.session.id).agent_token_hash, activation.body.agent_token);
    const repeatedActivation = await app.request('/api/remote-support/agent/activate', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ support_code:created.body.support_code }) });
    assert.equal(repeatedActivation.response.status, 409);
  } finally { await app.close(); }
});

test('screen sharing and control require separate local consent; frames and commands are transient and constrained', async () => {
  const app = await makeApp();
  try {
    const requester = identity('production', 'worker-a');
    const admin = identity('admin', 'admin-a');
    const created = await app.request('/api/remote-support/sessions', { method: 'POST', body: '{}' }, requester);
    const id = created.body.session.id;
    const activation = await app.request('/api/remote-support/agent/activate', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ support_code:created.body.support_code }) });
    const agentToken = activation.body.agent_token;
    const agentHeaders = { 'x-ironbend-agent-token': agentToken, 'content-type': 'application/json' };

    const claim = await app.request('/api/remote-support/claim', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ support_code: created.body.support_code }) }, admin);
    assert.equal(claim.response.status, 200);
    const otherAdmin = await app.request('/api/remote-support/claim', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ support_code: created.body.support_code }) }, identity('admin', 'admin-b'));
    assert.equal(otherAdmin.response.status, 409);

    const ready = await app.request(`/api/remote-support/agent/${id}/ready`, { method:'POST', headers:agentHeaders, body:JSON.stringify({screen_width:1920,screen_height:1080}) });
    assert.equal(ready.body.session.status, 'agent_ready');
    const beforeConsent = await app.request(`/api/remote-support/agent/${id}/frame`, { method:'POST', headers:agentHeaders, body:JSON.stringify({data:'a'.repeat(64),mime:'image/jpeg',width:1,height:1}) });
    assert.equal(beforeConsent.response.status, 409);
    const share = await app.request(`/api/remote-support/agent/${id}/screen-consent`, { method:'POST', headers:agentHeaders, body:JSON.stringify({approved:true}) });
    assert.equal(share.response.status, 200);

    const frame = await app.request(`/api/remote-support/agent/${id}/frame`, { method:'POST', headers:agentHeaders, body:JSON.stringify({data:'a'.repeat(64),mime:'image/jpeg',width:1920,height:1080}) });
    assert.equal(frame.body.accepted, true);
    const consoleBefore = await app.request(`/api/remote-support/sessions/${id}/console`, {}, admin);
    assert.match(consoleBefore.body.frame.data, /^data:image\/jpeg;base64,/);
    const noControl = await app.request(`/api/remote-support/sessions/${id}/commands`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'pointer',action:'left_click',x:1,y:1}) }, admin);
    assert.equal(noControl.response.status, 409);

    const requested = await app.request(`/api/remote-support/sessions/${id}/request-control`, { method:'POST' }, admin);
    assert.equal(requested.body.session.status, 'control_requested');
    const agentState = await app.request(`/api/remote-support/agent/${id}/commands?after=0`, { headers:agentHeaders });
    assert.equal(agentState.body.control_consent_required, true);
    const declined = await app.request(`/api/remote-support/agent/${id}/control-consent`, { method:'POST', headers:agentHeaders, body:JSON.stringify({approved:false}) });
    assert.equal(declined.body.session.status, 'agent_ready');
    const reRequested = await app.request(`/api/remote-support/sessions/${id}/request-control`, { method:'POST' }, admin);
    assert.equal(reRequested.body.session.status, 'control_requested');
    const granted = await app.request(`/api/remote-support/agent/${id}/control-consent`, { method:'POST', headers:agentHeaders, body:JSON.stringify({approved:true}) });
    assert.equal(granted.body.session.status, 'control_granted');

    const bad = await app.request(`/api/remote-support/sessions/${id}/commands`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'shell',command:'whoami'}) }, admin);
    assert.equal(bad.response.status, 400);
    const good = await app.request(`/api/remote-support/sessions/${id}/commands`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'pointer',action:'left_click',x:120,y:44}) }, admin);
    assert.equal(good.body.accepted, true);
    const queued = await app.request(`/api/remote-support/agent/${id}/commands?after=0`, { headers:agentHeaders });
    assert.deepEqual(queued.body.commands.map(value => ({ type:value.type, action:value.action, x:value.x, y:value.y })), [{ type:'pointer',action:'left_click',x:120,y:44 }]);

    const columns = app.db.pragma('table_info(remote_support_sessions)').map(column => column.name);
    assert.equal(columns.some(column => /frame(_data)?|command(_json)?|screenshot/i.test(column)), false);
    const events = app.db.prepare('SELECT metadata_json FROM remote_support_events WHERE session_id=?').all(id);
    assert.equal(events.some(row => /a{32}/.test(row.metadata_json)), false);

    const ended = await app.request(`/api/remote-support/sessions/${id}/end`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({reason:'operator_ended'}) }, admin);
    assert.equal(ended.body.session.status, 'ended');
    const afterEnd = await app.request(`/api/remote-support/agent/${id}/commands?after=0`, { headers:agentHeaders });
    assert.equal(afterEnd.response.status, 409);
  } finally { await app.close(); }
});

test('expired sessions cannot be claimed or revived, and the code never becomes a durable access credential', async () => {
  const app = await makeApp();
  try {
    const created = await app.request('/api/remote-support/sessions', { method:'POST', body:'{}' }, identity('maintenance', 'worker-a'));
    app.setClock('2026-08-19T08:10:00.000Z');
    const claim = await app.request('/api/remote-support/claim', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({support_code:created.body.support_code}) }, identity('admin', 'admin-a'));
    assert.equal(claim.response.status, 409);
    assert.equal(claim.body.error, 'support_session_expired');
    const row = app.db.prepare('SELECT status,end_reason FROM remote_support_sessions WHERE id=?').get(created.body.session.id);
    assert.deepEqual(row, { status:'expired', end_reason:'session_expired' });
    assert.equal(app.db.prepare("SELECT COUNT(*) AS total FROM remote_support_events WHERE event_type='session_expired'").get().total, 1);
  } finally { await app.close(); }
});
