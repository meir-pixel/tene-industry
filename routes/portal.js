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
    issuePortalOtp,
    verifyPortalOtp,
    portalAuthResponse,
  } = portalAccess;

  // Auth: get/create customer by phone (walk-in) or by token
  router.post('/c/auth', customerPortalAuthLimiter, (req, res) => {
    const { name } = req.body;
    const rawPhone = String(req.body.phone || '').trim();
    const phone = normalizePortalPhone(rawPhone);
    if (!phone) return res.status(400).json({ error: 'טלפון חובה' });
    let c = db.prepare('SELECT * FROM customers WHERE phone=? OR phone=?').get(phone, rawPhone);
    if (!c) {
      if (!name) return res.json({ needName: true }); // ask for name first
      const r = db.prepare('INSERT INTO customers (name,phone,price_tier) VALUES (?,?,?)').run(name, phone, 'list');
      c = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
    }
    const otp = issuePortalOtp(c);
    if (!IS_TEST) {
      intake.sendWhatsApp(c.phone, `קוד האימות שלך ל-IronBend: ${otp.code}`).catch(e => console.warn('[Portal OTP]', e));
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
    if (!c || normalizePortalPhone(c.phone) !== phone) return res.status(401).json({ error: 'Invalid code' });
    res.json(portalAuthResponse(c));
  });

  // Get customer info + recent orders
  router.get('/c/me', customerPortalActionLimiter, (req, res) => {
    const { token } = req.query;
    const c = resolveCustomer(token);
    if (!c) return res.status(401).json({ error: 'לא מורשה' });
    const orders = db.prepare(`
      SELECT id, order_num, status, created_at, total_weight, billing_weight, delivery_date, portal_price
      FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 20
    `).all(c.id);
    res.json({ customer: { id: c.id, name: c.name, phone: c.phone }, orders }); // BUG-40: removed price_tier/discount_pct (internal fields)
  });

  // Shapes (public)
  router.get('/c/shapes', customerPortalActionLimiter, (req, res) => {
    res.json(db.prepare('SELECT * FROM shapes WHERE active=1 ORDER BY id').all());
  });

  // Price list for this customer
  router.get('/c/price-list', customerPortalActionLimiter, (req, res) => {
    const { token } = req.query;
    const c = resolveCustomer(token);
    const priceMap = pricer.buildPriceMap({
      tier:        c?.price_tier  || 'list',
      discountPct: c?.discount_pct || 0,
    });
    res.json(Object.entries(priceMap).map(([diameter, price_per_kg]) => ({
      diameter: Number(diameter),
      price_per_kg: +price_per_kg.toFixed(2),
    })));
  });

  // Quote — calculate price for items before ordering
  router.post('/c/quote', customerPortalActionLimiter, (req, res) => {
    const { token, items } = req.body; // items: [{diameter, sides[], qty}]
    const c = resolveCustomer(token);

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
    let c = resolveCustomer(token);
    if (!c) return res.status(401).json({ error: 'נדרש זיהוי' });
    if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });

    // Calculate price via pricer service
    const wastePct = settingsService.getNum('WASTE_PCT_DEFAULT', 3);
    const priceMap = pricer.buildPriceMap({
      tier:        c.price_tier  || 'list',
      discountPct: c.discount_pct || 0,
    });
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
      const ppu = priceMap[item.diameter] || 0;
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
      summary: { totalWeight: +totalWeight.toFixed(2), billingWeight: +billingWeight.toFixed(2), portalPrice: +portalPrice.toFixed(2) },
      token: c.portal_token,
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
    const c = resolveCustomer(token);
    if (!c) return res.status(401).json({ error: 'לא מורשה' });
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
    const c = resolveCustomer(token);
    if (!c) return res.status(401).json({ error: 'לא מורשה' });
    // BUG-42: limited projection — no cost/internal fields exposed to portal
    const order = db.prepare(`
      SELECT id,order_num,status,created_at,delivery_date,delivery_address,delivery_time,
             general_notes AS notes,total_weight,billing_weight,portal_price
      FROM orders WHERE id=? AND customer_id=?
    `).get(req.params.orderId, c.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    const pallets = db.prepare("SELECT id,pallet_num,'' AS notes FROM pallets WHERE order_id=?").all(order.id);
    pallets.forEach(p => {
      p.items = db.prepare(`
        SELECT id,diameter,total_length_mm,quantity,weight_per_unit,total_weight,
               machine,segments,struct_element,struct_floor,sheet_num,status
        FROM items WHERE pallet_id=?
      `).all(p.id);
    });
    order.pallets = pallets;
    res.json(order);
  });

  // ── AI PREDICTION ─────────────────────────────────────────────────


  return router;
};
