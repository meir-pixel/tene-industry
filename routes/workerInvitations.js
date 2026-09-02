'use strict';

const router = require('express').Router();
const { requestPublicBaseUrl } = require('../services/publicScanLinks');

const INVITABLE_ROLES = new Set(['production', 'warehouse', 'driver', 'quality', 'maintenance']);

function required(name, value) {
  if (!value) throw new Error(`routes/workerInvitations missing dependency: ${name}`);
  return value;
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function cleanUsername(value) {
  return String(value || '').trim().replace(/\s+/g, '').slice(0, 80);
}

function cleanPhone(value) {
  return String(value || '').trim().replace(/[^+\d -]/g, '').slice(0, 30);
}

function activationUrl(req, token, settingsService) {
  const base = requestPublicBaseUrl(req, settingsService);
  if (!base) return '';
  return `${base}/worker-invite.html?token=${encodeURIComponent(token)}`;
}

function publicActivationError(row, workerInvitations) {
  const status = workerInvitations.effectiveStatus(row);
  if (status === 'expired') return { status: 410, error: 'invitation_expired' };
  if (status === 'cancelled') return { status: 410, error: 'invitation_cancelled' };
  if (status === 'claimed') return { status: 409, error: 'invitation_already_used' };
  return { status: 404, error: 'invitation_not_found' };
}

module.exports = function createWorkerInvitationsRouter(deps) {
  const getDb = required('getDb', deps.getDb);
  const requireRole = required('requireRole', deps.requireRole);
  const hashPin = required('hashPin', deps.hashPin);
  const deviceEnrollment = required('deviceEnrollment', deps.deviceEnrollment);
  const workerInvitations = required('workerInvitations', deps.workerInvitations);
  const activationLimiter = required('activationLimiter', deps.activationLimiter);
  const auditLog = required('auditLog', deps.auditLog);
  const settingsService = deps.settingsService || null;

  router.post('/worker-invitations', requireRole('admin'), (req, res) => {
    const workerName = cleanText(req.body?.worker_name, 100);
    const phone = cleanPhone(req.body?.phone);
    const role = cleanText(req.body?.role, 40) || 'production';
    if (workerName.length < 2 || !INVITABLE_ROLES.has(role)) {
      return res.status(400).json({ error: 'invalid_worker_invitation' });
    }

    const created = workerInvitations.create({
      workerName,
      phone,
      role,
      createdBy: Number(req.auth?.sub) || null,
      createdByName: cleanText(req.auth?.display_name, 100) || null,
    });
    const url = activationUrl(req, created.token, settingsService);
    auditLog(
      'worker_invitation', created.row.id, created.row.invitation_uid, 'create', 'status', null, 'pending',
      `${workerName} · ${role}`, Number(req.auth?.sub) || null, cleanText(req.auth?.display_name, 100) || null,
    );
    res.status(201).json({
      invitation: {
        id: created.row.id,
        invitation_uid: created.row.invitation_uid,
        worker_name: created.row.worker_name,
        phone: created.row.phone,
        role: created.row.role,
        status: created.row.status,
        expires_at: created.row.expires_at,
      },
      activation_url: url,
      whatsapp_message: url
        ? `שלום ${workerName}, זהו קישור אישי להפעלת אפליקציית העובדים של טנא. הקישור תקף ל־15 דקות: ${url}`
        : '',
    });
  });

  router.get('/worker-invitations', requireRole('admin'), (_req, res) => {
    workerInvitations.expireOutstanding();
    const rows = getDb().prepare(`
      SELECT wi.id,wi.invitation_uid,wi.worker_name,wi.phone,wi.role,wi.status,wi.expires_at,
             wi.created_at,wi.opened_at,wi.claimed_at,wi.cancelled_at,wi.created_by_name,
             u.username AS claimed_username,u.display_name AS claimed_user_name,u.active AS claimed_user_active,
             d.id AS device_id,d.device_name,d.platform,d.status AS device_status
      FROM worker_invitations wi
      LEFT JOIN users u ON u.id=wi.claimed_user_id
      LEFT JOIN device_enrollment_requests d ON d.id=wi.claimed_device_id
      ORDER BY CASE wi.status WHEN 'pending' THEN 0 WHEN 'opened' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,
               wi.created_at DESC
    `).all();
    res.json(rows);
  });

  router.patch('/worker-invitations/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const action = cleanText(req.body?.action, 20);
    if (!Number.isInteger(id) || id <= 0 || action !== 'cancel') {
      return res.status(400).json({ error: 'invalid_worker_invitation_action' });
    }
    workerInvitations.expireOutstanding();
    const before = getDb().prepare('SELECT * FROM worker_invitations WHERE id=?').get(id);
    if (!before) return res.status(404).json({ error: 'worker_invitation_not_found' });
    if (!['pending', 'opened'].includes(before.status)) {
      return res.status(409).json({ error: 'worker_invitation_not_cancellable', status: before.status });
    }
    getDb().prepare(`
      UPDATE worker_invitations
      SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancelled_by=?,cancelled_by_name=?
      WHERE id=?
    `).run(Number(req.auth?.sub) || null, cleanText(req.auth?.display_name, 100) || null, id);
    auditLog(
      'worker_invitation', id, before.invitation_uid, 'cancel', 'status', before.status, 'cancelled',
      before.worker_name, Number(req.auth?.sub) || null, cleanText(req.auth?.display_name, 100) || null,
    );
    res.json({ success: true, status: 'cancelled' });
  });

  // The invite token is intentionally the only credential accepted here. It
  // never returns a token hash, a user list, or any factory data.
  router.get('/worker-invitations/activation', activationLimiter, (req, res) => {
    const row = workerInvitations.markOpened(req.query?.token);
    if (!row || !['pending', 'opened'].includes(workerInvitations.effectiveStatus(row))) {
      const failure = publicActivationError(row, workerInvitations);
      return res.status(failure.status).json({ error: failure.error });
    }
    res.json(workerInvitations.publicInvite(row));
  });

  router.post('/worker-invitations/activation', activationLimiter, (req, res) => {
    const token = String(req.body?.token || '').trim();
    const username = cleanUsername(req.body?.username);
    const pin = String(req.body?.pin || '').trim();
    const deviceName = cleanText(req.body?.device_name, 100);
    const platform = cleanText(req.body?.platform, 160);
    if (username.length < 3 || !/^\d{4,8}$/.test(pin) || deviceName.length < 2) {
      return res.status(400).json({ error: 'worker_registration_details_required' });
    }

    let claimed;
    try {
      claimed = getDb().transaction(() => {
        const invite = workerInvitations.findByToken(token);
        if (!invite || !['pending', 'opened'].includes(workerInvitations.effectiveStatus(invite))) {
          const failure = publicActivationError(invite, workerInvitations);
          const error = new Error(failure.error);
          error.status = failure.status;
          throw error;
        }
        if (getDb().prepare('SELECT id FROM users WHERE username=?').get(username)) {
          const error = new Error('username_already_exists');
          error.status = 409;
          throw error;
        }

        const userId = getDb().prepare(`
          INSERT INTO users (username,display_name,role,pin,pin_hash,phone,active,password_changed_at)
          VALUES (?,?,?,?,?,?,0,?)
        `).run(
          username,
          invite.worker_name,
          invite.role,
          null,
          hashPin(pin),
          invite.phone || null,
          new Date().toISOString(),
        ).lastInsertRowid;
        const enrollment = deviceEnrollment.createPendingEnrollment({
          requesterName: invite.worker_name,
          deviceName,
          platform: platform || cleanText(req.get('user-agent'), 160),
          userAgent: cleanText(req.get('user-agent'), 500),
          ipAddress: cleanText(req.ip, 100),
          requesterUserId: Number(userId),
          invitationId: invite.id,
        });
        const updated = getDb().prepare(`
          UPDATE worker_invitations
          SET status='claimed',claimed_at=CURRENT_TIMESTAMP,claimed_user_id=?,claimed_device_id=?
          WHERE id=? AND status IN ('pending','opened')
        `).run(userId, enrollment.row.id, invite.id);
        if (updated.changes !== 1) throw new Error('invitation_already_used');
        return { invite, userId: Number(userId), enrollment };
      })();
    } catch (error) {
      const status = Number(error.status) || (String(error.message).includes('UNIQUE') ? 409 : 400);
      return res.status(status).json({ error: error.message || 'worker_registration_failed' });
    }

    auditLog(
      'worker_invitation', claimed.invite.id, claimed.invite.invitation_uid, 'claim', 'status',
      claimed.invite.status, 'claimed', `${claimed.invite.worker_name} · ${claimed.enrollment.row.device_name}`,
      claimed.userId, claimed.invite.worker_name,
    );
    res.status(201).json({
      status: 'pending_approval',
      worker_name: claimed.invite.worker_name,
      device_name: claimed.enrollment.row.device_name,
      device_credential: claimed.enrollment.credential,
    });
  });

  return router;
};

module.exports.manifest = {
  id: 'worker-invitations',
  label: 'הזמנות עובדים',
  screens: ['worker-invite.html'],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  consumes: [{ table: 'users' }, { table: 'device_enrollment_requests' }],
  produces: [{ table: 'worker_invitations' }],
};
