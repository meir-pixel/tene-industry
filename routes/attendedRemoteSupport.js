'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { actorFromAuth } = require('../services/attendedRemoteSupport');

const REQUESTER_ROLES = [
  'admin', 'manager', 'office', 'production', 'production_planner',
  'quality', 'maintenance', 'warehouse', 'kiosk',
];

function required(name, value) {
  if (!value) throw new Error(`routes/attendedRemoteSupport missing dependency: ${name}`);
  return value;
}

function asPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

module.exports = function createAttendedRemoteSupportRouter(deps) {
  const support = required('support', deps.support);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const requireRole = required('requireRole', deps.requireRole);
  const router = express.Router();
  // A support code must never become a practical online guessing target. Frame
  // and agent polling limits are deliberately separate, because normal screen
  // sharing sends one poll and one frame about every 850 ms.
  const claimLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const agentActivationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });
  const agentPollLimiter = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false });
  const agentFrameLimiter = rateLimit({ windowMs: 60 * 1000, limit: 80, standardHeaders: true, legacyHeaders: false });

  function actor(req) { return actorFromAuth(req.auth); }
  function error(res, error) {
    return res.status(error.status || 500).json({ error: error.code || 'remote_support_error' });
  }
  // This is a distinct authorization scheme for the downloaded, one-time
  // factory agent. Its secret is verified by the service on every operation.
  function agentTokenAuthorization(req, res, next) {
    if (!String(req.headers['x-ironbend-agent-token'] || '').trim()) {
      return res.status(401).json({ error: 'support_agent_unauthorized' });
    }
    return next();
  }
  // The native factory agent has no user JWT. Its only bootstrap credential is
  // the short-lived code currently shown by the authenticated requester.
  function agentActivationAuthorization(req, res, next) {
    if (!/^\d{4}-\d{4}$/.test(String(req.body?.support_code || '').trim())) {
      return res.status(400).json({ error: 'invalid_support_code' });
    }
    return next();
  }

  router.post('/remote-support/sessions', requireAnyRole(REQUESTER_ROLES), (req, res) => {
    try {
      const created = support.createSession(actor(req));
      res.status(201).json({
        session: created.session,
        support_code: created.code,
        agent_download_path: '/downloads/IronBend-Support.exe',
        instructions: 'Download and run IronBend Support, then type this temporary code into its own visible window.',
      });
    } catch (cause) { error(res, cause); }
  });

  router.get('/remote-support/sessions', requireAnyRole(REQUESTER_ROLES), (req, res) => {
    try { res.json({ sessions: support.listForActor(actor(req)) }); } catch (cause) { error(res, cause); }
  });

  router.get('/remote-support/sessions/:id', requireAnyRole(REQUESTER_ROLES), (req, res) => {
    try {
      const id = asPositiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_support_session_id' });
      res.json(support.readSession(id, actor(req)));
    } catch (cause) { error(res, cause); }
  });

  router.post('/remote-support/claim', claimLimiter, requireRole('admin'), (req, res) => {
    try {
      const code = String(req.body?.support_code || '').trim();
      if (!/^\d{4}-\d{4}$/.test(code)) return res.status(400).json({ error: 'invalid_support_code' });
      res.json({ session: support.claimByCode(code, actor(req)) });
    } catch (cause) { error(res, cause); }
  });

  router.post('/remote-support/sessions/:id/request-control', requireRole('admin'), (req, res) => {
    try {
      const id = asPositiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_support_session_id' });
      res.json({ session: support.requestControl(id, actor(req)) });
    } catch (cause) { error(res, cause); }
  });

  router.post('/remote-support/sessions/:id/commands', requireRole('admin'), (req, res) => {
    try {
      const id = asPositiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_support_session_id' });
      res.json(support.queueCommand(id, actor(req), req.body));
    } catch (cause) { error(res, cause); }
  });

  router.get('/remote-support/sessions/:id/console', requireRole('admin'), (req, res) => {
    try {
      const id = asPositiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_support_session_id' });
      res.setHeader('Cache-Control', 'no-store');
      res.json(support.operatorConsole(id, actor(req)));
    } catch (cause) { error(res, cause); }
  });

  router.post('/remote-support/sessions/:id/end', requireAnyRole(REQUESTER_ROLES), (req, res) => {
    try {
      const id = asPositiveInteger(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid_support_session_id' });
      res.json({ session: support.end(id, actor(req), req.body?.reason || 'ended_by_user') });
    } catch (cause) { error(res, cause); }
  });

  // The downloaded agent has no JWT and can use only its rotating, scoped token.
  function agentToken(req) { return String(req.headers['x-ironbend-agent-token'] || ''); }
  router.post('/remote-support/agent/activate', agentActivationLimiter, agentActivationAuthorization, (req, res) => {
    try {
      const activated = support.activateAgentByCode(String(req.body.support_code).trim());
      res.setHeader('Cache-Control', 'no-store');
      res.json({ session: activated.session, agent_token: activated.token });
    } catch (cause) { error(res, cause); }
  });
  router.post('/remote-support/agent/:id/ready', agentTokenAuthorization, (req, res) => {
    try { res.json({ session: support.markAgentReady(req.params.id, agentToken(req), req.body || {}) }); } catch (cause) { error(res, cause); }
  });
  router.post('/remote-support/agent/:id/screen-consent', agentTokenAuthorization, (req, res) => {
    try { res.json({ session: support.screenShareConsent(req.params.id, agentToken(req), req.body?.approved === true) }); } catch (cause) { error(res, cause); }
  });
  router.post('/remote-support/agent/:id/control-consent', agentTokenAuthorization, (req, res) => {
    try { res.json({ session: support.controlConsent(req.params.id, agentToken(req), req.body?.approved === true) }); } catch (cause) { error(res, cause); }
  });
  router.get('/remote-support/agent/:id/commands', agentPollLimiter, agentTokenAuthorization, (req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json(support.getAgentState(req.params.id, agentToken(req), req.query?.after)); } catch (cause) { error(res, cause); }
  });
  router.post('/remote-support/agent/:id/frame', agentFrameLimiter, agentTokenAuthorization, (req, res) => {
    try { res.json(support.saveFrame(req.params.id, agentToken(req), req.body || {})); } catch (cause) { error(res, cause); }
  });
  router.post('/remote-support/agent/:id/end', agentTokenAuthorization, (req, res) => {
    try { res.json({ session: support.endByAgent(req.params.id, agentToken(req), req.body?.reason || 'ended_by_factory') }); } catch (cause) { error(res, cause); }
  });

  return router;
};

module.exports.manifest = {
  id: 'attended-remote-support',
  label: 'תמיכה מרחוק מאושרת',
  screens: [
    { id: 'support', path: '/support.html', label: 'תמיכה מרחוק', icon: '🧑‍💻', group: 'בקרה' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'create', office: 'create', production: 'create', maintenance: 'create', kiosk: 'create' },
  },
  consumes: [{ table: 'remote_support_sessions' }, { table: 'remote_support_events' }],
  produces: [{ event: 'remote_support_session' }],
};
