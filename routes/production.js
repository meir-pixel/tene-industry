const router = require('express').Router();
const createProductionMachinesRouter = require('./productionMachines');

function required(name, value) {
  if (!value) throw new Error(`routes/production missing dependency: ${name}`);
  return value;
}

module.exports = function createProductionRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const requireRole = required('requireRole', deps.requireRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const modbus = required('modbus', deps.modbus);
  const statusContracts = required('statusContracts', deps.statusContracts);
  const MACHINE_STATES = required('MACHINE_STATES', deps.MACHINE_STATES);
  const STATE_TRANSITIONS = required('STATE_TRANSITIONS', deps.STATE_TRANSITIONS);
  const checkOrderComplete = required('checkOrderComplete', deps.checkOrderComplete);
  const tryParseJSON = required('tryParseJSON', deps.tryParseJSON);


  router.get('/workers', requireAnyRole(['production', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM workers WHERE active=1 ORDER BY name').all());
  });

  router.post('/workers', requireRole('manager'), (req, res) => {
    const { name, role, language } = req.body;
    const r = db.prepare('INSERT INTO workers (name,role,language) VALUES (?,?,?)').run(name, role || 'ייצור', language || 'he');
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/workers/:id', requireRole('manager'), (req, res) => {
    const { name, role, language, active } = req.body;
    db.prepare('UPDATE workers SET name=?,role=?,language=?,active=? WHERE id=?').run(name, role, language, active ?? 1, req.params.id);
    res.json({ success: true });
  });

  router.use(createProductionMachinesRouter({
    db,
    requireAnyRole,
    requireRole,
    wsBroadcast,
    modbus,
    MACHINE_STATES,
    STATE_TRANSITIONS,
    checkOrderComplete,
  }));

  // ── SCAN (QR) ─────────────────────────────────────────────────────
  router.post('/scan', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const { qrData, machineId, workerId } = req.body;
    if (!qrData || !machineId) return res.status(400).json({ error: 'חסרים פרמטרים' });

    const [orderNum, itemId] = qrData.split('|');
    const itemIdNum = Number(itemId);
    const machineIdNum = Number(machineId);

    if (isNaN(itemIdNum)) return res.status(400).json({ error: 'QR לא תקין' });

    const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
    if (!machine) return res.status(404).json({ error: 'מכונה לא נמצאה' });

    const item = db.prepare(`
      SELECT i.*, p.order_id FROM items i JOIN pallets p ON i.pallet_id=p.id WHERE i.id=?
    `).get(itemIdNum);
    if (!item) return res.status(404).json({ error: 'פריט לא נמצא' });

    const now = new Date().toISOString();

    // Close previous item on this machine
    if (machine.current_item_id && machine.current_item_id !== itemIdNum) {
      const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
      const prevItem = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
      const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

      db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
        .run('הושלם', now, liveCounter, actualWaste, machine.current_item_id);

      db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
        .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'close_prev', liveCounter, actualWaste);

      const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
      if (prevPallet) checkOrderComplete(prevPallet.order_id);
    }

    // Start new item
    db.prepare('UPDATE items SET status=?,started_at=?,worker_id=? WHERE id=?')
      .run('בייצור', now, workerId, itemIdNum);
    db.prepare('UPDATE machines SET current_item_id=?,current_order_num=?,counter=0 WHERE id=?')
      .run(itemIdNum, orderNum, machineIdNum);

    // Auto-update order status to 'בייצור'
    db.prepare("UPDATE orders SET status='בייצור' WHERE id=? AND status IN ('בתור ייצור','ממתינה לאישור')")
      .run(item.order_id);

    // Send params to machine via Modbus
    const segments = tryParseJSON(item.segments, []);
    const angles   = segments.slice(1).map(s => s.angle_deg || 0);
    modbus.writeParams(machineIdNum, {
      diameter:       item.diameter,
      totalLengthMm:  item.total_length_mm,
      productionQty:  item.production_qty || item.quantity,
      angles,
    }).catch(() => {}); // non-blocking

    db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan) VALUES (?,?,?,?,?,?)')
      .run(machineIdNum, workerId, itemIdNum, orderNum, 'start', 0);

    wsBroadcast('machine_assign', { machineId: machineIdNum, itemId: itemIdNum, orderNum, workerId });

    res.json({ success: true, item, orderNum, machineLabel: machine.label });
  });

  // End-of-day: close last item on machine
  router.post('/machines/:id/end-of-day', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const machineIdNum = Number(req.params.id);
    const { workerId } = req.body;
    const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
    if (!machine?.current_item_id) return res.json({ success: true, message: 'אין פריט פעיל' });

    const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
    const prevItem    = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
    const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

    db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
      .run('הושלם', new Date().toISOString(), liveCounter, actualWaste, machine.current_item_id);
    db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineIdNum);

    db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
      .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'end_of_day', liveCounter, actualWaste);

    const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
    if (prevPallet) checkOrderComplete(prevPallet.order_id);

    wsBroadcast('end_of_day', { machineId: machineIdNum });
    res.json({ success: true, producedQty: liveCounter, actualWaste });
  });

  router.patch('/items/:id/status', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const { status } = req.body;
    if (!statusContracts.isValidItemStatus(status)) return res.status(400).json({ error: 'invalid status', allowed: statusContracts.VALID_ITEM_STATUSES });
    const allowed = ['ממתין','בייצור','הושלם','סופק','בהמתנה','בוטל'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const updates = { status };
    if (status === 'בייצור' && !item.started_at) updates.started_at = new Date().toISOString();
    if (status === 'הושלם') updates.completed_at = new Date().toISOString();
    db.prepare(`UPDATE items SET status=?${status==='בייצור'&&!item.started_at?',started_at=?':''}${status==='הושלם'?',completed_at=?':''} WHERE id=?`)
      .run(...Object.values(updates), req.params.id);
    wsBroadcast('item_status', { id: Number(req.params.id), status });
    res.json({ ok: true });
  });

  router.patch('/items/:id', requireAnyRole(['production', 'kiosk', 'warehouse', 'manager', 'admin']), (req, res) => {
    const { produced_qty, actual_waste, actual_weight_kg, note, status, package_id, zone } = req.body;
    const fields = [], vals = [];
    if (produced_qty !== undefined) { fields.push('produced_qty=?'); vals.push(produced_qty); }
    if (actual_waste !== undefined) { fields.push('actual_waste=?'); vals.push(actual_waste); }
    if (actual_weight_kg !== undefined) {
      const actualWeight = Number(actual_weight_kg);
      if (!Number.isFinite(actualWeight) || actualWeight < 0) return res.status(400).json({ error: 'invalid actual_weight_kg' });
      const item = db.prepare('SELECT total_weight FROM items WHERE id=?').get(req.params.id);
      if (!item) return res.status(404).json({ error: 'not found' });
      const targetWeight = Number(item.total_weight) || 0;
      const deviationPct = targetWeight > 0 ? ((actualWeight - targetWeight) / targetWeight) * 100 : null;
      fields.push('actual_weight_kg=?'); vals.push(actualWeight);
      fields.push('weight_deviation_pct=?'); vals.push(deviationPct);
    }
    if (note         !== undefined) { fields.push('note=?');         vals.push(note); }
    if (status       !== undefined) { fields.push('status=?');       vals.push(status); }
    if (package_id   !== undefined) { fields.push('package_id=?');   vals.push(package_id); }
    if (zone         !== undefined) { fields.push('zone=?');         vals.push(zone); }
    if (!fields.length) return res.json({ ok: true });
    vals.push(req.params.id);
    db.prepare(`UPDATE items SET ${fields.join(',')} WHERE id=?`).run(...vals);
    res.json({ ok: true });
  });

  // ── PRODUCTION QUEUE ──────────────────────────────────────────────
  // Returns pending items grouped and sorted by machine, diameter priority
  router.get('/production-queue', requireAnyRole(['production', 'kiosk', 'office', 'manager', 'admin']), (req, res) => {
    const { machine } = req.query;
    const visibleItemStatuses = req.query.visual === '1'
      ? "('ממתין','בייצור','הושלם','סופק')"
      : "('ממתין','בייצור')";
    const visibleOrderStatuses = req.query.visual === '1'
      ? "('אושרה – ממתין לייצור','בתור ייצור','בייצור','הושלם – ממתין לאיסוף','נשלחה','סופק – אושר')"
      : "('אושרה – ממתין לייצור','בתור ייצור','בייצור')";
    let q = `
      SELECT i.id, i.pallet_id, i.shape_id, i.shape_name, i.diameter,
             i.quantity, i.produced_qty, i.total_weight AS weight, i.status, i.machine,
             i.actual_weight_kg, i.weight_deviation_pct,
             i.segments, i.total_length_mm, i.note, i.qc_status,
             p.order_id, p.pallet_num,
             o.order_num, o.priority, o.delivery_date, o.customer_id, o.status AS order_status,
             c.name as customer_name,
             COALESCE(o.priority='דחוף',0)*100 +
             COALESCE(JULIANDAY('now') - JULIANDAY(o.delivery_date), 0)*10 as priority_score
      FROM items i
      JOIN pallets p ON i.pallet_id=p.id
      JOIN orders o ON p.order_id=o.id
      LEFT JOIN customers c ON o.customer_id=c.id
      WHERE i.status IN ${visibleItemStatuses}
      AND o.status IN ${visibleOrderStatuses}
    `;
    const params = [];
    if (machine) { q += ' AND i.machine=?'; params.push(machine); }
    q += ' ORDER BY i.machine, priority_score DESC, o.delivery_date ASC, i.diameter ASC';
    const items = db.prepare(q).all(...params);

    // Group by machine
    const grouped = {};
    for (const item of items) {
      const key = item.machine || 'לא שויך';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    res.json({ items, grouped });
  });

  // ── PRODUCTION EVENTS ─────────────────────────────────────────────
  router.get('/production-events', requireAnyRole(['production', 'maintenance', 'manager', 'admin']), (req, res) => {
    const { machine_id, event_type, limit = 100 } = req.query;
    let q = `SELECT pe.*, m.name as machine_name, u.display_name as operator_name
             FROM production_events pe
             LEFT JOIN machines m ON pe.machine_id=m.id
             LEFT JOIN users u ON pe.operator_id=u.id`;
    const wheres = [], params = [];
    if (machine_id)  { wheres.push('pe.machine_id=?');  params.push(machine_id); }
    if (event_type)  { wheres.push('pe.event_type=?');  params.push(event_type); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY pe.created_at DESC LIMIT ?';
    params.push(Number(limit));
    res.json(db.prepare(q).all(...params));
  });

  return router;
};
