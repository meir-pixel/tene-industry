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
  consumes: [{ table: 'customers' }, { table: 'orders' }, { table: 'items' }],
  produces: [
    { event: 'new_order' },
    { event: 'order_status' },
    { event: 'machine_assign' },
  ],
};
