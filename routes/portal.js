const router = require('express').Router();
const { createPortalAccessService } = require('../services/portalAccess');

function required(name, value) {
  if (!value) throw new Error(`routes/portal missing dependency: ${name}`);
  return value;
}

module.exports = function createPortalRouter(deps) {
  const db = required('db', deps.db);
  const customerPortalAuthLimiter = required('customerPortalAuthLimiter', deps.customerPortalAuthLimiter);
  const customerPortalActionLimiter = required('customerPortalActionLimiter', deps.customerPortalActionLimiter);
  const crypto = required('crypto', deps.crypto);
  const intake = required('intake', deps.intake);
  const industry = required('industry', deps.industry);
  const generateOrderNum = required('generateOrderNum', deps.generateOrderNum);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const pricer          = required('pricer',          deps.pricer);
  const settingsService = required('settingsService', deps.settingsService);
  const PORT = required('PORT', deps.PORT);
  const IS_TEST = Boolean(deps.IS_TEST);

  const portalAccess = createPortalAccessService({ db, crypto, settingsService, PORT });
  const {
    normalizePortalPhone,
    resolveCustomer,
    findOrCreatePortalUser,
    issueUserToken,
    setPortalPassword,
    verifyPortalPassword,
    resolvePortalSession,
    roleCaps,
    issuePortalOtp,
    verifyPortalOtp,
    portalAuthResponse,
  } = portalAccess;

  // session(token) → {customer, role}. טוקן פר-משתמש; נפילה לטוקן חברה ישן (role=both, תאימות לאחור).
  function session(token) {
    const s = resolvePortalSession(token);
    if (s) return { customer: s.customer, user: s.user, role: s.role, caps: roleCaps(s.role) };
    const c = resolveCustomer(token);
    if (c) return { customer: c, user: null, role: 'both', caps: roleCaps('both') };
    return null;
  }

  // Auth: get/create customer by phone (walk-in) or by token
  router.post('/c/auth', customerPortalAuthLimiter, (req, res) => {
    const { name } = req.body;
    const rawPhone = String(req.body.phone || '').trim();
    const phone = normalizePortalPhone(rawPhone);
    if (!phone) return res.status(400).json({ error: 'טלפון חובה' });
    // 1) משתמש פורטל קיים (טלפון אישי) → החברה שלו
    let c = null;
    const pu = portalAccess.resolvePortalUser(phone);
    if (pu) c = db.prepare('SELECT * FROM customers WHERE id=?').get(pu.customer_id);
    // 2) טלפון של חברה (legacy)
    if (!c) c = db.prepare('SELECT * FROM customers WHERE phone=? OR phone=?').get(phone, rawPhone);
    // 3) חדש לגמרי → צריך שם → פותח חברה
    if (!c) {
      if (!name) return res.json({ needName: true }); // ask for name first
      const r = db.prepare('INSERT INTO customers (name,phone,price_tier) VALUES (?,?,?)').run(name, phone, 'list');
      c = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
    }
    const otp = issuePortalOtp({ id: c.id, phone }); // OTP לטלפון שהוקלד (לא בהכרח טלפון החברה)
    if (!IS_TEST) {
      intake.sendWhatsApp(phone, `קוד האימות שלך: ${otp.code}`).catch(e => console.warn('[Portal OTP]', e));
    }
    res.json({
      otpRequired: true,
      expiresAt: otp.expiresAt,
      devOtp: IS_TEST || process.env.NODE_ENV !== 'production' ? otp.code : undefined,
      customer: { id: c.id, name: c.name, phone: c.phone }
    });
  });

  router.post('/c/auth/verify', customerPortalAuthLimiter, (req, res) => {
    const phone = normalizePortalPhone(req.body.phone);
    const verified = verifyPortalOtp(phone, req.body.code);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    const c = db.prepare('SELECT * FROM customers WHERE id=?').get(verified.customerId);
    if (!c) return res.status(401).json({ error: 'Invalid code' });
    // משתמש פורטל + תפקיד + טוקן פר-משתמש (הטלפון יכול להיות אישי, לא של החברה)
    const user = findOrCreatePortalUser(c.id, phone, c.name);
    const { token, expiresAt } = issueUserToken(user);
    const caps = roleCaps(user.role);
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    res.json({
      token,
      link: `${baseUrl}/customer.html?token=${token}`,
      expiresAt,
      role: user.role,
      caps,
      customer: { id: c.id, name: c.name, phone: c.phone, price_tier: caps.seePrice ? c.price_tier : undefined }
    });
  });

  router.post('/c/auth/password', customerPortalAuthLimiter, (req, res) => {
    const phone = normalizePortalPhone(req.body.phone);
    const password = String(req.body.password || '');
    if (!phone || !password) return res.status(400).json({ error: 'טלפון וסיסמה חובה' });
    const user = portalAccess.resolvePortalUser(phone);
    if (!user || !verifyPortalPassword(user, password)) {
      return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }
    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(user.customer_id);
    if (!customer) return res.status(401).json({ error: 'לקוח לא פעיל' });
    const { token, expiresAt } = issueUserToken(user);
    const caps = roleCaps(user.role);
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    res.json({
      token,
      link: `${baseUrl}/customer.html?token=${token}`,
      expiresAt,
      role: user.role,
      caps,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, price_tier: caps.seePrice ? customer.price_tier : undefined }
    });
  });

  router.post('/c/password/change', customerPortalActionLimiter, (req, res) => {
    const s = session(req.body.token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.user) return res.status(400).json({ error: 'כניסה בקישור ישן אינה תומכת בשינוי סיסמה. היכנס עם משתמש פורטל.' });
    const oldPassword = String(req.body.oldPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (s.user.password_hash && !verifyPortalPassword(s.user, oldPassword)) {
      return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
    }
    const result = setPortalPassword(s.user.id, newPassword);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  // ── ניהול משתמשי פורטל (מאשר בלבד) ────────────────────────────
  router.get('/c/users', customerPortalActionLimiter, (req, res) => {
    const s = session(req.query.token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.canApprove) return res.status(403).json({ error: 'רק מאשר יכול לנהל משתמשים' });
    const users = db.prepare('SELECT id,phone,name,role,active FROM portal_users WHERE customer_id=? ORDER BY id').all(s.customer.id);
    res.json({ users });
  });

  router.post('/c/users', customerPortalActionLimiter, (req, res) => {
    const s = session(req.body.token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.canApprove) return res.status(403).json({ error: 'רק מאשר יכול לנהל משתמשים' });
    const phone = normalizePortalPhone(req.body.phone);
    const name = req.body.name || null;
    const role = ['orderer', 'approver', 'both'].includes(req.body.role) ? req.body.role : 'orderer';
    if (!phone) return res.status(400).json({ error: 'טלפון חובה' });
    const existing = db.prepare('SELECT * FROM portal_users WHERE phone=?').get(phone);
    if (existing) {
      if (existing.customer_id !== s.customer.id) return res.status(409).json({ error: 'הטלפון משויך ללקוח אחר' });
      db.prepare('UPDATE portal_users SET name=COALESCE(?,name), role=?, active=1 WHERE id=?').run(name, role, existing.id);
      return res.json({ success: true, id: existing.id, updated: true });
    }
    const r = db.prepare('INSERT INTO portal_users (customer_id,phone,name,role) VALUES (?,?,?,?)').run(s.customer.id, phone, name, role);
    res.json({ success: true, id: r.lastInsertRowid });
  });

  router.post('/c/users/:id/deactivate', customerPortalActionLimiter, (req, res) => {
    const s = session(req.body.token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.canApprove) return res.status(403).json({ error: 'רק מאשר יכול לנהל משתמשים' });
    const u = db.prepare('SELECT * FROM portal_users WHERE id=? AND customer_id=?').get(req.params.id, s.customer.id);
    if (!u) return res.status(404).json({ error: 'לא נמצא' });
    db.prepare('UPDATE portal_users SET active=0 WHERE id=?').run(u.id);
    res.json({ success: true });
  });

  // Get customer info + recent orders
  router.get('/c/me', customerPortalActionLimiter, (req, res) => {
    const { token } = req.query;
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    const c = s.customer;
    let orders = db.prepare(`
      SELECT id, order_num, status, created_at, total_weight, billing_weight, delivery_date, portal_price
      FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 20
    `).all(c.id);
    if (!s.caps.seePrice) orders = orders.map(({ portal_price, ...o }) => o); // מזמין (שטח) לא רואה מחיר
    res.json({ customer: { id: c.id, name: c.name, phone: c.phone }, role: s.role, caps: s.caps, orders }); // BUG-40: ללא price_tier/discount_pct
  });

  // Shapes (public)
  router.get('/c/shapes', customerPortalActionLimiter, (req, res) => {
    res.json(db.prepare('SELECT * FROM shapes WHERE active=1 ORDER BY id').all());
  });

  // Price list for this customer
  router.get('/c/price-list', customerPortalActionLimiter, (req, res) => {
    const { token } = req.query;
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.seePrice) return res.json({ priceHidden: true, items: [] }); // מזמין לא רואה מחירון
    const c = s.customer;
    res.json(pricer.listCustomerPrices(c).map(row => ({
      diameter: row.diameter,
      price_per_kg: row.price_per_kg === null ? null : +row.price_per_kg.toFixed(2),
      pricingSource: row.pricingSource,
      pricingLabel: row.pricingLabel,
      status: row.status,
      requiresPriceListUpdate: row.requiresPriceListUpdate,
      warning: row.warning,
    })));
  });

  // Quote — calculate price for items before ordering
  router.post('/c/quote', customerPortalActionLimiter, (req, res) => {
    const { token, items } = req.body; // items: [{diameter, sides[], qty}]
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.seePrice) return res.json({ priceHidden: true }); // מזמין לא רואה הצעת מחיר
    const c = s.customer;

    const priceItems = (items || []).map(item => {
      const totalLengthMm = (item.sides || []).reduce((s, v) => s + v, 0);
      const totalWeight = industry.weightPerUnit({ diameter: item.diameter, total_length_mm: totalLengthMm }) * (item.qty || 1);
      return { diameter: item.diameter, totalWeight };
    });

    const result = pricer.calcOrderPriceForCustomer(priceItems, c);
    res.json(result);
  });

  // Submit order from portal
  router.post('/c/order', customerPortalActionLimiter, async (req, res) => {
    const { token, items, deliveryDate, deliveryTime, deliveryAddress, notes } = req.body;
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'נדרש זיהוי' });
    const c = s.customer;
    if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });

    // Calculate price via pricer service
    const wastePct = settingsService.getNum('WASTE_PCT_DEFAULT', 3);
    const priceChecks = (items || []).map(item => pricer.resolveDiameterPrice(item.diameter, {
      tier: c.price_tier || 'list',
      discountPct: c.discount_pct || 0,
    }));
    const missingPrice = priceChecks.find(row => row.requiresPriceListUpdate);
    if (missingPrice) {
      return res.status(409).json({
        error: 'מחירון דורש עדכון',
        status: 'price_list_requires_update',
        requiresPriceListUpdate: true,
        diameter: missingPrice.diameter,
        pricingSource: missingPrice.pricingSource,
        pricingLabel: missingPrice.pricingLabel,
      });
    }
    let totalWeight = 0, totalPrice = 0;
    const orderNum = generateOrderNum();
    const confirmToken = crypto.randomBytes(16).toString('hex');

    const orderRow = db.prepare(`
      INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_time,delivery_address,
        priority,general_notes,total_weight,waste_pct_charged,billing_weight,portal_order,status,confirm_token)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'ממתינה לאישור לקוח',?)
    `).run(orderNum, c.id, 'פורטל לקוח', deliveryDate, deliveryTime, deliveryAddress,
           'רגיל', notes, 0, wastePct, 0, confirmToken);

    const orderId = orderRow.lastInsertRowid;
    const palletRow = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight) VALUES (?,1,9999)').run(orderId);
    const palletId = palletRow.lastInsertRowid;

    const itemLines = [];
    items.forEach(item => {
      const totalLengthMm = (item.sides || []).reduce((s,v) => s+v, 0);
      const weight = industry.weightPerUnit({ diameter: item.diameter, total_length_mm: totalLengthMm }) * (item.qty || 1);
      const priceDecision = pricer.resolveDiameterPrice(item.diameter, {
        tier: c.price_tier || 'list',
        discountPct: c.discount_pct || 0,
      });
      const ppu = priceDecision.pricePerKg;
      totalWeight += weight;
      totalPrice += weight * ppu;
      const segments = JSON.stringify((item.sides || []).map((l,i) => ({ length_mm:l, angle_deg:(item.angles||[])[i]??0 })));
      const machine = industry.assignResource(item.diameter);
      db.prepare(`INSERT INTO items (pallet_id,shape_id,shape_name,diameter,segments,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,note,machine)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(palletId, item.shapeId||'s1', item.shapeName||'ישר', item.diameter, segments, totalLengthMm,
             item.qty||1, Math.ceil((item.qty||1)*(1+wastePct/100)), weight/(item.qty||1), weight, item.note||'', machine);
      itemLines.push(`• ${item.qty||1}× Ø${item.diameter} ${item.shapeName||'ישר'} – ${Math.round(totalLengthMm/10)}ס"מ`);
    });

    const billingWeight = totalWeight * (1 + wastePct/100);
    const portalPrice   = totalPrice  * (1 + wastePct/100);
    db.prepare('UPDATE orders SET total_weight=?,billing_weight=?,portal_price=? WHERE id=?')
      .run(totalWeight, billingWeight, portalPrice, orderId);
    db.prepare('UPDATE pallets SET total_weight=? WHERE id=?').run(totalWeight, palletId);

    wsBroadcast('new_order', { orderNum, orderId, channel: 'פורטל לקוח', status: 'ממתינה לאישור לקוח' });

    // Send WhatsApp confirmation with approve link (non-blocking)
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const approveLink = `${baseUrl}/api/c/approve/${confirmToken}`;
    const delivInfo = deliveryDate ? `📅 אספקה: ${deliveryDate}${deliveryTime ? ' ' + deliveryTime : ''}` : '';
    const addrInfo  = deliveryAddress ? `📍 ${deliveryAddress}` : '';
    const waMsg = `📋 *הזמנה ${orderNum} – ממתינה לאישורך*\n\nשלום ${c.name},\nקיבלנו את הזמנתך:\n\n${itemLines.join('\n')}\n\n⚖️ משקל לחיוב: ${billingWeight.toFixed(1)} ק"ג\n💰 סה"כ: ₪${portalPrice.toFixed(0)}\n${delivInfo}\n${addrInfo}\n\n*לאישור ותחילת ייצור – לחץ כאן:*\n${approveLink}\n\n_⚠️ ייצור יתחיל רק לאחר אישורך_`;

    if (c.phone) intake.sendWhatsApp(c.phone, waMsg).catch(e => console.warn('[Order confirm WA]', e));

    res.json({
      success: true, orderNum, orderId,
      summary: {
        totalWeight: +totalWeight.toFixed(2),
        billingWeight: +billingWeight.toFixed(2),
        ...(s.caps.seePrice ? { portalPrice: +portalPrice.toFixed(2) } : {})
      },
      token,
      awaitingApproval: true
    });
  });

  // Customer order approval (link from WhatsApp)
  router.get('/c/approve/:token', customerPortalActionLimiter, (req, res) => {
    const order = db.prepare('SELECT o.*,c.name as customer_name,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.confirm_token=?').get(req.params.token);
    if (!order) return res.status(404).send(approvalPage('לא נמצא', 'קישור לא תקין או פג תוקף.', false));
    if (order.status !== 'ממתינה לאישור לקוח') {
      return res.send(approvalPage('כבר אושרה', `הזמנה ${order.order_num} כבר אושרה ובטיפול!`, true));
    }
    db.prepare("UPDATE orders SET status='אושרה – ממתין לייצור', confirm_token=NULL WHERE id=?").run(order.id);
    wsBroadcast('order_status', { id: order.id, status: 'אושרה – ממתין לייצור', orderNum: order.order_num });
    // Notify factory via WA to the notify phone
    const notifyPhone = db.prepare("SELECT value FROM settings WHERE key='WHATSAPP_NOTIFY_PHONE'").get()?.value;
    if (notifyPhone) {
      const msg = `✅ הזמנה ${order.order_num} אושרה ע"י הלקוח ${order.customer_name||''} – ניתן להתחיל ייצור!`;
      intake.sendWhatsApp(notifyPhone, msg).catch(()=>{});
    }
    return res.send(approvalPage('✅ הזמנה אושרה!', `הזמנה ${order.order_num} אושרה בהצלחה.\nנתחיל בייצור בהקדם האפשרי. 🏗️`, true));
  });

  // Also allow approval from portal (POST)
  router.post('/c/approve', customerPortalActionLimiter, (req, res) => {
    const { token, orderId } = req.body;
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    if (!s.caps.canApprove) return res.status(403).json({ error: 'רק מאשר (כספים) יכול לאשר הזמנה' });
    const c = s.customer;
    const order = db.prepare('SELECT * FROM orders WHERE id=? AND customer_id=? AND status=?').get(orderId, c.id, 'ממתינה לאישור לקוח');
    if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה או כבר אושרה' });
    db.prepare("UPDATE orders SET status='אושרה – ממתין לייצור', confirm_token=NULL WHERE id=?").run(orderId);
    wsBroadcast('order_status', { id: orderId, status: 'אושרה – ממתין לייצור', orderNum: order.order_num });
    const notifyPhone = db.prepare("SELECT value FROM settings WHERE key='WHATSAPP_NOTIFY_PHONE'").get()?.value;
    if (notifyPhone) {
      intake.sendWhatsApp(notifyPhone, `✅ הזמנה ${order.order_num} אושרה ע"י הלקוח – ניתן להתחיל ייצור!`).catch(()=>{});
    }
    res.json({ success: true });
  });

  function approvalPage(title, msg, success) {
    const color = success ? '#27ae60' : '#e74c3c';
    const icon  = success ? '✅' : '❌';
    return `<!DOCTYPE html><html lang="he" dir="rtl">
    <head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${title}</title>
    <style>body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;direction:rtl}
    .box{background:#fff;border-radius:20px;padding:40px 32px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.1);max-width:380px;width:90%}
    .icon{font-size:64px;margin-bottom:16px}
    h1{font-size:22px;color:${color};margin-bottom:12px}
    p{color:#555;font-size:15px;line-height:1.6;white-space:pre-line}
    a{display:inline-block;margin-top:24px;padding:12px 28px;background:#e07b39;color:#fff;border-radius:12px;text-decoration:none;font-weight:700}
    </style></head>
    <body><div class="box">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${msg}</p>
      <a href="/">חזרה לדף הבית</a>
    </div></body></html>`;
  }

  // Customer order history
  router.get('/c/orders/:orderId', customerPortalActionLimiter, (req, res) => {
    const { token } = req.query;
    const s = session(token);
    if (!s) return res.status(401).json({ error: 'לא מורשה' });
    const c = s.customer;
    // BUG-42: limited projection — no cost/internal fields exposed to portal
    const order = db.prepare(`
      SELECT id,order_num,status,created_at,delivery_date,delivery_address,delivery_time,
             general_notes AS notes,total_weight,billing_weight,portal_price
      FROM orders WHERE id=? AND customer_id=?
    `).get(req.params.orderId, c.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    if (!s.caps.seePrice) delete order.portal_price; // מזמין לא רואה מחיר
    order.role = s.role; order.caps = s.caps;
    const pallets = db.prepare("SELECT id,pallet_num,'' AS notes FROM pallets WHERE order_id=?").all(order.id);
    pallets.forEach(p => {
      p.items = db.prepare(`
        SELECT id,shape_name,diameter,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,
               machine,segments,struct_element,struct_floor,sheet_num,status,note
        FROM items WHERE pallet_id=?
      `).all(p.id);
    });
    order.pallets = pallets;
    res.json(order);
  });

  // ── AI PREDICTION ─────────────────────────────────────────────────


  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'portal',
  label: 'פורטל לקוח',
  consumes: [{ table: 'customers' }, { table: 'orders' }, { table: 'price_list' }],
  produces: [
    { event: 'new_order' },
    { event: 'order_status' },
  ],
};
