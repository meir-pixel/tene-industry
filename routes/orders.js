const router = require('express').Router();
const {
  assertOrderStatusTransition,
  buildOrderItemUid,
  shapeSnapshotJson,
  withShapeContractLegacyFields,
} = require('../services/orderContracts');
const {
  findSourceIdentityDuplicate,
  sourceIdentityConflictPayload,
  sourceIdentityFromRequest,
} = require('../services/importSourceIdentity');
const { ORDER_STATUS } = require('../status-contracts');

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
  const productionCards = deps.productionCards || require('../services/productionCards');

  function cleanItemPayload(body, existingItem = {}) {
    body = withShapeContractLegacyFields(body || {});
    let segments = existingItem.segments || '[]';
    if (body.segments !== undefined) {
      if (!Array.isArray(body.segments)) throw Object.assign(new Error('segments must be an array'), { statusCode: 400 });
      const clean = [];
      for (const [index, segment] of body.segments.entries()) {
        const length = Number(segment?.length_mm ?? segment?.length);
        const angle = Number(segment?.angle_deg ?? segment?.angle ?? 180);
        if (!Number.isFinite(length) || length < 0) throw Object.assign(new Error(`invalid segment length at ${index + 1}`), { statusCode: 400 });
        if (!Number.isFinite(angle) || angle < 0 || angle > 180) throw Object.assign(new Error(`invalid segment angle at ${index + 1}`), { statusCode: 400 });
        clean.push({ length_mm: length, angle_deg: angle });
      }
      segments = JSON.stringify(clean);
    }

    const shapeName = body.shape_name !== undefined ? String(body.shape_name || '').trim() : existingItem.shape_name;
    const diameter = body.diameter !== undefined ? Number(body.diameter) : Number(existingItem.diameter);
    const quantity = body.quantity !== undefined ? Number(body.quantity) : Number(existingItem.quantity);
    const totalLengthMm = body.total_length_mm !== undefined
      ? Number(body.total_length_mm)
      : (Array.isArray(body.segments)
        ? body.segments.reduce((sum, segment) => sum + Number(segment?.length_mm ?? segment?.length ?? 0), 0)
        : Number(existingItem.total_length_mm));
    const spiralDiameter = body.spiral_diameter_mm !== undefined ? Number(body.spiral_diameter_mm) : existingItem.spiral_diameter_mm;
    const spiralTurns = body.spiral_turns !== undefined ? Number(body.spiral_turns) : existingItem.spiral_turns;
    const note = body.note !== undefined ? String(body.note || '') : (existingItem.note || '');

    if (!shapeName) throw Object.assign(new Error('shape_name is required'), { statusCode: 400 });
    if (!Number.isFinite(diameter) || diameter <= 0) throw Object.assign(new Error('invalid diameter'), { statusCode: 400 });
    if (!Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error('invalid quantity'), { statusCode: 400 });
    if (!Number.isFinite(totalLengthMm) || totalLengthMm < 0) throw Object.assign(new Error('invalid total_length_mm'), { statusCode: 400 });

    const weightPerUnit = industry.weightPerUnit({ diameter, total_length_mm: totalLengthMm });
    const totalWeight = weightPerUnit * quantity;
    return { shapeName, diameter, quantity, totalLengthMm, segments, spiralDiameter, spiralTurns, note, weightPerUnit, totalWeight };
  }

  function recalcOrderWeights(orderId) {
    const orderTotal = db.prepare(`
      SELECT COALESCE(SUM(i.total_weight),0) AS total_weight
      FROM items i JOIN pallets p ON p.id=i.pallet_id
      WHERE p.order_id=?
    `).get(orderId).total_weight || 0;
    db.prepare('UPDATE orders SET total_weight=?, billing_weight=? WHERE id=?').run(orderTotal, orderTotal * 1.03, orderId);
    db.prepare(`
      UPDATE pallets
      SET total_weight=(SELECT COALESCE(SUM(total_weight),0) FROM items WHERE pallet_id=pallets.id)
      WHERE order_id=?
    `).run(orderId);
    return orderTotal;
  }

  function firstOrCreatePallet(orderId) {
    const existing = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num LIMIT 1').get(orderId);
    if (existing) return existing;
    const next = db.prepare('SELECT COALESCE(MAX(pallet_num),0)+1 AS pallet_num FROM pallets WHERE order_id=?').get(orderId).pallet_num || 1;
    const result = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,?,?,0)').run(orderId, next, 500);
    return { id: result.lastInsertRowid, order_id: Number(orderId), pallet_num: next };
  }
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
    pallets.forEach(p => {
      p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id);
      p.items.forEach(item => { item.shape_svg = productionCards.itemShapeSvg(item); });
    });
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
      const identity = sourceIdentityFromRequest(req, 'order_import');
      const duplicate = findSourceIdentityDuplicate(db, 'order_imports', identity);
      if (duplicate) return res.status(409).json(sourceIdentityConflictPayload('order_import', duplicate));
      const preview = buildOrderImportPreview(req.file.buffer, { sourceIdentity: identity });
      if (identity) preview.source_identity = identity;
      const result = db.prepare('INSERT INTO order_imports (filename,source_system,external_id,preview_data,status) VALUES (?,?,?,?,?)')
        .run(req.file.originalname || 'orders.xlsx', identity?.source_system || null, identity?.external_id || null, JSON.stringify(preview), 'preview');
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
        const orderIds = JSON.stringify(created.map(order => order.orderId).filter(Boolean));
        db.prepare("UPDATE order_imports SET status='approved',approved_at=CURRENT_TIMESTAMP,order_ids_json=? WHERE id=?").run(orderIds, row.id);
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
    let transition;
    try {
      transition = assertOrderStatusTransition({ from: order.status, to: requestedStatus, role: req.userRole });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        error: error.message,
        from: error.from || order.status,
        to: error.to || requestedStatus,
        allowed: error.allowed || allowedOrderTransitions(order.status),
      });
    }
    const old = order.status;
    const approvedAt = transition.isApproval ? new Date().toISOString() : null;
    db.prepare(
      'UPDATE orders SET status=?, stable_order_id=COALESCE(stable_order_id, order_num), approved_by=CASE WHEN ? THEN ? ELSE approved_by END, approved_at=CASE WHEN ? THEN ? ELSE approved_at END WHERE id=?'
    ).run(requestedStatus, transition.isApproval ? 1 : 0, req.userId || userId || null, transition.isApproval ? 1 : 0, approvedAt, order.id);
    auditLog('order', order.id, order.order_num, 'status_change', 'status', old, requestedStatus, null, req.userId || userId || null, req.auth?.display_name || userName || null);
    if (transition.isApproval) {
      auditLog('order', order.id, order.order_num, 'manager_approval', 'approved_by', null, req.userId || userId || null, null, req.userId || userId || null, req.auth?.display_name || userName || null);
    }
    wsBroadcast('order_status', { id: order.id, status: requestedStatus, orderNum: order.order_num });
    if (order.customer_id) {
      const c = db.prepare('SELECT phone FROM customers WHERE id=?').get(order.customer_id);
      if (c?.phone) intake.notifyOrderStatus(c.phone, order.order_num, requestedStatus).catch(() => {});
    }
    res.json({ success: true });
  });

  router.post('/orders/:orderId/items', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.locked) return res.status(403).json({ error: 'הזמנה נעולה' });

    try {
      const item = cleanItemPayload(req.body, { shape_name: '', diameter: 12, quantity: 1, total_length_mm: 0, segments: '[]' });
      const pallet = firstOrCreatePallet(order.id);
      const hasOrderIdColumn = db.prepare("PRAGMA table_info(items)").all().some(column => column.name === 'order_id');
      const shapeSnapshot = shapeSnapshotJson({ ...req.body, shapeId: item.shapeName, shapeName: item.shapeName, diameter: item.diameter, segments: item.segments, totalLengthMm: item.totalLengthMm, spiralDiameterMm: item.spiralDiameter || null, spiralTurns: item.spiralTurns || null });
      const columns = ['pallet_id', 'shape_snapshot_json', 'shape_id', 'shape_name', 'diameter', 'quantity', 'production_qty', 'segments', 'total_length_mm', 'weight_per_unit', 'total_weight', 'note', 'status', 'spiral_diameter_mm', 'spiral_turns', 'review_status'];
      const values = [pallet.id, shapeSnapshot, item.shapeName, item.shapeName, item.diameter, item.quantity, item.quantity, item.segments, item.totalLengthMm, item.weightPerUnit, item.totalWeight, item.note, 'ממתין', item.spiralDiameter || null, item.spiralTurns || null, 'pending'];
      if (hasOrderIdColumn) {
        columns.splice(1, 0, 'order_id');
        values.splice(1, 0, order.id);
      }
      const placeholders = columns.map(() => '?').join(',');
      const result = db.prepare(`INSERT INTO items (${columns.join(',')}) VALUES (${placeholders})`).run(...values);
      db.prepare('UPDATE items SET item_uid=COALESCE(item_uid, ?) WHERE id=?').run(buildOrderItemUid(order.id, result.lastInsertRowid), result.lastInsertRowid);
      const orderTotal = recalcOrderWeights(order.id);

      auditLog('item', result.lastInsertRowid, order.order_num, 'item_add', 'shape_payload', null, JSON.stringify(req.body), item.note || null, req.auth?.sub || null, req.auth?.display_name || null);
      wsBroadcast('order_item_added', { orderId: Number(order.id), itemId: Number(result.lastInsertRowid), orderNum: order.order_num });
      res.json({ success: true, itemId: Number(result.lastInsertRowid), total_weight: item.totalWeight, order_total_weight: orderTotal });
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
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

    let cleanItem;
    try {
      cleanItem = cleanItemPayload(req.body, item);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }
    const { shapeName, diameter, quantity, totalLengthMm, segments, spiralDiameter, spiralTurns, note, weightPerUnit, totalWeight } = cleanItem;
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
          item_uid=COALESCE(item_uid, ?), shape_snapshot_json=COALESCE(shape_snapshot_json, ?),
          note=?, review_status='pending', reviewed_by=NULL, reviewed_at=NULL
      WHERE id=?
    `).run(shapeName, diameter, quantity, quantity, totalLengthMm, segments, spiralDiameter || null, spiralTurns || null, weightPerUnit, totalWeight, buildOrderItemUid(req.params.orderId, item.id), shapeSnapshotJson({ ...req.body, shapeId: item.shape_id || shapeName, shapeName, diameter, segments, totalLengthMm, spiralDiameterMm: spiralDiameter || null, spiralTurns: spiralTurns || null }), note, item.id);

    const orderTotal = recalcOrderWeights(req.params.orderId);


    auditLog('item', item.id, item.order_num, 'item_update', 'shape_payload', before, JSON.stringify(req.body), note || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('order_item_updated', { orderId: Number(req.params.orderId), itemId: Number(item.id), orderNum: item.order_num });
    res.json({ success: true, itemId: Number(item.id), total_weight: totalWeight, order_total_weight: orderTotal });
  });

  router.delete('/orders/:orderId/items/:itemId', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const item = db.prepare(`
      SELECT i.*, p.order_id, o.order_num, o.locked
      FROM items i
      JOIN pallets p ON p.id = i.pallet_id
      JOIN orders o ON o.id = p.order_id
      WHERE i.id=? AND p.order_id=?
    `).get(req.params.itemId, req.params.orderId);
    if (!item) return res.status(404).json({ error: 'item not found' });
    if (item.locked) return res.status(403).json({ error: 'order is locked' });
    if (Number(item.produced_qty || 0) > 0) {
      return res.status(409).json({ error: 'cannot delete item after production started' });
    }

    const before = JSON.stringify({
      shape_name: item.shape_name,
      diameter: item.diameter,
      quantity: item.quantity,
      total_length_mm: item.total_length_mm,
      segments: item.segments,
    });
    db.prepare('DELETE FROM items WHERE id=?').run(item.id);
    db.prepare(`
      DELETE FROM pallets
      WHERE order_id=?
        AND NOT EXISTS (SELECT 1 FROM items WHERE items.pallet_id=pallets.id)
    `).run(req.params.orderId);
    const orderTotal = recalcOrderWeights(req.params.orderId);

    auditLog('item', item.id, item.order_num, 'item_delete', 'shape_payload', before, null, item.note || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('order_item_deleted', { orderId: Number(req.params.orderId), itemId: Number(item.id), orderNum: item.order_num });
    res.json({ success: true, itemId: Number(item.id), order_total_weight: orderTotal });
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

  function canDeleteOrder(order, role) {
    if (role === 'manager' || role === 'admin') return true;
    if (role !== 'office') return false;
    const status = normalizeOrderStatus(order.status);
    return [
      ORDER_STATUS.PENDING_APPROVAL,
      ORDER_STATUS.CUSTOMER_PENDING_APPROVAL,
      ORDER_STATUS.CANCELLED,
    ].includes(status);
  }

  router.delete('/orders/:id', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    if (order.locked) return res.status(403).json({ error: 'לא ניתן למחוק הזמנה נעולה' });
    const started = db.prepare(
      'SELECT COUNT(*) as c FROM items WHERE pallet_id IN (SELECT id FROM pallets WHERE order_id=?) AND produced_qty > 0'
    ).get(order.id);
    if (started.c > 0) return res.status(409).json({ error: 'לא ניתן למחוק הזמנה שהתחיל בה ייצור' });
    if (!canDeleteOrder(order, req.userRole)) {
      return res.status(403).json({ error: 'רק מנהל יכול למחוק הזמנה שכבר אושרה או התקדמה לייצור' });
    }

    const before = JSON.stringify({ order_num: order.order_num, status: order.status });
    db.transaction(() => {
      db.prepare('DELETE FROM production_card_weights WHERE order_id=?').run(order.id);
      db.prepare('DELETE FROM scan_log WHERE order_num=?').run(order.order_num);
      db.prepare('DELETE FROM items WHERE pallet_id IN (SELECT id FROM pallets WHERE order_id=?)').run(order.id);
      db.prepare('DELETE FROM pallets WHERE order_id=?').run(order.id);
      db.prepare('DELETE FROM orders WHERE id=?').run(order.id);
    })();

    auditLog('order', order.id, order.order_num, 'order_delete', 'status', before, null, 'מחיקת הזמנה', req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('order_deleted', { orderId: Number(order.id), orderNum: order.order_num });
    res.json({ success: true, orderNum: order.order_num });
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
    { event: 'order_item_added' },
    { event: 'order_item_deleted' },
    { event: 'order_deleted' },
    { event: 'machine_assign' },
  ],
};
