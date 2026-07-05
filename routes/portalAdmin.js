const router = require('express').Router();
const { createPortalAccessService } = require('../services/portalAccess');

function required(name, value) {
  if (!value) throw new Error(`routes/portalAdmin missing dependency: ${name}`);
  return value;
}

module.exports = function createPortalAdminRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const auditLog = required('auditLog', deps.auditLog);
  const crypto = required('crypto', deps.crypto);
  const settingsService = required('settingsService', deps.settingsService);
  const PORT = required('PORT', deps.PORT);

  const portalAccess = createPortalAccessService({ db, crypto, settingsService, PORT });

  function requestPublicBaseUrl(req) {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
  }

  function portalTokenPayload(result) {
    const accessCode = String(result.token || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join('-') || '';
    return { token: result.token, accessCode, link: result.link, expiresAt: result.expiresAt };
  }

  // Generate / fetch portal token for a customer.
  router.get('/customers/:id/token', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    let c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'לא נמצא' });
    const result = portalAccess.portalAuthResponse(c, { baseUrl: requestPublicBaseUrl(req) });
    res.json(portalTokenPayload(result));
  });

  router.post('/customers/:id/token/rotate', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    let c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const result = portalAccess.portalAuthResponse(c, { forceRotate: true, baseUrl: requestPublicBaseUrl(req) });
    auditLog('customer', c.id, null, 'portal_token_rotate', null, null, null, null, req.userId || null, null);
    res.json(portalTokenPayload(result));
  });

  router.post('/customers/:id/portal-password/reset', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const phone = portalAccess.normalizePortalPhone(req.body.phone || c.phone);
    if (!phone) return res.status(400).json({ error: 'אין טלפון ללקוח. עדכן טלפון לפני יצירת סיסמת פורטל.' });
    const user = portalAccess.findOrCreatePortalUser(c.id, phone, req.body.name || c.name);
    const temporaryPassword = portalAccess.generatePortalPassword();
    const result = portalAccess.setPortalPassword(user.id, temporaryPassword);
    if (!result.ok) return res.status(400).json({ error: result.error });
    auditLog('customer', c.id, null, 'portal_password_reset', null, null, null, null, req.userId || null, null);
    res.json({
      success: true,
      phone,
      userId: user.id,
      temporaryPassword,
      message: `שלום ${c.name || ''}, הכניסה לפורטל טנא: ${portalAccess.configuredBaseUrl(requestPublicBaseUrl(req))}/customer.html\nטלפון: ${phone}\nסיסמה זמנית: ${temporaryPassword}`
    });
  });

  router.delete('/customers/:id/token', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const c = db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    db.prepare('UPDATE customers SET portal_token_revoked_at=CURRENT_TIMESTAMP WHERE id=?').run(c.id);
    auditLog('customer', c.id, null, 'portal_token_revoke', null, null, null, null, req.userId || null, null);
    res.json({ success: true });
  });

  router.patch('/customers/:id/pricing', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { price_tier, discount_pct } = req.body;
    // BUG-26: validate discount is 0-100.
    const discountNum = Number(discount_pct ?? 0);
    if (isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
      return res.status(400).json({ error: 'הנחה חייבת להיות בין 0 ל-100' });
    }
    db.prepare('UPDATE customers SET price_tier=?,discount_pct=? WHERE id=?')
      .run(price_tier, discountNum, req.params.id);
    res.json({ success: true });
  });

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  "id": "portal-admin",
  "label": "Portal Admin",
  "consumes": [
    {
      "table": "customers"
    }
  ],
  "produces": []
};
