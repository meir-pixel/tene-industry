'use strict';

// Attended Remote Support V1 deliberately keeps the sensitive runtime data in
// memory.  SQLite records the session lifecycle and append-only audit trail,
// never video frames, input events, the one-time code, or the agent token.
const crypto = require('crypto');

const ACTIVE_STATUSES = new Set([
  'requested',
  'agent_ready',
  'control_requested',
  'control_granted',
]);
const AGENT_STATUSES = new Set(['agent_ready', 'control_requested', 'control_granted']);
const SAFE_KEYS = new Map([
  ['Enter', '{ENTER}'], ['Tab', '{TAB}'], ['Escape', '{ESC}'], ['Backspace', '{BACKSPACE}'],
  ['ArrowUp', '{UP}'], ['ArrowDown', '{DOWN}'], ['ArrowLeft', '{LEFT}'], ['ArrowRight', '{RIGHT}'],
  ['Delete', '{DELETE}'], ['Home', '{HOME}'], ['End', '{END}'], ['PageUp', '{PGUP}'], ['PageDown', '{PGDN}'],
  ['Space', ' '],
]);

function nowIso(clock) {
  return clock().toISOString();
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomSupportCode() {
  // Eight numeric digits are easy to dictate, but have 100m possibilities.
  const digits = crypto.randomInt(0, 100000000).toString().padStart(8, '0');
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function stableJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function actorFromAuth(auth = {}) {
  return {
    id: String(auth.sub || ''),
    name: String(auth.display_name || auth.displayName || auth.username || auth.sub || 'unknown'),
    role: String(auth.role || ''),
  };
}

function serializeSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name,
    requested_by_role: row.requested_by_role,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    created_at: row.created_at,
    expires_at: row.expires_at,
    agent_ready_at: row.agent_ready_at,
    screen_share_consent_at: row.screen_share_consent_at,
    control_requested_at: row.control_requested_at,
    control_granted_at: row.control_granted_at,
    ended_at: row.ended_at,
    end_reason: row.end_reason,
  };
}

function safeMetadata(metadata) {
  const copy = { ...(metadata || {}) };
  delete copy.code;
  delete copy.token;
  delete copy.agent_token;
  delete copy.frame;
  return copy;
}

