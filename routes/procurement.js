const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/procurement missing dependency: ${name}`);
  return value;
}

module.exports = function createProcurementRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  router.get('/suppliers', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name').all());
  });

  router.post('/suppliers', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { name, phone, contact, email, address, payment_terms, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'supplier name is required' });
    const r = db.prepare('INSERT INTO suppliers (name,phone,contact,email,address,payment_terms,notes) VALUES (?,?,?,?,?,?,?)')
      .run(name, phone || null, contact || null, email || null, address || null, payment_terms || null, notes || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/suppliers/:id', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare('UPDATE suppliers SET name=COALESCE(?,name),phone=COALESCE(?,phone),contact=COALESCE(?,contact),email=COALESCE(?,email),address=COALESCE(?,address),payment_terms=COALESCE(?,payment_terms),notes=COALESCE(?,notes),active=COALESCE(?,active) WHERE id=?')
      .run(f.name || null, f.phone || null, f.contact || null, f.email || null, f.address || null, f.payment_terms || null, f.notes || null, f.active ?? null, req.params.id);
    res.json({ success: true });
  });

  router.get('/steel-prices', requireAnyRole(['office', 'sales', 'finance', 'manager', 'admin']), (req, res) => {
    const { diameter } = req.query;
    const q = `SELECT sph.*, s.name as supplier_name FROM steel_price_history sph
             LEFT JOIN suppliers s ON sph.supplier_id=s.id`;
    if (diameter) {
      res.json(db.prepare(q + ' WHERE sph.diameter=? ORDER BY sph.effective_date DESC LIMIT 50').all(diameter));
    } else {
      res.json(db.prepare(`SELECT sph.*, s.name as supplier_name
        FROM steel_price_history sph LEFT JOIN suppliers s ON sph.supplier_id=s.id
        WHERE sph.id IN (
          SELECT MAX(id) FROM steel_price_history GROUP BY diameter
        ) ORDER BY sph.diameter`).all());
    }
  });

  router.post('/steel-prices', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const { diameter, price_per_ton, supplier_id, effective_date, notes, created_by } = req.body;
    const r = db.prepare('INSERT INTO steel_price_history (diameter,price_per_ton,supplier_id,effective_date,notes,created_by) VALUES (?,?,?,?,?,?)')
      .run(diameter, price_per_ton, supplier_id || null, effective_date || new Date().toISOString().slice(0, 10), notes || null, created_by || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.get('/purchase-orders', requireAnyRole(['warehouse', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare(`
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.created_at DESC
    `).all());
  });

  router.post('/purchase-orders', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const seq = db.prepare('SELECT COUNT(*)+1 as n FROM purchase_orders').get().n;
    const num = 'PO-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
    const { supplier_id, diameter, material_type, quantity_ton, price_per_ton, expected_date, notes, created_by, status } = req.body;
    const total = (quantity_ton || 0) * (price_per_ton || 0);
    const r = db.prepare(`
      INSERT INTO purchase_orders
        (po_num,supplier_id,diameter,material_type,quantity_ton,price_per_ton,total_amount,expected_date,status,notes,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(num, supplier_id || null, diameter || null, material_type || 'coil',
      quantity_ton || 0, price_per_ton || 0, total,
      expected_date || '', status || 'pending', notes || '', created_by || '');
    res.json({ id: r.lastInsertRowid, po_num: num });
  });

  router.patch('/purchase-orders/:id', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare(`
      UPDATE purchase_orders
      SET status      = COALESCE(?, status),
          approved_by = COALESCE(?, approved_by)
      WHERE id = ?
    `).run(f.status || null, f.approved_by || null, req.params.id);
    res.json({ ok: true });
  });

  router.patch('/purchase-orders/:id/receive', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { heat_number, certificate_num, received_weight, notes } = req.body;
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(req.params.id);
    if (!po) return res.status(404).json({ error: 'not found' });
    const actualWeight = received_weight || (po.quantity_ton * 1000);
    db.prepare(`
      UPDATE purchase_orders
      SET status='הגיע', heat_number=?, certificate_num=?, received_weight=?, received_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(heat_number || '', certificate_num || '', actualWeight, req.params.id);
    if (po.supplier_id && po.diameter) {
      db.prepare(`
        INSERT INTO raw_material
          (material_type,diameter,supplier_id,lot_number,certificate_num,received_date,weight_received,purchase_price,notes)
        VALUES (?,?,?,?,?,date('now'),?,?,?)
      `).run(po.material_type || 'coil', po.diameter, po.supplier_id,
        heat_number || '', certificate_num || '',
        actualWeight, po.price_per_ton || 0, notes || '');
    }
    res.json({ ok: true });
  });

  return router;
};

module.exports.manifest = {
  id: 'procurement',
  label: 'רכש',
  screens: [
    { id: 'procurement', path: '/procurement.html', label: 'רכש', icon: '🛒', group: 'תפעול' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'edit', warehouse: 'read' },
  },
  consumes: [{ table: 'suppliers' }, { table: 'purchase_orders' }, { table: 'steel_price_history' }],
  produces: [],
};
