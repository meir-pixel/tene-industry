const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/orders missing dependency: ${name}`);
  return value;
}

module.exports = function createOrdersRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const requireRole = required('requireRole', deps.requireRole);
  const upload = required('upload', deps.upload);
  const modbus = required('modbus', deps.modbus);
  const intake = required('intake', deps.intake);
  const listPage = required('listPage', deps.listPage);
  const industry = required('industry', deps.industry);
  const normalizeOrderStatus = required('normalizeOrderStatus', deps.normalizeOrderStatus);
  const isValidOrderTransition = required('isValidOrderTransition', deps.isValidOrderTransition);
  const allowedOrderTransitions = required('allowedOrderTransitions', deps.allowedOrderTransitions);
  const createOrderFromPayload = required('createOrderFromPayload', deps.createOrderFromPayload);
  const createOrderTransaction = required('createOrderTransaction', deps.createOrderTransaction);
  const buildOrderImportPreview = required('buildOrderImportPreview', deps.buildOrderImportPreview);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const auditLog = required('auditLog', deps.auditLog);

  router.get('/orders', requireAnyRole(['office', 'production', 'sales', 'manager', 'admin']), (req, res) => {
    const { status, date, priority } = req.query;
    const page = listPage(req.query, { limit: 100, max: 500 });
    let sql = `SELECT o.*, c.name as customer_name, c.phone as customer_phone
               FROM orders o LEFT JOIN customers c ON o.customer_id = c.id`;
    const params = [];
    const where = [];
    if (status) { where.push('o.status = ?'); params.push(normalizeOrderStatus(status)); }
    if (date) { where.push('DATE(o.delivery_date)=?'); params.push(date); }
    if (priority) { where.push('o.priority = ?'); params.push(priority); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(page.limit, page.offset);
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/orders/:id', requireAnyRole(['office', 'production', 'sales', 'manager', 'admin']), (req, res) => {
    const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone
      FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
    pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
    order.pallets = pallets;
    res.json(order);
  });

  router.get('/orders/:id/intake-source', requireAnyRole(['office', 'production', 'sales', 'manager', 'admin']), (req, res) => {
    const row = db.prepare(`
      SELECT il.*, o.order_num, c.name AS customer_name
      FROM intake_log il
      JOIN orders o ON o.id = il.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE il.order_id = ?
      ORDER BY il.created_at DESC
      LIMIT 1
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'intake source not found' });
    let parsed = {};
    try { parsed = JSON.parse(row.parsed_data || '{}'); } catch {}
    res.json({ ...row, parsed });
  });

  router.post('/orders/manual', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { machineId, diameter, qty, totalLengthMm, shape, note } = req.body;
    if (!machineId || !diameter || !qty || !totalLengthMm) {
      return res.status(400).json({ error: 'חסרים פרמטרים' });
    }
    const orderNum = 'MAN-' + Date.now().toString(36).toUpperCase();
    const totalWeight = industry.weightPerUnit({ diameter, total_length_mm: totalLengthMm }) * qty;

    const orderRow = db.prepare(
      `INSERT INTO orders (order_num,channel,delivery_date,delivery_address,priority,general_notes,total_weight,waste_pct_charged,billing_weight,created_by)
       VALUES (?,?,date('now'),?,?,?,?,3,?,?)`
    ).run(orderNum, 'ידני', 'מפעל', note || 'עבודה ידנית', 'רגיל', totalWeight, totalWeight * 1.03, null);

    const orderId = orderRow.lastInsertRowid;
    const palletRow = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,1,9999,?)').run(orderId, totalWeight);
    const palletId = palletRow.lastInsertRowid;

    const segments = JSON.stringify([{ length_mm: totalLengthMm, angle_deg: 0 }]);
    const itemRow = db.prepare(
      `INSERT INTO items (pallet_id,order_id,shape_id,shape_name,diameter,quantity,production_qty,segments,total_length_mm,weight_per_unit,status,machine_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(palletId, orderId, shape || 'straight', shape || 'ישר', diameter, qty, qty, segments, totalLengthMm, totalWeight / qty, 'בייצור', machineId);

    const itemId = itemRow.lastInsertRowid;
    db.prepare('UPDATE machines SET current_item_id=?,current_order_num=?,status=? WHERE id=?')
      .run(itemId, orderNum, 'בייצור', machineId);
    db.prepare('UPDATE items SET started_at=? WHERE id=?').run(new Date().toISOString(), itemId);

    const machineState = modbus.getState(machineId);
    if (machineState) {
      modbus.writeParams(machineId, { diameter, totalLengthMm, productionQty: qty, angles: [] }).catch(() => {});
    }
    wsBroadcast('machine_assign', { machineId: Number(machineId), itemId, orderNum });
    res.json({ success: true, orderNum, itemId });
  });

  router.post('/order-imports/preview', requireAnyRole(['office', 'manager', 'admin']), upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Spreadsheet file is required' });
    try {
      const preview = buildOrderImportPreview(req.file.buffer);
      const result = db.prepare('INSERT INTO order_imports (filename,preview_data,status) VALUES (?,?,?)')
        .run(req.file.originalname || 'orders.xlsx', JSON.stringify(preview), 'preview');
      res.json({ success: true, importId: result.lastInsertRowid, preview });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.post('/order-imports/:id/approve', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare('SELECT * FROM order_imports WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Import preview not found' });
    if (row.status === 'approved') return res.json({ success: true, alreadyApproved: true });
    try {
      const preview = JSON.parse(row.preview_data || '{}');
      if (preview.errors?.length) throw Object.assign(new Error('Resolve spreadsheet validation errors before approval'), { statusCode: 400 });
      if (preview.orders?.some(order => order.duplicate)) {
        throw Object.assign(new Error('Resolve duplicate order numbers before approval'), { statusCode: 409 });
      }
      const approve = db.transaction(() => {
        const created = (preview.orders || []).map(order => createOrderFromPayload(order.payload));
        db.prepare("UPDATE order_imports SET status='approved',approved_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        return created;
      });
      const created = approve();
      created.forEach(order => wsBroadcast('new_order', { orderNum: order.orderNum, orderId: order.orderId }));
      res.json({ success: true, created });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.post('/orders', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    try {
      const result = createOrderTransaction(req.body);
      wsBroadcast('new_order', { orderNum: result.orderNum, orderId: result.orderId });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.patch('/orders/:id/status', requireAnyRole(['office', 'production', 'manager', 'admin']), (req, res) => {
    const { status, userId, userName } = req.body;
    if (!status) return res.status(400).json({ error: 'חסר סטטוס' });
    const requestedStatus = normalizeOrderStatus(status);
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    if (order.locked) return res.status(403).json({ error: 'הזמנה נעולה' });
    if (!isValidOrderTransition(order.status, requestedStatus)) {
      return res.status(409).json({
        error: 'מעבר סטטוס לא חוקי',
        from: order.status,
        to: requestedStatus,
        allowed: allowedOrderTransitions(order.status),
      });
    }
    const old = order.status;
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(requestedStatus, order.id);
    auditLog('order', order.id, order.order_num, 'status_change', 'status', old, requestedStatus, null, userId, userName);
    wsBroadcast('order_status', { id: order.id, status: requestedStatus, orderNum: order.order_num });
    if (order.customer_id) {
      const c = db.prepare('SELECT phone FROM customers WHERE id=?').get(order.customer_id);
      if (c?.phone) intake.notifyOrderStatus(c.phone, order.order_num, requestedStatus).catch(() => {});
    }
    res.json({ success: true });
  });

  router.patch('/orders/:orderId/items/:itemId', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, p.order_id, o.order_num
      FROM items i
      JOIN pallets p ON p.id = i.pallet_id
      JOIN orders o ON o.id = p.order_id
      WHERE i.id=? AND p.order_id=?
    `).get(req.params.itemId, req.params.orderId);
    if (!item) return res.status(404).json({ error: 'item not found' });

    let segments = item.segments;
    if (req.body.segments !== undefined) {
      if (!Array.isArray(req.body.segments)) return res.status(400).json({ error: 'segments must be an array' });
      const clean = [];
      for (const [index, segment] of req.body.segments.entries()) {
        const length = Number(segment?.length_mm ?? segment?.length);
        const angle = Number(segment?.angle_deg ?? segment?.angle ?? 180);
        if (!Number.isFinite(length) || length < 0) return res.status(400).json({ error: `invalid segment length at ${index + 1}` });
        if (!Number.isFinite(angle) || angle < 0 || angle > 180) return res.status(400).json({ error: `invalid segment angle at ${index + 1}` });
        clean.push({ length_mm: length, angle_deg: angle });
      }
      segments = JSON.stringify(clean);
    }

    const shapeName = req.body.shape_name !== undefined ? String(req.body.shape_name || '').trim() : item.shape_name;
    const diameter = req.body.diameter !== undefined ? Number(req.body.diameter) : Number(item.diameter);
    const quantity = req.body.quantity !== undefined ? Number(req.body.quantity) : Number(item.quantity);
    const totalLengthMm = req.body.total_length_mm !== undefined
      ? Number(req.body.total_length_mm)
      : (Array.isArray(req.body.segments)
        ? req.body.segments.reduce((sum, segment) => sum + Number(segment?.length_mm ?? segment?.length ?? 0), 0)
        : Number(item.total_length_mm));
    const spiralDiameter = req.body.spiral_diameter_mm !== undefined ? Number(req.body.spiral_diameter_mm) : item.spiral_diameter_mm;
    const spiralTurns = req.body.spiral_turns !== undefined ? Number(req.body.spiral_turns) : item.spiral_turns;
    const note = req.body.note !== undefined ? String(req.body.note || '') : item.note;

    if (!shapeName) return res.status(400).json({ error: 'shape_name is required' });
    if (!Number.isFinite(diameter) || diameter <= 0) return res.status(400).json({ error: 'invalid diameter' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'invalid quantity' });
    if (!Number.isFinite(totalLengthMm) || totalLengthMm < 0) return res.status(400).json({ error: 'invalid total_length_mm' });

    const weightPerUnit = industry.weightPerUnit({ diameter, total_length_mm: totalLengthMm });
    const totalWeight = weightPerUnit * quantity;
    const before = JSON.stringify({
      shape_name: item.shape_name,
      diameter: item.diameter,
      quantity: item.quantity,
      total_length_mm: item.total_length_mm,
      segments: item.segments,
    });
    db.prepare(`
      UPDATE items
      SET shape_name=?, diameter=?, quantity=?, production_qty=?, total_length_mm=?,
          segments=?, spiral_diameter_mm=?, spiral_turns=?, weight_per_unit=?, total_weight=?,
          note=?, review_status='pending', reviewed_by=NULL, reviewed_at=NULL
      WHERE id=?
    `).run(shapeName, diameter, quantity, quantity, totalLengthMm, segments, spiralDiameter || null, spiralTurns || null, weightPerUnit, totalWeight, note, item.id);

    const orderTotal = db.prepare(`
      SELECT COALESCE(SUM(i.total_weight),0) AS total_weight
      FROM items i JOIN pallets p ON p.id=i.pallet_id
      WHERE p.order_id=?
    `).get(req.params.orderId).total_weight || 0;
    db.prepare('UPDATE orders SET total_weight=?, billing_weight=? WHERE id=?').run(orderTotal, orderTotal * 1.03, req.params.orderId);
    db.prepare(`
      UPDATE pallets
      SET total_weight=(SELECT COALESCE(SUM(total_weight),0) FROM items WHERE pallet_id=pallets.id)
      WHERE order_id=?
    `).run(req.params.orderId);

    auditLog('item', item.id, item.order_num, 'item_update', 'shape_payload', before, JSON.stringify(req.body), note || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('order_item_updated', { orderId: Number(req.params.orderId), itemId: Number(item.id), orderNum: item.order_num });
    res.json({ success: true, itemId: Number(item.id), total_weight: totalWeight, order_total_weight: orderTotal });
  });

  router.patch('/orders/:orderId/items/:itemId/review', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const status = String(req.body?.status || 'approved').trim();
    if (!['approved', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'invalid review status' });
    }
    const item = db.prepare('SELECT i.*, o.order_num FROM items i JOIN orders o ON o.id=i.order_id WHERE i.id=? AND i.order_id=?')
      .get(req.params.itemId, req.params.orderId);
    if (!item) return res.status(404).json({ error: 'item not found' });
    const reviewedAt = status === 'approved' ? new Date().toISOString() : null;
    const reviewedBy = status === 'approved' ? (req.auth?.sub || null) : null;
    db.prepare(`
      UPDATE items
      SET review_status=?, review_notes=?, reviewed_by=?, reviewed_at=?
      WHERE id=? AND order_id=?
    `).run(status, req.body?.notes || null, reviewedBy, reviewedAt, item.id, req.params.orderId);
    auditLog('item', item.id, item.order_num, 'review_status', 'review_status', item.review_status || null, status, req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('order_review', { orderId: Number(req.params.orderId), itemId: Number(item.id), status });
    res.json({ success: true, status, reviewed_at: reviewedAt });
  });

  router.patch('/orders/:id/lock', requireRole('manager'), (req, res) => {
    const { userId, userName } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    db.prepare('UPDATE orders SET locked=1,locked_by=?,locked_at=? WHERE id=?').run(userId || null, new Date().toISOString(), order.id);
    auditLog('order', order.id, order.order_num, 'lock', 'locked', '0', '1', 'נעילה לאחר שילוח', userId, userName);
    res.json({ success: true });
  });

  router.patch('/orders/:id/unlock', requireRole('manager'), (req, res) => {
    const { userId, userName } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    db.prepare('UPDATE orders SET locked=0,locked_by=NULL,locked_at=NULL WHERE id=?').run(order.id);
    auditLog('order', order.id, order.order_num, 'unlock', 'locked', '1', '0', 'פתיחת נעילה', userId, userName);
    res.json({ success: true });
  });

  return router;
};

module.exports.manifest = {
  id: 'orders',
  label: 'הזמנות',
  screens: [
    { id: 'orders',    path: '/orders.html', label: 'הזמנות',     icon: '📋', group: 'ראשי' },
    { id: 'new-order', path: '/index.html',  label: 'הזמנה חדשה', icon: '➕', group: 'ראשי' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'edit', finance: 'read', production: 'read', sales: 'read' },
  },
  consumes: [{ table: 'customers' }, { table: 'orders' }, { table: 'items' }],
  produces: [
    { event: 'new_order' },
    { event: 'order_status' },
    { event: 'order_review' },
    { event: 'order_item_updated' },
    { event: 'machine_assign' },
  ],
};
