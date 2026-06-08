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

  // Generate / fetch portal token for a customer.
  router.get('/customers/:id/token', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    let c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'לא נמצא' });
    const result = portalAccess.portalAuthResponse(c);
    res.json({ token: result.token, link: result.link, expiresAt: result.expiresAt });
  });

  router.post('/customers/:id/token/rotate', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    let c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const result = portalAccess.portalAuthResponse(c, { forceRotate: true });
    auditLog('customer', c.id, null, 'portal_token_rotate', null, null, null, null, req.userId || null, null);
    res.json({ token: result.token, link: result.link, expiresAt: result.expiresAt });
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
  "id": "portal-admin",
  "label": "Portal Admin",
  "consumes": [
    {
      "table": "customers"
    }
  ],
  "produces": []
};
