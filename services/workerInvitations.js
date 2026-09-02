'use strict';

const crypto = require('crypto');
const { sha256 } = require('../auth-core');

const INVITATION_TTL_MS = 15 * 60 * 1000;

function ensureWorkerInvitationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_uid TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      worker_name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'production',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','opened','claimed','expired','cancelled')),
      expires_at DATETIME NOT NULL,
      created_by INTEGER,
      created_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      opened_at DATETIME,
      claimed_at DATETIME,
      claimed_user_id INTEGER,
      claimed_device_id INTEGER,
      cancelled_at DATETIME,
      cancelled_by INTEGER,
      cancelled_by_name TEXT,
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(claimed_user_id) REFERENCES users(id),
      FOREIGN KEY(claimed_device_id) REFERENCES device_enrollment_requests(id),
      FOREIGN KEY(cancelled_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_worker_invitations_status_expires
      ON worker_invitations(status, expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_worker_invitations_claimed_user
      ON worker_invitations(claimed_user_id);
  `);
  try { db.exec("ALTER TABLE worker_invitations ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
}

function createInvitationUid() {
  return `WINV-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function createInvitationToken() {
  return `${createInvitationUid()}.${crypto.randomBytes(32).toString('base64url')}`;
}

function asDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function createWorkerInvitationService({ getDb, now = () => new Date() }) {
  if (typeof getDb !== 'function') throw new Error('worker invitations require getDb');

  function effectiveStatus(row) {
    if (!row) return 'invalid';
    if (['claimed', 'cancelled', 'expired'].includes(row.status)) return row.status;
    const expiresAt = asDate(row.expires_at);
    return !expiresAt || expiresAt.getTime() <= now().getTime() ? 'expired' : row.status;
  }

  function expireIfNeeded(row) {
    if (!row || effectiveStatus(row) !== 'expired' || row.status === 'expired') return row;
    getDb().prepare(`
      UPDATE worker_invitations
      SET status='expired'
      WHERE id=? AND status IN ('pending','opened')
    `).run(row.id);
    return getDb().prepare('SELECT * FROM worker_invitations WHERE id=?').get(row.id);
  }

  function findByToken(token) {
    const value = String(token || '').trim();
    if (value.length < 32) return null;
    const row = getDb().prepare('SELECT * FROM worker_invitations WHERE token_hash=?').get(sha256(value));
    return expireIfNeeded(row);
  }

  function publicInvite(row) {
    if (!row) return null;
    return {
      invitation_uid: row.invitation_uid,
      worker_name: row.worker_name,
      role: row.role,
      permissions: parsePermissions(row.permissions_json),
      status: effectiveStatus(row),
      expires_at: row.expires_at,
    };
  }

  function create({ workerName, phone, role, permissions = [], createdBy, createdByName }) {
    const db = getDb();
    const token = createInvitationToken();
    const expiresAt = new Date(now().getTime() + INVITATION_TTL_MS).toISOString();
    const result = db.prepare(`
      INSERT INTO worker_invitations
        (invitation_uid,token_hash,worker_name,phone,role,permissions_json,expires_at,created_by,created_by_name)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      createInvitationUid(),
      sha256(token),
      workerName,
      phone || null,
      role,
      JSON.stringify(permissions),
      expiresAt,
      createdBy || null,
      createdByName || null,
    );
    return {
      row: db.prepare('SELECT * FROM worker_invitations WHERE id=?').get(result.lastInsertRowid),
      token,
    };
  }

  function markOpened(token) {
    const row = findByToken(token);
    if (!row || !['pending', 'opened'].includes(effectiveStatus(row))) return row;
    if (row.status === 'pending') {
      getDb().prepare(`
        UPDATE worker_invitations
        SET status='opened',opened_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='pending'
      `).run(row.id);
      return getDb().prepare('SELECT * FROM worker_invitations WHERE id=?').get(row.id);
    }
    return row;
  }

  function expireOutstanding() {
    getDb().prepare(`
      UPDATE worker_invitations
      SET status='expired'
      WHERE status IN ('pending','opened') AND datetime(expires_at) <= CURRENT_TIMESTAMP
    `).run();
  }

  return {
    INVITATION_TTL_MS,
    create,
    effectiveStatus,
    expireOutstanding,
    findByToken,
    markOpened,
    publicInvite,
  };
}

function parsePermissions(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

module.exports = {
  INVITATION_TTL_MS,
  createWorkerInvitationService,
  ensureWorkerInvitationSchema,
};
