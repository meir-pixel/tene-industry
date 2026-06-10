'use strict';

function required(name, value) {
  if (!value) throw new Error(`services/portalAccess missing dependency: ${name}`);
  return value;
}

function createPortalAccessService(deps) {
  const db = required('db', deps.db);
  const crypto = required('crypto', deps.crypto);
  const settingsService = required('settingsService', deps.settingsService);
  const PORT = required('PORT', deps.PORT);

  // BUG-41: limited projection - never return sensitive fields via portal resolver.
  const CUSTOMER_PORTAL_COLS = 'id,name,phone,email,address,portal_token,portal_token_expires_at,portal_token_revoked_at,price_tier,discount_pct';

  // ── משתמשי פורטל עם תפקידים (מזמין/מאשר) — ראה docs/spec-portal-roles.md ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      phone       TEXT NOT NULL UNIQUE,
      name        TEXT,
      role        TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('orderer','approver','both')),
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Backfill חד-פעמי: כל לקוח קיים עם טלפון → משתמש פורטל role=both (שומר התנהגות קיימת)
  try {
    if (db.prepare('SELECT COUNT(*) c FROM portal_users').get().c === 0) {
      const custs = db.prepare("SELECT id,name,phone FROM customers WHERE phone IS NOT NULL AND TRIM(phone)<>''").all();
      const ins = db.prepare("INSERT OR IGNORE INTO portal_users (customer_id,phone,name,role) VALUES (?,?,?,'both')");
      for (const c of custs) ins.run(c.id, normalizePortalPhone(c.phone), c.name);
    }
  } catch (e) { console.warn('[portal_users backfill]', e.message); }

  // יכולות לפי תפקיד — כולם מזמינים; מחיר ואישור רק ל-approver/both
  function roleCaps(role) {
    const r = role || 'both';
    return {
      role: r,
      canOrder: true,
      seePrice: r === 'approver' || r === 'both',
      canApprove: r === 'approver' || r === 'both',
    };
  }

  function resolvePortalUser(phone) {
    const np = normalizePortalPhone(phone);
    if (!np) return null;
    return db.prepare('SELECT * FROM portal_users WHERE phone=? AND active=1').get(np);
  }

  function resolveCustomer(token, phone) {
    if (token) return db.prepare(`
      SELECT ${CUSTOMER_PORTAL_COLS} FROM customers
      WHERE portal_token=?
        AND portal_token_revoked_at IS NULL
        AND (portal_token_expires_at IS NULL OR portal_token_expires_at > ?)
    `).get(token, new Date().toISOString());
    if (phone) return db.prepare(`SELECT ${CUSTOMER_PORTAL_COLS} FROM customers WHERE phone=?`).get(phone);
    return null;
  }

  const portalOtpTtlMinutes = () => settingsService.getNum('PORTAL_OTP_TTL_MINUTES', Number(process.env.PORTAL_OTP_TTL_MINUTES || 10));
  const portalTokenTtlDays = () => settingsService.getNum('PORTAL_TOKEN_TTL_DAYS', Number(process.env.PORTAL_TOKEN_TTL_DAYS || 90));

  function normalizePortalPhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function hashPortalOtp(phone, code) {
    return crypto.createHash('sha256')
      .update(`${process.env.JWT_SECRET || 'dev-secret'}:${phone}:${code}`)
      .digest('hex');
  }

  function portalTokenExpiresAt() {
    return new Date(Date.now() + portalTokenTtlDays() * 24 * 60 * 60 * 1000).toISOString();
  }

  function hasActivePortalToken(customer) {
    if (!customer.portal_token || customer.portal_token_revoked_at) return false;
    if (!customer.portal_token_expires_at) return true;
    return new Date(customer.portal_token_expires_at).getTime() > Date.now();
  }

  function ensurePortalToken(customer, options = {}) {
    if (!options.forceRotate && hasActivePortalToken(customer)) return customer.portal_token;
    const token = crypto.randomBytes(12).toString('hex');
    const expiresAt = portalTokenExpiresAt();
    db.prepare(`
      UPDATE customers
      SET portal_token=?,
          portal_token_created_at=CURRENT_TIMESTAMP,
          portal_token_expires_at=?,
          portal_token_revoked_at=NULL
      WHERE id=?
    `).run(token, expiresAt, customer.id);
    customer.portal_token = token;
    customer.portal_token_expires_at = expiresAt;
    customer.portal_token_revoked_at = null;
    return token;
  }

  function issuePortalOtp(customer) {
    const phone = normalizePortalPhone(customer.phone);
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + portalOtpTtlMinutes() * 60 * 1000).toISOString();
    db.prepare('UPDATE customer_portal_otps SET consumed_at=CURRENT_TIMESTAMP WHERE phone=? AND consumed_at IS NULL')
      .run(phone);
    db.prepare(`
      INSERT INTO customer_portal_otps (customer_id,phone,code_hash,expires_at)
      VALUES (?,?,?,?)
    `).run(customer.id, phone, hashPortalOtp(phone, code), expiresAt);
    return { code, expiresAt };
  }

  function verifyPortalOtp(phone, code) {
    const normalizedPhone = normalizePortalPhone(phone);
    const cleanCode = String(code || '').replace(/\D/g, '');
    const otp = db.prepare(`
      SELECT * FROM customer_portal_otps
      WHERE phone=? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(normalizedPhone);
    if (!otp) return { ok: false, status: 401, error: 'Invalid code' };
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      db.prepare('UPDATE customer_portal_otps SET consumed_at=CURRENT_TIMESTAMP WHERE id=?').run(otp.id);
      return { ok: false, status: 401, error: 'Code expired' };
    }
    if (Number(otp.attempts || 0) >= 5) return { ok: false, status: 429, error: 'Too many attempts' };
    if (hashPortalOtp(normalizedPhone, cleanCode) !== otp.code_hash) {
      db.prepare('UPDATE customer_portal_otps SET attempts=attempts+1 WHERE id=?').run(otp.id);
      return { ok: false, status: 401, error: 'Invalid code' };
    }
    db.prepare('UPDATE customer_portal_otps SET consumed_at=CURRENT_TIMESTAMP WHERE id=?').run(otp.id);
    return { ok: true, customerId: otp.customer_id };
  }

  function portalAuthResponse(customer, options = {}) {
    const token = ensurePortalToken(customer, options);
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    return {
      token,
      link: `${baseUrl}/customer.html?token=${token}`,
      expiresAt: customer.portal_token_expires_at || null,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, price_tier: customer.price_tier }
    };
  }

  return {
    normalizePortalPhone,
    resolveCustomer,
    resolvePortalUser,
    roleCaps,
    issuePortalOtp,
    verifyPortalOtp,
    portalAuthResponse,
  };
}

module.exports = { createPortalAccessService };
