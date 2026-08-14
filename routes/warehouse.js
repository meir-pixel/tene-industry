const router = require('express').Router();
const { itemShapeMetrics } = require('../services/shapeSnapshot');
const { ORDER_STATUS, normalizeOrderStatus } = require('../status-contracts');

function required(name, value) {
  if (!value) throw new Error(`routes/warehouse missing dependency: ${name}`);
  return value;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function itemIdsList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(id => Number(id))
    .filter(id => Number.isInteger(id) && id > 0);
}

function placeholders(count) {
  return Array(count).fill('?').join(',');
}

function packageMetricsFromItems(db, itemIds) {
  const ids = itemIdsList(itemIds);
  if (!ids.length) return { itemIds: [], quantity: 0, weight: 0, diameter: null };

  const rows = db.prepare(`SELECT * FROM items WHERE id IN (${placeholders(ids.length)})`).all(...ids);
  const diameterSet = new Set();
  const totals = rows.reduce((acc, item) => {
    const metrics = itemShapeMetrics(item);
    const quantity = positiveNumberOrNull(metrics.quantity) || positiveNumberOrNull(item.quantity) || 0;
    const weight = positiveNumberOrNull(metrics.totalWeightKg) || positiveNumberOrNull(item.total_weight) || 0;
    const diameter = positiveNumberOrNull(item.diameter);
    if (diameter) diameterSet.add(String(diameter));
    acc.quantity += quantity;
    acc.weight += weight;
    return acc;
  }, { quantity: 0, weight: 0 });

  return {
    itemIds: ids,
    quantity: totals.quantity,
    weight: Math.round(totals.weight * 1000) / 1000,
    diameter: diameterSet.size === 1 ? Array.from(diameterSet)[0] : null,
  };
}

function deliveryNoteWeightFromPayload({ packagesJson = [], itemsJson = [] } = {}) {
  const packageWeight = Array.isArray(packagesJson)
    ? packagesJson.reduce((sum, pkg) => sum + (positiveNumberOrNull(pkg && pkg.weight) || 0), 0)
    : 0;
  if (packageWeight > 0) return Math.round(packageWeight * 1000) / 1000;

  const itemWeight = Array.isArray(itemsJson)
    ? itemsJson.reduce((sum, item) => {
        const metrics = itemShapeMetrics(item || {});
        return sum + (positiveNumberOrNull(metrics.totalWeightKg) || positiveNumberOrNull(item && item.total_weight) || 0);
      }, 0)
    : 0;
  return Math.round(itemWeight * 1000) / 1000;
}

function loadingSessionUid() {
  return `LOAD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

function loadingActorId(req) {
  const value = Number(req.userId);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function safeJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function scannedPackageCode(rawValue) {
  let value = String(rawValue == null ? '' : rawValue).trim();
  if (!value || value.length > 512) return '';

  // Package labels currently encode the package code directly.  Accept the
  // existing JSON `qr_data` form as well, without treating a production-card
  // QR as a package label.
  if (value.startsWith('{')) {
    try {
      const decoded = JSON.parse(value);
      value = String(decoded && (decoded.code || decoded.package_code) || '').trim();
    } catch (_) {
      return '';
    }
  }
  return value.toUpperCase();
}

function loadingSessionState(db, sessionUid) {
  const session = db.prepare(`
    SELECT id, session_uid, order_id, order_num, status, expected_count,
           expected_weight, started_by, started_at, completed_by, completed_at
    FROM order_loading_sessions WHERE session_uid=?
  `).get(sessionUid);
  if (!session) return null;

  const packages = db.prepare(`
    SELECT package_id, package_code, quantity, weight, state, loaded_by, loaded_at
    FROM order_loading_session_packages
    WHERE session_id=?
    ORDER BY id
  `).all(session.id);
  const loaded = packages.filter(row => row.state === 'loaded');
  const missing = packages.filter(row => row.state !== 'loaded');
  return {
    ...session,
    packages,
    loaded_count: loaded.length,
    loaded_weight: Math.round(loaded.reduce((sum, row) => sum + Number(row.weight || 0), 0) * 1000) / 1000,
    missing_count: missing.length,
    missing_weight: Math.round(missing.reduce((sum, row) => sum + Number(row.weight || 0), 0) * 1000) / 1000,
  };
}

function addLoadingEvent(db, { sessionId, type, packageId = null, scannedValue = null, actorId = null, details = {} }) {
  db.prepare(`
    INSERT INTO order_loading_events (session_id,event_type,package_id,scanned_value,actor_id,details_json)
    VALUES (?,?,?,?,?,?)
  `).run(sessionId, type, packageId, scannedValue, actorId, safeJson(details));
}

function addOrderLoadingStatusAudit(db, { order, from, to, actorId }) {
  db.prepare(`
    INSERT INTO audit_log (entity_type,entity_id,entity_ref,action,field_name,old_value,new_value,notes,user_id,user_name)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    'order',
    order.id,
    order.order_num,
    'status_change',
    'status',
    from,
    to,
    'תחילת העמסה מסשן מחסן',
    actorId,
    null,
  );
}

