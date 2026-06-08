const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/warehouse missing dependency: ${name}`);
  return value;
}

module.exports = function createWarehouseRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  router.get('/packages', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { order_id, status, zone } = req.query;
    let q = `SELECT pk.*, u.display_name as packed_by_name, c.name as customer_name
             FROM packages pk
             LEFT JOIN orders o ON pk.order_id=o.id
             LEFT JOIN customers c ON o.customer_id=c.id
             LEFT JOIN users u ON pk.packed_by=u.id`;
    const wheres = [], params = [];
    if (order_id) { wheres.push('pk.order_id=?'); params.push(order_id); }
    if (status) { wheres.push('pk.status=?'); params.push(status); }
    if (zone) { wheres.push('pk.zone=?'); params.push(zone); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY pk.packed_at DESC LIMIT 200';
    res.json(db.prepare(q).all(...params));
  });

  router.post('/packages', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { order_id, order_num, item_ids, quantity, weight, diameter, zone, packed_by } = req.body;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = (db.prepare('SELECT COUNT(*)+1 as n FROM packages WHERE package_code LIKE ?').get('PKG-' + dateStr + '%').n || 1);
    const package_code = `PKG-${dateStr}-${String(seq).padStart(3, '0')}`;
    const qr_data = JSON.stringify({ code: package_code, order_num, diameter });
    const r = db.prepare(`INSERT INTO packages (package_code,qr_data,order_id,order_num,item_ids,quantity,weight,diameter,zone,packed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(package_code, qr_data, order_id || null, order_num || null, JSON.stringify(item_ids || []), quantity || 0, weight || 0, diameter || null, zone || null, packed_by || null);
    if (item_ids && item_ids.length) {
      const upd = db.prepare('UPDATE items SET package_id=?, zone=? WHERE id=?');
      for (const iid of item_ids) upd.run(r.lastInsertRowid, zone || null, iid);
    }
    res.json({ id: r.lastInsertRowid, package_code });
  });

  router.patch('/packages/:id/ship', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    db.prepare('UPDATE packages SET status=?,shipped_at=CURRENT_TIMESTAMP WHERE id=?')
      .run('shipped', req.params.id);
    res.json({ ok: true });
  });

  router.get('/delivery-notes', requireAnyRole(['driver', 'warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { order_id } = req.query;
    const rows = order_id
      ? db.prepare('SELECT * FROM delivery_notes WHERE order_id=? ORDER BY issued_at DESC').all(order_id)
      : db.prepare('SELECT * FROM delivery_notes ORDER BY issued_at DESC LIMIT 50').all();
    res.json(rows);
  });

  router.post('/delivery-notes', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { order_id, order_num, delivery_id, customer_id, packages_json, items_json, total_weight, driver_id } = req.body;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = (db.prepare('SELECT COUNT(*)+1 as n FROM delivery_notes WHERE note_num LIKE ?').get('DN-' + dateStr + '%').n || 1);
    const note_num = `DN-${dateStr}-${String(seq).padStart(3, '0')}`;
    const r = db.prepare(`INSERT INTO delivery_notes (note_num,order_id,order_num,delivery_id,customer_id,packages_json,items_json,total_weight,driver_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(note_num, order_id || null, order_num || null, delivery_id || null, customer_id || null,
        JSON.stringify(packages_json || []), JSON.stringify(items_json || []), total_weight || 0, driver_id || null);
    res.json({ id: r.lastInsertRowid, note_num });
  });

  return router;
};

module.exports.manifest = {
  "id": "warehouse",
  "label": "Warehouse",
  "consumes": [
    {
      "table": "packages"
    },
    {
      "table": "delivery_notes"
    }
  ],
  "produces": []
};
