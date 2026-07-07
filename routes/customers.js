const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/customers missing dependency: ${name}`);
  return value;
}

module.exports = function createCustomersRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  function normalizePortalPriceListVisibility(value) {
    return ['none', 'general', 'customer'].includes(value) ? value : 'none';
  }

  function boolFlag(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function safeQuery(fallback, fn) {
    try {
      return fn() || fallback;
    } catch {
      return fallback;
    }
  }

  router.get('/customers', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const q = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    // BUG-26: no portal_token in list response
    const rows = db.prepare(`
      SELECT c.id,c.name,c.phone,c.email,c.address,c.tax_id,c.payment_terms,c.portal_price_list_visibility,
             c.portal_can_manage_users,c.portal_can_create_sites,c.portal_can_set_budgets,c.portal_can_expose_prices,
             c.contact_name,c.contact_phone,c.priority_id,c.notes,c.price_tier,c.discount_pct,c.portal_profile_locked_at,
             COALESCE(cc.open_debt,0) AS balance,
             COALESCE(cc.credit_limit,0) AS credit_limit,
             c.created_at,
             COUNT(o.id)        AS order_count,
             COALESCE(SUM(o.total_weight),0) AS total_weight_sum,
             MAX(o.created_at)  AS last_order_at
      FROM customers c
      LEFT JOIN customer_credit cc ON cc.customer_id = c.id
      LEFT JOIN orders o ON o.customer_id = c.id
      WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.priority_id LIKE ?
      GROUP BY c.id
      ORDER BY c.name
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit);
    res.json(rows);
  });

  // BUG-26: no portal_token in admin customer detail — use dedicated /token endpoint
  const CUSTOMER_ADMIN_COLS = 'c.id,c.name,c.phone,c.email,c.address,c.tax_id,c.payment_terms,c.portal_price_list_visibility,c.portal_can_manage_users,c.portal_can_create_sites,c.portal_can_set_budgets,c.portal_can_expose_prices,c.contact_name,c.contact_phone,c.priority_id,c.notes,c.price_tier,c.discount_pct,c.portal_profile_locked_at,COALESCE(cc.open_debt,0) AS balance,COALESCE(cc.credit_limit,0) AS credit_limit,c.created_at';
  router.get('/customers/:id', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const c = db.prepare(`SELECT ${CUSTOMER_ADMIN_COLS} FROM customers c LEFT JOIN customer_credit cc ON cc.customer_id=c.id WHERE c.id=?`).get(req.params.id);
    if (!c) return res.status(404).json({ error: 'לא נמצא' });
    c.orders = db.prepare(`
      SELECT id, order_num, status, created_at, total_weight, delivery_date, priority, channel
      FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 30
    `).all(c.id);
    const stats = db.prepare(`
      SELECT COUNT(*) AS order_count,
             COALESCE(SUM(total_weight),0) AS total_weight_sum,
             MAX(created_at) AS last_order_at
      FROM orders WHERE customer_id=?
    `).get(c.id);
    c.stats = stats;
    const orderSummary = safeQuery({ total: 0, open_count: 0, pending_count: 0, delivery_ready_count: 0, total_weight: 0, billing_weight: 0, order_value: 0 }, () => db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status NOT IN ('בוטלה','נמסרה','סופקה') THEN 1 ELSE 0 END),0) AS open_count,
             COALESCE(SUM(CASE WHEN status IN ('ממתינה לאישור','ממתינה לאישור לקוח') THEN 1 ELSE 0 END),0) AS pending_count,
             COALESCE(SUM(CASE WHEN status IN ('נמסרה','סופקה','מוכנה לאיסוף') THEN 1 ELSE 0 END),0) AS delivery_ready_count,
             COALESCE(SUM(total_weight),0) AS total_weight,
             COALESCE(SUM(billing_weight),0) AS billing_weight,
             COALESCE(SUM(COALESCE(NULLIF(sale_price,0), portal_price, 0)),0) AS order_value
      FROM orders WHERE customer_id=?
    `).get(c.id));
    const unbilled = safeQuery({ count: 0, billing_weight: 0, amount: 0 }, () => db.prepare(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(billing_weight),0) AS billing_weight,
             COALESCE(SUM(COALESCE(NULLIF(sale_price,0), portal_price, 0)),0) AS amount
      FROM orders
      WHERE customer_id=?
        AND status IN ('נמסרה','סופקה','מוכנה לאיסוף')
        AND COALESCE(NULLIF(sale_price,0), portal_price, 0) > 0
    `).get(c.id));
    const profitability = safeQuery({ today_revenue: 0, today_cost: 0, today_margin: 0, today_margin_pct: null, today_order_count: 0, total_revenue: 0, total_cost: 0, total_margin: 0, total_margin_pct: null }, () => db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN date(o.created_at)=date('now','localtime') THEN oc.revenue ELSE 0 END),0) AS today_revenue,
        COALESCE(SUM(CASE WHEN date(o.created_at)=date('now','localtime') THEN oc.total_cost ELSE 0 END),0) AS today_cost,
        COALESCE(SUM(CASE WHEN date(o.created_at)=date('now','localtime') THEN oc.gross_margin ELSE 0 END),0) AS today_margin,
        COALESCE(SUM(CASE WHEN date(o.created_at)=date('now','localtime') THEN 1 ELSE 0 END),0) AS today_order_count,
        COALESCE(SUM(oc.revenue),0) AS total_revenue,
        COALESCE(SUM(oc.total_cost),0) AS total_cost,
        COALESCE(SUM(oc.gross_margin),0) AS total_margin
      FROM orders o
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      WHERE o.customer_id=?
    `).get(c.id));
    profitability.today_margin_pct = Number(profitability.today_revenue || 0) > 0
      ? (Number(profitability.today_margin || 0) / Number(profitability.today_revenue || 0)) * 100
      : null;
    profitability.total_margin_pct = Number(profitability.total_revenue || 0) > 0
      ? (Number(profitability.total_margin || 0) / Number(profitability.total_revenue || 0)) * 100
      : null;
    const unbilledOrders = safeQuery([], () => db.prepare(`
      SELECT o.id,o.order_num,o.status,o.delivery_date,o.delivery_address,
             COALESCE(o.billing_weight,o.total_weight,0) AS billing_weight,
             COALESCE(oc.revenue, NULLIF(o.sale_price,0), o.portal_price, 0) AS suggested_amount,
             COALESCE(oc.total_cost,0) AS total_cost,
             COALESCE(oc.gross_margin,0) AS gross_margin
      FROM orders o
      LEFT JOIN order_costs oc ON oc.order_id=o.id
      LEFT JOIN order_billing ob ON ob.order_id=o.id
      WHERE o.customer_id=?
        AND o.status IN ('נמסרה','סופקה','מוכנה לאיסוף')
        AND ob.order_id IS NULL
      ORDER BY COALESCE(o.delivery_date,o.created_at) DESC, o.id DESC
      LIMIT 20
    `).all(c.id));
    const sites = safeQuery([], () => db.prepare(`
      SELECT cs.id,cs.name,cs.address,cs.city,cs.status,cs.manager_name,cs.manager_phone,
             COALESCE(cs.budget_amount,0) AS budget_amount,
             COALESCE(cs.budget_kg,0) AS budget_kg,
             COALESCE(cs.alert_pct,80) AS alert_pct,
             COALESCE(cs.block_over_budget,0) AS block_over_budget,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(o.billing_weight),0) AS billing_kg,
             COALESCE(SUM(COALESCE(NULLIF(o.sale_price,0), o.portal_price, 0)),0) AS spend
      FROM customer_sites cs
      LEFT JOIN orders o ON o.site_id=cs.id AND o.customer_id=cs.customer_id
      WHERE cs.customer_id=?
      GROUP BY cs.id
      ORDER BY cs.status='active' DESC, cs.name
    `).all(c.id));
    const siteTotals = sites.reduce((acc, site) => {
      acc.count += 1;
      if (site.status !== 'inactive') acc.active_count += 1;
      acc.budget_amount += Number(site.budget_amount || 0);
      acc.budget_kg += Number(site.budget_kg || 0);
      acc.spend += Number(site.spend || 0);
      acc.billing_kg += Number(site.billing_kg || 0);
      return acc;
    }, { count: 0, active_count: 0, budget_amount: 0, budget_kg: 0, spend: 0, billing_kg: 0 });
    const activePriceBook = safeQuery(null, () => db.prepare(`
      SELECT id,code,name,price_type,status,updated_at
      FROM pricing_price_books
      WHERE status='active' AND (customer_id=? OR customer_id IS NULL)
      ORDER BY customer_id IS NOT NULL DESC, updated_at DESC, id DESC
      LIMIT 1
    `).get(c.id));
    c.sites_summary = sites;
    c.unbilled_orders = unbilledOrders;
    c.workbench = {
      orders: orderSummary,
      unbilled,
      sites: siteTotals,
      finance: {
        open_balance: Number(c.balance || 0),
        credit_limit: Number(c.credit_limit || 0),
      },
      profitability,
      pricing: {
        mode: c.price_tier === 'customer' ? 'customer' : 'general',
        discount_pct: Number(c.discount_pct || 0),
        portal_visibility: c.portal_price_list_visibility || 'none',
        active_price_book: activePriceBook,
      },
    };
    c.profile_change_requests = db.prepare(`
      SELECT r.id,r.customer_id,r.portal_user_id,r.status,r.current_json,r.requested_json,r.notes,r.created_at,r.updated_at,r.reviewed_at,r.reviewed_by,
             pu.name AS portal_user_name, pu.phone AS portal_user_phone
      FROM customer_profile_change_requests r
      LEFT JOIN portal_users pu ON pu.id=r.portal_user_id
      WHERE r.customer_id=?
      ORDER BY r.status='pending' DESC, r.updated_at DESC, r.created_at DESC
      LIMIT 10
    `).all(c.id).map(row => ({
      ...row,
      current: JSON.parse(row.current_json || '{}'),
      requested: JSON.parse(row.requested_json || '{}'),
    }));
    res.json(c);
  });

  router.post('/customers', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { name, phone, email, address, taxId, paymentTerms, portalPriceListVisibility, portalCanManageUsers, portalCanCreateSites, portalCanSetBudgets, portalCanExposePrices, contactName, contactPhone, priorityId, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'שם חובה' });
    const r = db.prepare(`INSERT INTO customers (name,phone,email,address,tax_id,payment_terms,portal_price_list_visibility,portal_can_manage_users,portal_can_create_sites,portal_can_set_budgets,portal_can_expose_prices,contact_name,contact_phone,priority_id,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(name, phone, email, address, taxId, paymentTerms, normalizePortalPriceListVisibility(portalPriceListVisibility), boolFlag(portalCanManageUsers), boolFlag(portalCanCreateSites), boolFlag(portalCanSetBudgets), boolFlag(portalCanExposePrices), contactName, contactPhone, priorityId, notes);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/customers/:id', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { name, phone, email, address, taxId, paymentTerms, portalPriceListVisibility, portalCanManageUsers, portalCanCreateSites, portalCanSetBudgets, portalCanExposePrices, contactName, contactPhone, priorityId, notes } = req.body;
    db.prepare(`UPDATE customers SET name=?,phone=?,email=?,address=?,tax_id=?,payment_terms=?,portal_price_list_visibility=?,portal_can_manage_users=?,portal_can_create_sites=?,portal_can_set_budgets=?,portal_can_expose_prices=?,contact_name=?,contact_phone=?,priority_id=?,notes=? WHERE id=?`)
      .run(name, phone, email, address, taxId, paymentTerms, normalizePortalPriceListVisibility(portalPriceListVisibility), boolFlag(portalCanManageUsers), boolFlag(portalCanCreateSites), boolFlag(portalCanSetBudgets), boolFlag(portalCanExposePrices), contactName, contactPhone, priorityId, notes, req.params.id);
    res.json({ success: true });
  });

  router.post('/customers/:id/profile-change-requests/:requestId/approve', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare(`
      SELECT * FROM customer_profile_change_requests
      WHERE id=? AND customer_id=? AND status='pending'
    `).get(req.params.requestId, req.params.id);
    if (!row) return res.status(404).json({ error: '׳‘׳§׳©׳× ׳©׳™׳ ׳•׳™ ׳׳ ׳ ׳׳¦׳׳”' });
    const requested = JSON.parse(row.requested_json || '{}');
    if (!requested.name) return res.status(400).json({ error: '׳©׳ ׳׳§׳•׳— ׳—׳¡׳¨ ׳‘׳‘׳§׳©׳”' });
    db.prepare(`
      UPDATE customers SET name=?,email=?,address=?,portal_profile_locked_at=COALESCE(portal_profile_locked_at,CURRENT_TIMESTAMP)
      WHERE id=?
    `).run(requested.name, requested.email || null, requested.address || null, req.params.id);
    db.prepare(`
      UPDATE customer_profile_change_requests
      SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.auth?.sub || req.userId || null, row.id);
    res.json({ success: true });
  });

  router.post('/customers/:id/profile-change-requests/:requestId/reject', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare(`
      SELECT id FROM customer_profile_change_requests
      WHERE id=? AND customer_id=? AND status='pending'
    `).get(req.params.requestId, req.params.id);
    if (!row) return res.status(404).json({ error: '׳‘׳§׳©׳× ׳©׳™׳ ׳•׳™ ׳׳ ׳ ׳׳¦׳׳”' });
    db.prepare(`
      UPDATE customer_profile_change_requests
      SET status='rejected',notes=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.body?.notes || null, req.auth?.sub || req.userId || null, row.id);
    res.json({ success: true });
  });

  router.get('/customers/:id/portal-sites', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const customer = db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לא נמצא לקוח' });
    const sites = db.prepare(`
      SELECT id,customer_id,name,address,city,status,manager_name,manager_phone,budget_amount,budget_kg,alert_pct,block_over_budget,created_at,updated_at
      FROM customer_sites
      WHERE customer_id=?
      ORDER BY status='active' DESC, name
    `).all(customer.id);
    res.json({ sites });
  });

  router.post('/customers/:id/portal-sites', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const customer = db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לא נמצא לקוח' });
    const f = req.body || {};
    if (!f.name) return res.status(400).json({ error: 'שם אתר חובה' });
    const r = db.prepare(`
      INSERT INTO customer_sites
        (customer_id,name,address,city,status,manager_name,manager_phone,budget_amount,budget_kg,alert_pct,block_over_budget,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    `).run(
      customer.id,
      f.name,
      f.address || null,
      f.city || null,
      f.status || 'active',
      f.managerName || f.manager_name || null,
      f.managerPhone || f.manager_phone || null,
      Number(f.budgetAmount || f.budget_amount || 0),
      Number(f.budgetKg || f.budget_kg || 0),
      Number(f.alertPct || f.alert_pct || 80),
      boolFlag(f.blockOverBudget || f.block_over_budget)
    );
    res.json({ id: r.lastInsertRowid });
  });

  router.get('/customers/:id/portal-users', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const customer = db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לא נמצא לקוח' });
    const users = db.prepare(`
      SELECT id,customer_id,phone,name,email,role,active,default_site_id,
             can_manage_users,can_create_sites,can_assign_site_users,can_create_orders,can_approve_orders,
             can_view_prices,can_view_budget,can_set_budget,can_approve_budget_overrun,can_view_invoices,can_view_delivery_notes
      FROM portal_users
      WHERE customer_id=?
      ORDER BY active DESC, name, phone
    `).all(customer.id);
    const assignments = db.prepare(`
      SELECT su.portal_user_id,su.site_id,su.is_default,cs.name AS site_name
      FROM customer_site_users su
      JOIN customer_sites cs ON cs.id=su.site_id
      WHERE su.customer_id=?
      ORDER BY su.is_default DESC, cs.name
    `).all(customer.id);
    res.json({ users, assignments });
  });

  router.post('/customers/:id/portal-users', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const customer = db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'לא נמצא לקוח' });
    const f = req.body || {};
    const phone = normalizePhone(f.phone);
    if (!phone) return res.status(400).json({ error: 'טלפון חובה' });
    const allowedRoles = new Set(['orderer', 'approver', 'both']);
    const role = allowedRoles.has(f.role) ? f.role : 'orderer';
    const siteIds = Array.isArray(f.siteIds) ? f.siteIds.map(Number).filter(Boolean) : [];
    const defaultSiteId = Number(f.defaultSiteId || siteIds[0] || 0) || null;
    const existing = db.prepare('SELECT * FROM portal_users WHERE phone=?').get(phone);
    if (existing && existing.customer_id !== customer.id) return res.status(409).json({ error: 'הטלפון משויך ללקוח אחר' });
    const beforeJson = existing ? JSON.stringify(existing) : null;
    let userId;
    if (existing) {
      userId = existing.id;
      db.prepare(`
        UPDATE portal_users SET name=COALESCE(?,name),email=?,role=?,active=1,default_site_id=?,
          can_manage_users=?,can_create_sites=?,can_assign_site_users=?,can_create_orders=?,can_approve_orders=?,
          can_view_prices=?,can_view_budget=?,can_set_budget=?,can_approve_budget_overrun=?,can_view_invoices=?,
          can_view_delivery_notes=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND customer_id=?
      `).run(
        f.name || null, f.email || null, role, defaultSiteId,
        boolFlag(f.canManageUsers), boolFlag(f.canCreateSites), boolFlag(f.canAssignSiteUsers), f.canCreateOrders === false ? 0 : 1, boolFlag(f.canApproveOrders),
        boolFlag(f.canViewPrices), boolFlag(f.canViewBudget), boolFlag(f.canSetBudget), boolFlag(f.canApproveBudgetOverrun), boolFlag(f.canViewInvoices),
        f.canViewDeliveryNotes === false ? 0 : 1, userId, customer.id
      );
    } else {
      const r = db.prepare(`
        INSERT INTO portal_users
          (customer_id,phone,name,email,role,default_site_id,can_manage_users,can_create_sites,can_assign_site_users,
           can_create_orders,can_approve_orders,can_view_prices,can_view_budget,can_set_budget,can_approve_budget_overrun,
           can_view_invoices,can_view_delivery_notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        customer.id, phone, f.name || null, f.email || null, role, defaultSiteId,
        boolFlag(f.canManageUsers), boolFlag(f.canCreateSites), boolFlag(f.canAssignSiteUsers),
        f.canCreateOrders === false ? 0 : 1, boolFlag(f.canApproveOrders), boolFlag(f.canViewPrices), boolFlag(f.canViewBudget),
        boolFlag(f.canSetBudget), boolFlag(f.canApproveBudgetOverrun), boolFlag(f.canViewInvoices), f.canViewDeliveryNotes === false ? 0 : 1
      );
      userId = r.lastInsertRowid;
    }
    db.prepare('DELETE FROM customer_site_users WHERE customer_id=? AND portal_user_id=?').run(customer.id, userId);
    const addSite = db.prepare('INSERT OR IGNORE INTO customer_site_users (customer_id,site_id,portal_user_id,is_default) VALUES (?,?,?,?)');
    for (const siteId of siteIds) {
      const site = db.prepare('SELECT id FROM customer_sites WHERE id=? AND customer_id=?').get(siteId, customer.id);
      if (site) addSite.run(customer.id, site.id, userId, defaultSiteId === site.id ? 1 : 0);
    }
    const afterRow = db.prepare('SELECT * FROM portal_users WHERE id=?').get(userId);
    db.prepare(`
      INSERT INTO customer_portal_permission_audit (customer_id,target_portal_user_id,action,before_json,after_json)
      VALUES (?,?,?,?,?)
    `).run(customer.id, userId, existing ? 'update_portal_user' : 'create_portal_user', beforeJson, JSON.stringify({ user: afterRow, siteIds }));
    res.json({ success: true, id: userId });
  });

  router.get('/projects', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const { customer_id, status } = req.query;
    let sql = 'SELECT p.*,c.name as customer_name,COUNT(DISTINCT s.id) as site_count,COUNT(DISTINCT o.id) as order_count FROM projects p LEFT JOIN customers c ON p.customer_id=c.id LEFT JOIN sites s ON s.project_id=p.id LEFT JOIN orders o ON o.project_id=p.id WHERE 1=1';
    const params = [];
    if (customer_id) { sql+=' AND p.customer_id=?'; params.push(customer_id); }
    if (status)      { sql+=' AND p.status=?';      params.push(status); }
    sql+=' GROUP BY p.id ORDER BY p.created_at DESC';
    res.json(db.prepare(sql).all(...params));
  });
  router.get('/projects/:id', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const p = db.prepare('SELECT p.*,c.name as customer_name FROM projects p LEFT JOIN customers c ON p.customer_id=c.id WHERE p.id=?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'לא נמצא' });
    p.sites  = db.prepare('SELECT * FROM sites WHERE project_id=? ORDER BY name').all(p.id);
    p.orders = db.prepare('SELECT id,order_num,status,total_weight,created_at FROM orders WHERE project_id=? ORDER BY created_at DESC').all(p.id);
    res.json(p);
  });
  router.post('/projects', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.name) return res.status(400).json({ error: 'שם פרויקט חובה' });
    const r = db.prepare('INSERT INTO projects (customer_id,name,project_num,status,start_date,end_date,total_budget,contact_name,contact_phone,notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(f.customer_id||null,f.name,f.project_num||null,f.status||'פעיל',f.start_date||null,f.end_date||null,f.total_budget||0,f.contact_name||null,f.contact_phone||null,f.notes||null);
    res.json({ id: r.lastInsertRowid });
  });
  router.patch('/projects/:id', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare('UPDATE projects SET name=COALESCE(?,name),project_num=COALESCE(?,project_num),status=COALESCE(?,status),start_date=COALESCE(?,start_date),end_date=COALESCE(?,end_date),total_budget=COALESCE(?,total_budget),contact_name=COALESCE(?,contact_name),contact_phone=COALESCE(?,contact_phone),notes=COALESCE(?,notes) WHERE id=?')
      .run(f.name||null,f.project_num||null,f.status||null,f.start_date||null,f.end_date||null,f.total_budget||null,f.contact_name||null,f.contact_phone||null,f.notes||null,req.params.id);
    res.json({ success: true });
  });

  router.get('/sites', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const { project_id, customer_id } = req.query;
    let sql = 'SELECT s.*,p.name as project_name,c.name as customer_name FROM sites s LEFT JOIN projects p ON s.project_id=p.id LEFT JOIN customers c ON s.customer_id=c.id WHERE s.active=1';
    const params = [];
    if (project_id)  { sql+=' AND s.project_id=?';  params.push(project_id); }
    if (customer_id) { sql+=' AND s.customer_id=?'; params.push(customer_id); }
    sql+=' ORDER BY s.name';
    res.json(db.prepare(sql).all(...params));
  });
  router.post('/sites', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.name) return res.status(400).json({ error: 'שם אתר חובה' });
    const r = db.prepare('INSERT INTO sites (project_id,customer_id,name,address,lat,lng,contact_name,contact_phone,access_notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(f.project_id||null,f.customer_id||null,f.name,f.address||null,f.lat||null,f.lng||null,f.contact_name||null,f.contact_phone||null,f.access_notes||null);
    res.json({ id: r.lastInsertRowid });
  });
  router.patch('/sites/:id', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare('UPDATE sites SET name=COALESCE(?,name),address=COALESCE(?,address),lat=COALESCE(?,lat),lng=COALESCE(?,lng),contact_name=COALESCE(?,contact_name),contact_phone=COALESCE(?,contact_phone),access_notes=COALESCE(?,access_notes),active=COALESCE(?,active) WHERE id=?')
      .run(f.name||null,f.address||null,f.lat||null,f.lng||null,f.contact_name||null,f.contact_phone||null,f.access_notes||null,f.active??null,req.params.id);
    res.json({ success: true });
  });

  return router;
};

module.exports.manifest = {
  id: 'customers',
  label: 'לקוחות',
  screens: [
    { id: 'customers', path: '/customers.html', label: 'לקוחות', icon: '👥', group: 'ראשי' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'edit', finance: 'read', sales: 'read' },
  },
  consumes: [
    { table: 'customers' },
    { table: 'projects' },
    { table: 'sites' },
    { table: 'customer_sites' },
    { table: 'portal_users' },
    { table: 'customer_site_users' },
  ],
  produces: [],
};