function eligibleOrderPackages(db, orderId) {
  return db.prepare(`
    SELECT id, package_code, item_ids, quantity, weight
    FROM packages
    WHERE order_id=? AND status IN ('packed','ready','staged')
    ORDER BY id
  `).all(orderId);
}

module.exports = function createWarehouseRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);

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
    const itemMetrics = packageMetricsFromItems(db, item_ids);
    const packageItemIds = itemMetrics.itemIds;
    const packageQuantity = itemMetrics.quantity || positiveNumberOrNull(quantity) || 0;
    const packageWeight = itemMetrics.weight || positiveNumberOrNull(weight) || 0;
    const packageDiameter = itemMetrics.diameter || diameter || null;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = (db.prepare('SELECT COUNT(*)+1 as n FROM packages WHERE package_code LIKE ?').get('PKG-' + dateStr + '%').n || 1);
    const package_code = `PKG-${dateStr}-${String(seq).padStart(3, '0')}`;
    const qr_data = JSON.stringify({ code: package_code, order_num, diameter: packageDiameter, weight: packageWeight });
    const r = db.prepare(`INSERT INTO packages (package_code,qr_data,order_id,order_num,item_ids,quantity,weight,diameter,zone,packed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(package_code, qr_data, order_id || null, order_num || null, JSON.stringify(packageItemIds), packageQuantity, packageWeight, packageDiameter, zone || null, packed_by || null);
    if (packageItemIds.length) {
      const upd = db.prepare('UPDATE items SET package_id=?, zone=? WHERE id=?');
      for (const iid of packageItemIds) upd.run(r.lastInsertRowid, zone || null, iid);
    }
    res.json({ id: r.lastInsertRowid, package_code, weight: packageWeight });
  });

  router.patch('/packages/:id/ship', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    db.prepare('UPDATE packages SET status=?,shipped_at=CURRENT_TIMESTAMP WHERE id=?')
      .run('shipped', req.params.id);
    res.json({ ok: true });
  });

  // ── ORDER LOADING BY THE QR PRINTED ON THE ORDER SHEET ─────────────
  // Production scans keep using their own worker-card flow.  This flow only
  // accepts physical package labels, so an item can later be split into
  // multiple packages without changing production-card semantics.
  router.get('/loading/orders/:orderId', requireAnyRole(['warehouse', 'manager', 'admin']), (req, res) => {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'invalid_order_id' });
    const order = db.prepare('SELECT id,order_num,status,total_weight FROM orders WHERE id=?').get(orderId);
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    const active = db.prepare(`SELECT session_uid FROM order_loading_sessions WHERE order_id=? AND status='active'`).get(orderId);
    const packages = eligibleOrderPackages(db, orderId);
    const orderStatus = normalizeOrderStatus(order.status);
    res.json({
      order: { id: order.id, order_num: order.order_num, status: order.status, total_weight: order.total_weight },
      active_session_uid: active?.session_uid || null,
      loading_available: Boolean(active) || orderStatus === ORDER_STATUS.DONE_WAITING_PICKUP || orderStatus === ORDER_STATUS.LOADING,
      loading_state: active ? 'active' : orderStatus === ORDER_STATUS.DONE_WAITING_PICKUP ? 'ready_to_start' : orderStatus === ORDER_STATUS.LOADING ? 'ready_to_resume' : 'not_ready',
      eligible_package_count: packages.length,
      eligible_package_weight: Math.round(packages.reduce((sum, row) => sum + Number(row.weight || 0), 0) * 1000) / 1000,
    });
  });

  router.post('/loading/sessions', requireAnyRole(['warehouse', 'manager', 'admin']), (req, res) => {
    const orderId = Number(req.body?.order_id);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'invalid_order_id' });
    const actorId = loadingActorId(req);

    try {
      const result = db.transaction(() => {
        const order = db.prepare('SELECT id,order_num,status FROM orders WHERE id=?').get(orderId);
        if (!order) return { error: 'order_not_found', status: 404 };
        const normalizedOrderStatus = normalizeOrderStatus(order.status);
        const active = db.prepare(`SELECT session_uid FROM order_loading_sessions WHERE order_id=? AND status='active'`).get(orderId);
        if (active) return { session_uid: active.session_uid, resumed: true };

        if (![ORDER_STATUS.DONE_WAITING_PICKUP, ORDER_STATUS.LOADING].includes(normalizedOrderStatus)) {
          return { error: 'order_not_ready_for_loading', status: 409, order_status: order.status };
        }

        const packages = eligibleOrderPackages(db, orderId);
        if (!packages.length) return { error: 'no_loadable_packages', status: 409 };

        if (normalizedOrderStatus !== ORDER_STATUS.LOADING) {
          db.prepare('UPDATE orders SET status=? WHERE id=?').run(ORDER_STATUS.LOADING, order.id);
          addOrderLoadingStatusAudit(db, { order, from: order.status, to: ORDER_STATUS.LOADING, actorId });
        }

        const sessionUid = loadingSessionUid();
        const expectedWeight = Math.round(packages.reduce((sum, row) => sum + Number(row.weight || 0), 0) * 1000) / 1000;
        const created = db.prepare(`
          INSERT INTO order_loading_sessions (session_uid,order_id,order_num,expected_count,expected_weight,started_by)
          VALUES (?,?,?,?,?,?)
        `).run(sessionUid, order.id, order.order_num, packages.length, expectedWeight, actorId);
        const sessionId = created.lastInsertRowid;
        const addPackage = db.prepare(`
          INSERT INTO order_loading_session_packages (session_id,package_id,package_code,item_ids_json,quantity,weight)
          VALUES (?,?,?,?,?,?)
        `);
        for (const pkg of packages) {
          addPackage.run(sessionId, pkg.id, pkg.package_code, pkg.item_ids || '[]', Number(pkg.quantity || 0), Number(pkg.weight || 0));
        }
        addLoadingEvent(db, {
          sessionId,
          type: 'started',
          actorId,
          details: { expected_count: packages.length, expected_weight: expectedWeight },
        });
        return { session_uid: sessionUid, resumed: false, status_changed: normalizedOrderStatus !== ORDER_STATUS.LOADING, order_num: order.order_num };
      })();

      if (result.error) return res.status(result.status).json({ error: result.error, order_status: result.order_status || null });
      if (result.status_changed) wsBroadcast('order_status', { id: orderId, status: ORDER_STATUS.LOADING, orderNum: result.order_num });
      return res.status(result.resumed ? 200 : 201).json({ ...loadingSessionState(db, result.session_uid), resumed: result.resumed });
    } catch (error) {
      if (String(error.message || '').includes('idx_loading_session_one_active_order')) {
        const active = db.prepare(`SELECT session_uid FROM order_loading_sessions WHERE order_id=? AND status='active'`).get(orderId);
        if (active) return res.json({ ...loadingSessionState(db, active.session_uid), resumed: true });
      }
      throw error;
    }
  });

  router.get('/loading/sessions/:sessionUid', requireAnyRole(['warehouse', 'manager', 'admin']), (req, res) => {
    const state = loadingSessionState(db, req.params.sessionUid);
    if (!state) return res.status(404).json({ error: 'loading_session_not_found' });
    res.json(state);
  });

  router.post('/loading/sessions/:sessionUid/scan', requireAnyRole(['warehouse', 'manager', 'admin']), (req, res) => {
    const code = scannedPackageCode(req.body?.qr_data ?? req.body?.code);
    if (!code) return res.status(400).json({ error: 'invalid_package_qr' });
    const actorId = loadingActorId(req);
    const sessionUid = String(req.params.sessionUid || '');

    const result = db.transaction(() => {
      const session = db.prepare(`
        SELECT s.id,s.order_id,s.status,o.status AS order_status
        FROM order_loading_sessions s
        JOIN orders o ON o.id=s.order_id
        WHERE s.session_uid=?
      `).get(sessionUid);
      if (!session) return { error: 'loading_session_not_found', status: 404 };
      if (session.status !== 'active') return { error: 'loading_session_not_active', status: 409 };
      if (normalizeOrderStatus(session.order_status) !== ORDER_STATUS.LOADING) return { error: 'order_not_in_loading', status: 409 };

      const expected = db.prepare(`
        SELECT id,package_id,state FROM order_loading_session_packages
        WHERE session_id=? AND package_code=?
      `).get(session.id, code);
      if (!expected) {
        const packageRow = db.prepare('SELECT id,order_id FROM packages WHERE package_code=?').get(code);
        addLoadingEvent(db, {
          sessionId: session.id,
          type: packageRow ? 'wrong_order_scan' : 'unknown_scan',
          packageId: packageRow?.id || null,
          scannedValue: code,
          actorId,
          details: { expected_order_id: session.order_id, scanned_order_id: packageRow?.order_id || null },
        });
        return { outcome: packageRow ? 'wrong_order' : 'unknown' };
      }

      if (expected.state === 'loaded') {
        addLoadingEvent(db, { sessionId: session.id, type: 'duplicate_scan', packageId: expected.package_id, scannedValue: code, actorId });
        return { outcome: 'duplicate' };
      }

      const packageUpdated = db.prepare(`
        UPDATE packages SET status='loaded'
        WHERE id=? AND status IN ('packed','ready','staged')
      `).run(expected.package_id);
      if (packageUpdated.changes !== 1) {
        addLoadingEvent(db, { sessionId: session.id, type: 'unknown_scan', packageId: expected.package_id, scannedValue: code, actorId, details: { reason: 'package_not_loadable' } });
        return { outcome: 'not_loadable' };
      }

      const loaded = db.prepare(`
        UPDATE order_loading_session_packages
        SET state='loaded',loaded_by=?,loaded_at=CURRENT_TIMESTAMP
        WHERE id=? AND state='pending'
      `).run(actorId, expected.id);
      if (loaded.changes !== 1) {
        addLoadingEvent(db, { sessionId: session.id, type: 'duplicate_scan', packageId: expected.package_id, scannedValue: code, actorId });
        return { outcome: 'duplicate' };
      }
      addLoadingEvent(db, { sessionId: session.id, type: 'package_loaded', packageId: expected.package_id, scannedValue: code, actorId });
      return { outcome: 'loaded', package_code: code };
    })();

    if (result.error) return res.status(result.status).json({ error: result.error });
    const state = loadingSessionState(db, sessionUid);
    const messages = {
      loaded: 'החבילה נוספה להעמסה',
      duplicate: 'החבילה כבר נסרקה בסשן זה',
      wrong_order: 'החבילה אינה שייכת להזמנה זו',
      unknown: 'QR חבילה לא מוכר',
      not_loadable: 'החבילה אינה זמינה להעמסה',
    };
    res.json({ outcome: result.outcome, message: messages[result.outcome], state });
  });

  router.post('/loading/sessions/:sessionUid/complete', requireAnyRole(['warehouse', 'manager', 'admin']), (req, res) => {
    const sessionUid = String(req.params.sessionUid || '');
    const actorId = loadingActorId(req);
    const result = db.transaction(() => {
      const session = db.prepare(`SELECT id,status FROM order_loading_sessions WHERE session_uid=?`).get(sessionUid);
      if (!session) return { error: 'loading_session_not_found', status: 404 };
      if (session.status === 'completed') return { completed: true, replay: true };
      if (session.status !== 'active') return { error: 'loading_session_not_active', status: 409 };
      const missing = db.prepare(`SELECT COUNT(*) AS count FROM order_loading_session_packages WHERE session_id=? AND state='pending'`).get(session.id).count;
      if (missing > 0) return { error: 'packages_missing', status: 409, missing_count: missing };
      db.prepare(`UPDATE order_loading_sessions SET status='completed',completed_by=?,completed_at=CURRENT_TIMESTAMP WHERE id=?`).run(actorId, session.id);
      addLoadingEvent(db, { sessionId: session.id, type: 'completed', actorId });
      return { completed: true, replay: false };
    })();
    if (result.error) return res.status(result.status).json({ error: result.error, missing_count: result.missing_count || 0 });
    res.json({ ...loadingSessionState(db, sessionUid), replay: result.replay });
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
    const deliveryWeight = deliveryNoteWeightFromPayload({
      packagesJson: packages_json,
      itemsJson: items_json,
    }) || positiveNumberOrNull(total_weight) || 0;
    const r = db.prepare(`INSERT INTO delivery_notes (note_num,order_id,order_num,delivery_id,customer_id,packages_json,items_json,total_weight,driver_id) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(note_num, order_id || null, order_num || null, delivery_id || null, customer_id || null,
        JSON.stringify(packages_json || []), JSON.stringify(items_json || []), deliveryWeight || 0, driver_id || null);
    res.json({ id: r.lastInsertRowid, note_num, total_weight: deliveryWeight || 0 });
  });

  return router;
};

module.exports.manifest = {
  id: 'warehouse',
  label: 'מחסן',
  screens: [
    { id: 'warehouse', path: '/warehouse.html', label: 'מחסן', icon: '📦', group: 'תפעול' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'read', production: 'read', warehouse: 'edit' },
  },
  consumes: [
    { table: 'packages' },
    { table: 'delivery_notes' },
    { table: 'order_loading_sessions' },
    { table: 'order_loading_session_packages' },
  ],
  produces: [],
};
