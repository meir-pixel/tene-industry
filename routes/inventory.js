const router = require('express').Router();

const {
  MATERIAL_TYPES,
  bendingShapeColumns,
  normalizeReceiptReviewItem,
  parseReceiptReviewPayload,
} = require('../services/inventory');

function required(name, value) {
  if (!value) throw new Error(`routes/inventory missing dependency: ${name}`);
  return value;
}

module.exports = function createInventoryRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const auditLog = required('auditLog', deps.auditLog);
  const listPage = required('listPage', deps.listPage);



  router.get('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { diameter, supplier_id } = req.query;
    const page = listPage(req.query, { limit: 200, max: 1000 });
    let sql = 'SELECT r.*,s.name as supplier_name,ROUND(r.weight_received-r.weight_used-r.weight_scrapped,2) as weight_available FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id WHERE r.active=1';
    const params = [];
    if (diameter) { sql += ' AND r.diameter=?'; params.push(diameter); }
    if (supplier_id) { sql += ' AND r.supplier_id=?'; params.push(supplier_id); }
    sql += ' ORDER BY r.received_date DESC, r.id DESC LIMIT ? OFFSET ?';
    params.push(page.limit, page.offset);
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/inventory/summary', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT diameter,SUM(weight_received) as total_received,SUM(weight_used) as total_used,SUM(weight_scrapped) as total_scrapped,ROUND(SUM(weight_received-weight_used-weight_scrapped),2) as available,COUNT(*) as batches FROM raw_material WHERE active=1 GROUP BY diameter ORDER BY diameter').all());
  });

  router.get('/inventory/receipt-reviews', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status || 'pending_review';
    const rows = db.prepare(`
      SELECT rr.*, s.name AS supplier_master_name
      FROM inventory_receipt_reviews rr
      LEFT JOIN suppliers s ON s.id=rr.supplier_id
      WHERE rr.status=?
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT 100
    `).all(status);
    res.json(rows);
  });

  router.post('/inventory/receipt-reviews/:id/approve', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    if (review.status !== 'pending_review') return res.status(409).json({ error: 'review is not pending', status: review.status });
    const parsed = parseReceiptReviewPayload(JSON.parse(review.parsed_data || '{}'));
    const ids = [];
    const insert = db.prepare(`
      INSERT INTO raw_material
        (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      for (const rawItem of parsed.items) {
        const item = normalizeReceiptReviewItem({ ...rawItem, supplier_id: rawItem.supplier_id || review.supplier_id });
        if (!item.diameter || !item.weight_received) throw new Error('diameter and weight are required for every approved receipt row');
        if (item.material_type === 'bent' && (!item.bending_shape_name || !item.bending_shape_segments)) {
          throw new Error('bending shape is required for bent material receipt rows');
        }
        const result = insert.run(item.material_type, item.diameter, item.supplier_id, item.lot_number, item.certificate_num, item.grade,
          item.received_date || parsed.received_date || new Date().toISOString().slice(0, 10), item.weight_received, item.purchase_price,
          item.warehouse_loc, item.bending_shape_name, item.bending_shape_segments, item.bending_shape_source, item.bending_shape_confidence,
          item.notes || parsed.notes || null);
        ids.push(result.lastInsertRowid);
      }
      db.prepare(`
        UPDATE inventory_receipt_reviews
        SET status='approved', raw_material_ids=?, reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(JSON.stringify(ids), req.auth?.sub || null, req.body?.notes || null, review.id);
    });
    try {
      tx();
      auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'approve', 'status', 'pending_review', 'approved', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
      wsBroadcast('inventory_receipt_review_approved', { id: review.id, raw_material_ids: ids });
      res.json({ success: true, raw_material_ids: ids });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/inventory/receipt-reviews/:id/reject', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    db.prepare(`
      UPDATE inventory_receipt_reviews
      SET status='rejected', reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.auth?.sub || null, req.body?.notes || null, req.params.id);
    auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'reject', 'status', review.status, 'rejected', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('inventory_receipt_review_rejected', { id: review.id });
    res.json({ success: true });
  });

  router.post('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.diameter || !f.weight_received) return res.status(400).json({ error: 'קוטר ומשקל חובה' });
    const materialType = MATERIAL_TYPES.has(f.material_type) ? f.material_type : 'coil';
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    const r = db.prepare('INSERT INTO raw_material (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(materialType, f.diameter, f.supplier_id || null, f.lot_number || null, f.certificate_num || null, f.grade || 'B500B', f.received_date || new Date().toISOString().split('T')[0], f.weight_received, f.purchase_price || 0, f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/inventory/:id', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    const materialType = f.material_type && MATERIAL_TYPES.has(f.material_type) ? f.material_type : null;
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    db.prepare(`UPDATE raw_material SET
      material_type=COALESCE(?,material_type),
      diameter=COALESCE(?,diameter),
      supplier_id=COALESCE(?,supplier_id),
      lot_number=COALESCE(?,lot_number),
      certificate_num=COALESCE(?,certificate_num),
      grade=COALESCE(?,grade),
      received_date=COALESCE(?,received_date),
      weight_received=COALESCE(?,weight_received),
      weight_used=COALESCE(?,weight_used),
      weight_scrapped=COALESCE(?,weight_scrapped),
      purchase_price=COALESCE(?,purchase_price),
      warehouse_loc=COALESCE(?,warehouse_loc),
      bending_shape_name=?,
      bending_shape_segments=?,
      bending_shape_source=?,
      bending_shape_confidence=?,
      notes=COALESCE(?,notes),
      active=COALESCE(?,active)
      WHERE id=?`)
      .run(materialType, f.diameter ?? null, f.supplier_id || null, f.lot_number || null, f.certificate_num || null, f.grade || null, f.received_date || null, f.weight_received ?? null, f.weight_used ?? null, f.weight_scrapped ?? null, f.purchase_price ?? null, f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null, f.active ?? null, req.params.id);
    res.json({ success: true });
  });

  router.get('/inventory/forecast', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const consumption = db.prepare(`
      SELECT i.diameter,
             COALESCE(SUM(i.total_weight),0) / 30 as avg_daily_kg
      FROM items i
      JOIN pallets p ON i.pallet_id=p.id
      JOIN orders o ON p.order_id=o.id
      WHERE DATE(o.created_at) >= DATE('now','-30 days')
      AND i.status='הושלם'
      GROUP BY i.diameter
    `).all();

    const stock = db.prepare(`
      SELECT diameter,
             COALESCE(SUM(weight_received-weight_used-weight_scrapped),0) as on_hand_kg
      FROM raw_material WHERE active=1
      GROUP BY diameter
    `).all();

    const stockMap = {};
    for (const s of stock) stockMap[s.diameter] = s.on_hand_kg;

    const forecast = consumption.map(row => {
      const on_hand = stockMap[row.diameter] || 0;
      const days_left = row.avg_daily_kg > 0 ? Math.floor(on_hand / row.avg_daily_kg) : 999;
      return {
        diameter: row.diameter,
        on_hand_kg: Math.round(on_hand),
        avg_daily_kg: Math.round(row.avg_daily_kg),
        days_left,
        alert: days_left <= 3 ? 'critical' : days_left <= 7 ? 'warning' : 'ok',
      };
    });

    for (const [diam, kg] of Object.entries(stockMap)) {
      if (!forecast.find(f => f.diameter == diam)) {
        forecast.push({ diameter: Number(diam), on_hand_kg: Math.round(kg), avg_daily_kg: 0, days_left: 999, alert: 'ok' });
      }
    }
    forecast.sort((a, b) => a.days_left - b.days_left);
    res.json(forecast);
  });



  return router;
};

module.exports.manifest = {
  id: 'inventory',
  label: 'מלאי',
  screens: [
    { id: 'inventory', path: '/inventory.html', label: 'מלאי', icon: '🗄️', group: 'תפעול' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'read', production: 'read', warehouse: 'edit' },
  },
  consumes: [{ table: 'raw_materials' }, { table: 'inventory_receipt_reviews' }],
  produces: [
    { event: 'inventory_receipt_review_approved' },
    { event: 'inventory_receipt_review_rejected' },
  ],
};