function createAttendedRemoteSupportService({ db, clock = () => new Date(), ttlSeconds = 10 * 60 } = {}) {
  if (!db) throw new Error('attended remote support requires db');
  const runtime = new Map();

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS remote_support_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        support_code_hash TEXT NOT NULL UNIQUE,
        agent_token_hash TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'requested','agent_ready','control_requested','control_granted','ended','expired','rejected'
        )),
        requested_by TEXT NOT NULL,
        requested_by_name TEXT NOT NULL,
        requested_by_role TEXT NOT NULL,
        operator_id TEXT,
        operator_name TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        agent_ready_at TEXT,
        screen_share_consent_at TEXT,
        control_requested_at TEXT,
        control_granted_at TEXT,
        ended_at TEXT,
        end_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_support_active ON remote_support_sessions(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_remote_support_requester ON remote_support_sessions(requested_by, created_at DESC);
      CREATE TABLE IF NOT EXISTS remote_support_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES remote_support_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_remote_support_events_session ON remote_support_events(session_id, id);
    `);
  }

  function event(sessionId, eventType, actor, metadata = {}) {
    const at = nowIso(clock);
    db.prepare(`
      INSERT INTO remote_support_events (session_id,event_type,actor_type,actor_id,actor_name,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      sessionId,
      eventType,
      actor?.type || 'system',
      actor?.id || null,
      actor?.name || null,
      stableJson(safeMetadata(metadata)),
      at,
    );
    // Keep the general audit stream useful without logging a secret or frame.
    try {
      db.prepare(`
        INSERT INTO audit_log (entity_type,entity_id,entity_ref,action,notes,user_id,user_name)
        VALUES (?,?,?,?,?,?,?)
      `).run('remote_support_session', sessionId, `SUP-${sessionId}`, eventType,
        stableJson(safeMetadata(metadata)), actor?.id || null, actor?.name || null);
    } catch (_) { /* audit_log can be unavailable in isolated unit schemas */ }
  }

  function expireStale() {
    const at = nowIso(clock);
    const stale = db.prepare(`
      SELECT id FROM remote_support_sessions
      WHERE status IN ('requested','agent_ready','control_requested','control_granted') AND expires_at <= ?
    `).all(at);
    if (!stale.length) return 0;
    const update = db.prepare(`
      UPDATE remote_support_sessions SET status='expired', ended_at=?, end_reason='session_expired'
      WHERE id=?
    `);
    db.transaction(() => {
      for (const row of stale) {
        update.run(at, row.id);
        runtime.delete(row.id);
        event(row.id, 'session_expired', { type: 'system', name: 'system' });
      }
    })();
    return stale.length;
  }

  function sessionById(id) {
    expireStale();
    return db.prepare('SELECT * FROM remote_support_sessions WHERE id=?').get(Number(id));
  }

  function assertActive(session) {
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    if (!ACTIVE_STATUSES.has(session.status)) {
      throw Object.assign(new Error(session.status === 'expired' ? 'support_session_expired' : 'support_session_closed'), {
        code: session.status === 'expired' ? 'support_session_expired' : 'support_session_closed', status: 409,
      });
    }
  }

  function assertOwnerOrAdmin(session, actor) {
    if (actor.role === 'admin' || session.requested_by === actor.id) return;
    throw Object.assign(new Error('support_session_forbidden'), { code: 'support_session_forbidden', status: 404 });
  }

  function assertOperatorOrAdmin(session, actor) {
    if (actor.role === 'admin' || session.operator_id === actor.id) return;
    throw Object.assign(new Error('support_session_forbidden'), { code: 'support_session_forbidden', status: 404 });
  }

  function verifyAgent(sessionId, token) {
    const session = sessionById(sessionId);
    assertActive(session);
    const actual = hashSecret(token || '');
    const expected = String(session.agent_token_hash || '');
    const ok = expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
    if (!ok) throw Object.assign(new Error('support_agent_unauthorized'), { code: 'support_agent_unauthorized', status: 401 });
    return session;
  }

  function createSession(actor) {
    expireStale();
    const at = clock();
    const createdAt = at.toISOString();
    const expiresAt = new Date(at.getTime() + ttlSeconds * 1000).toISOString();
    let code;
    let existing;
    do {
      code = randomSupportCode();
      existing = db.prepare('SELECT 1 FROM remote_support_sessions WHERE support_code_hash=?').get(hashSecret(code));
    } while (existing);
    const result = db.prepare(`
      INSERT INTO remote_support_sessions (
        support_code_hash,status,requested_by,requested_by_name,requested_by_role,created_at,expires_at
      ) VALUES (?,?,?,?,?,?,?)
    `).run(hashSecret(code), 'requested', actor.id, actor.name, actor.role, createdAt, expiresAt);
    const session = sessionById(result.lastInsertRowid);
    event(session.id, 'session_requested', { type: 'requester', ...actor }, { expires_at: expiresAt });
    return { session: serializeSession(session), code };
  }

  function activateAgentByCode(code) {
    expireStale();
    const session = db.prepare('SELECT * FROM remote_support_sessions WHERE support_code_hash=?').get(hashSecret(code));
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    assertActive(session);
    // The factory agent may be paired only once.  The code remains available
    // to the administrator for claiming the same session, but cannot spawn a
    // second competing agent or rotate the first agent's credential.
    if (session.status !== 'requested' || session.agent_token_hash) {
      throw Object.assign(new Error('support_agent_already_activated'), { code: 'support_agent_already_activated', status: 409 });
    }
    const token = randomSecret();
    db.prepare('UPDATE remote_support_sessions SET agent_token_hash=? WHERE id=?').run(hashSecret(token), session.id);
    event(session.id, 'agent_activated', { type: 'agent', name: 'factory_agent' });
    return { session: serializeSession(sessionById(session.id)), token };
  }

  function claimByCode(code, actor) {
    expireStale();
    const session = db.prepare('SELECT * FROM remote_support_sessions WHERE support_code_hash=?').get(hashSecret(code));
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    assertActive(session);
    if (session.operator_id && session.operator_id !== actor.id) {
      throw Object.assign(new Error('support_session_already_claimed'), { code: 'support_session_already_claimed', status: 409 });
    }
    if (!session.operator_id) {
      db.prepare('UPDATE remote_support_sessions SET operator_id=?,operator_name=? WHERE id=?')
        .run(actor.id, actor.name, session.id);
      event(session.id, 'operator_claimed', { type: 'operator', ...actor });
    }
    return serializeSession(sessionById(session.id));
  }

  function listForActor(actor) {
    expireStale();
    const rows = actor.role === 'admin'
      ? db.prepare('SELECT * FROM remote_support_sessions ORDER BY created_at DESC LIMIT 50').all()
      : db.prepare('SELECT * FROM remote_support_sessions WHERE requested_by=? ORDER BY created_at DESC LIMIT 50').all(actor.id);
    return rows.map(serializeSession);
  }

  function readSession(sessionId, actor) {
    const session = sessionById(sessionId);
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    if (actor.role !== 'admin' && session.requested_by !== actor.id && session.operator_id !== actor.id) {
      throw Object.assign(new Error('support_session_forbidden'), { code: 'support_session_forbidden', status: 404 });
    }
    const events = db.prepare(`
      SELECT id,event_type,actor_type,actor_id,actor_name,metadata_json,created_at
      FROM remote_support_events WHERE session_id=? ORDER BY id ASC LIMIT 100
    `).all(session.id).map(row => ({ ...row, metadata: JSON.parse(row.metadata_json || '{}'), metadata_json: undefined }));
    return { session: serializeSession(session), events };
  }

  function markAgentReady(sessionId, token, device = {}) {
    const session = verifyAgent(sessionId, token);
    if (session.status === 'requested') {
      const at = nowIso(clock);
      db.prepare('UPDATE remote_support_sessions SET status=?, agent_ready_at=? WHERE id=?').run('agent_ready', at, session.id);
      event(session.id, 'agent_ready', { type: 'agent', name: 'factory_agent' }, {
        screen_width: Number(device.screen_width) || null,
        screen_height: Number(device.screen_height) || null,
      });
    }
    return serializeSession(sessionById(session.id));
  }

  function screenShareConsent(sessionId, token, approved) {
    const session = verifyAgent(sessionId, token);
    if (approved !== true) {
      return endByAgent(session.id, token, 'screen_share_declined');
    }
    const at = nowIso(clock);
    if (!session.screen_share_consent_at) {
      db.prepare('UPDATE remote_support_sessions SET screen_share_consent_at=? WHERE id=?').run(at, session.id);
      event(session.id, 'screen_share_approved', { type: 'agent', name: 'factory_agent' });
    }
    return serializeSession(sessionById(session.id));
  }

  function requestControl(sessionId, actor) {
    const session = sessionById(sessionId);
    assertActive(session);
    assertOperatorOrAdmin(session, actor);
    if (session.status !== 'agent_ready') {
      if (session.status === 'control_requested' || session.status === 'control_granted') return serializeSession(session);
      throw Object.assign(new Error('support_agent_not_ready'), { code: 'support_agent_not_ready', status: 409 });
    }
    const at = nowIso(clock);
    db.prepare('UPDATE remote_support_sessions SET status=?,control_requested_at=? WHERE id=?')
      .run('control_requested', at, session.id);
    event(session.id, 'control_requested', { type: 'operator', ...actor });
    return serializeSession(sessionById(session.id));
  }

  function controlConsent(sessionId, token, approved) {
    const session = verifyAgent(sessionId, token);
    if (session.status !== 'control_requested') return serializeSession(session);
    if (!approved) {
      const at = nowIso(clock);
      db.prepare('UPDATE remote_support_sessions SET status=?, control_requested_at=NULL WHERE id=?').run('agent_ready', session.id);
      event(session.id, 'control_declined', { type: 'agent', name: 'factory_agent' }, { at });
      return serializeSession(sessionById(session.id));
    }
    const at = nowIso(clock);
    db.prepare('UPDATE remote_support_sessions SET status=?,control_granted_at=? WHERE id=?')
      .run('control_granted', at, session.id);
    event(session.id, 'control_granted', { type: 'agent', name: 'factory_agent' });
    return serializeSession(sessionById(session.id));
  }

  function runtimeFor(sessionId) {
    if (!runtime.has(sessionId)) runtime.set(sessionId, { latestFrame: null, commands: [], commandId: 0 });
    return runtime.get(sessionId);
  }

  function saveFrame(sessionId, token, frame = {}) {
    const session = verifyAgent(sessionId, token);
    if (!AGENT_STATUSES.has(session.status) || !session.screen_share_consent_at) {
      throw Object.assign(new Error('support_screen_share_not_approved'), { code: 'support_screen_share_not_approved', status: 409 });
    }
    const data = String(frame.data || '');
    const mime = String(frame.mime || 'image/jpeg');
    if (!/^image\/(jpeg|png)$/.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length < 32 || data.length > 3_500_000) {
      throw Object.assign(new Error('invalid_support_frame'), { code: 'invalid_support_frame', status: 400 });
    }
    runtimeFor(session.id).latestFrame = {
      data: `data:${mime};base64,${data}`,
      width: Math.max(1, Math.min(10000, Number(frame.width) || 0)),
      height: Math.max(1, Math.min(10000, Number(frame.height) || 0)),
      received_at: nowIso(clock),
    };
    return { accepted: true };
  }

  function normalizeCommand(command = {}) {
    const type = String(command.type || '');
    if (type === 'pointer') {
      const x = Number(command.x); const y = Number(command.y);
      const action = String(command.action || 'move');
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || !['move', 'left_click', 'right_click'].includes(action)) return null;
      return { type, action, x: Math.round(x), y: Math.round(y) };
    }
    if (type === 'key') {
      const key = String(command.key || '');
      const printable = key.length === 1 && /^[A-Za-z0-9 .,_\-]$/.test(key);
      if (!printable && !SAFE_KEYS.has(key)) return null;
      return { type, sendKeys: printable ? key : SAFE_KEYS.get(key) };
    }
    return null;
  }

  function queueCommand(sessionId, actor, command) {
    const session = sessionById(sessionId);
    assertActive(session);
    assertOperatorOrAdmin(session, actor);
    if (session.status !== 'control_granted') {
      throw Object.assign(new Error('support_control_not_granted'), { code: 'support_control_not_granted', status: 409 });
    }
    const normalized = normalizeCommand(command);
    if (!normalized) throw Object.assign(new Error('invalid_support_command'), { code: 'invalid_support_command', status: 400 });
    const data = runtimeFor(session.id);
    const queued = { id: ++data.commandId, ...normalized };
    data.commands.push(queued);
    if (data.commands.length > 100) data.commands.splice(0, data.commands.length - 100);
    return { accepted: true, command_id: queued.id };
  }

  function getAgentState(sessionId, token, after = 0) {
    const session = verifyAgent(sessionId, token);
    const data = runtimeFor(session.id);
    const requested = session.status === 'control_requested';
    const commands = session.status === 'control_granted'
      ? data.commands.filter(command => command.id > Number(after || 0))
      : [];
    return {
      status: session.status,
      session_ended: !ACTIVE_STATUSES.has(session.status),
      control_consent_required: requested,
      commands,
    };
  }

  function operatorConsole(sessionId, actor) {
    const session = sessionById(sessionId);
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    assertOperatorOrAdmin(session, actor);
    const data = runtime.get(session.id);
    return { session: serializeSession(session), frame: data?.latestFrame || null };
  }

  function end(sessionId, actor, reason = 'ended_by_user') {
    const session = sessionById(sessionId);
    if (!session) throw Object.assign(new Error('support_session_not_found'), { code: 'support_session_not_found', status: 404 });
    if (actor.role !== 'admin' && session.requested_by !== actor.id && session.operator_id !== actor.id) {
      throw Object.assign(new Error('support_session_forbidden'), { code: 'support_session_forbidden', status: 404 });
    }
    if (ACTIVE_STATUSES.has(session.status)) {
      const at = nowIso(clock);
      db.prepare('UPDATE remote_support_sessions SET status=?,ended_at=?,end_reason=? WHERE id=?')
        .run('ended', at, String(reason).slice(0, 100), session.id);
      runtime.delete(session.id);
      event(session.id, 'session_ended', { type: 'user', ...actor }, { reason: String(reason).slice(0, 100) });
    }
    return serializeSession(sessionById(session.id));
  }

  function endByAgent(sessionId, token, reason = 'ended_by_factory') {
    const session = verifyAgent(sessionId, token);
    if (ACTIVE_STATUSES.has(session.status)) {
      const at = nowIso(clock);
      db.prepare('UPDATE remote_support_sessions SET status=?,ended_at=?,end_reason=? WHERE id=?')
        .run('ended', at, String(reason).slice(0, 100), session.id);
      runtime.delete(session.id);
      event(session.id, 'session_ended', { type: 'agent', name: 'factory_agent' }, { reason: String(reason).slice(0, 100) });
    }
    return serializeSession(sessionById(session.id));
  }

  ensureSchema();
  return {
    createSession, activateAgentByCode, claimByCode, listForActor, readSession,
    markAgentReady, screenShareConsent, requestControl, controlConsent,
    saveFrame, queueCommand, getAgentState, operatorConsole, end, endByAgent,
    expireStale, serializeSession,
  };
}

module.exports = { createAttendedRemoteSupportService, actorFromAuth };
