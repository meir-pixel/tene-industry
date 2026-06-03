const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/customers missing dependency: ${name}`);
  return value;
}

module.exports = function createCustomersRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  router.get('/customers', requireAnyRole(['office', 'sales', 'manager', 'admin']), (req, res) => {
    const q = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    // BUG-26: no portal_token in list response
    const rows = db.prepare(`
      SELECT c.id,c.name,c.phone,c.email,c.address,c.contact_name,c.contact_phone,c.priority_id,c.notes,
             c.price_tier,c.discount_pct,
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
  const CUSTOMER_ADMIN_COLS = 'c.id,c.name,c.phone,c.email,c.address,c.contact_name,c.contact_phone,c.priority_id,c.notes,c.price_tier,c.discount_pct,COALESCE(cc.open_debt,0) AS balance,COALESCE(cc.credit_limit,0) AS credit_limit,c.created_at';
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
    res.json(c);
  });

  router.post('/customers', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'שם חובה' });
    const r = db.prepare(`INSERT INTO customers (name,phone,email,address,contact_name,contact_phone,priority_id,notes) VALUES (?,?,?,?,?,?,?,?)`)
      .run(name, phone, email, address, contactName, contactPhone, priorityId, notes);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/customers/:id', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
    db.prepare(`UPDATE customers SET name=?,phone=?,email=?,address=?,contact_name=?,contact_phone=?,priority_id=?,notes=? WHERE id=?`)
      .run(name, phone, email, address, contactName, contactPhone, priorityId, notes, req.params.id);
    res.json({ success: true });
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
