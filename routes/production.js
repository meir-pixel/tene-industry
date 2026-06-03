const router = require('express').Router();

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

  router.get('/kpi/tons-today', requireRole('viewer'), (req, res) => {
    const today = new Date().toISOString().slice(0,10);
    const r = db.prepare(`
      SELECT COALESCE(SUM(i.total_weight),0)/1000 as tons
      FROM items i
      WHERE i.status=? AND DATE(i.completed_at)=?
    `).get(statusContracts.ITEM_STATUS.DONE, today);
    res.json({ tons: Math.round((r.tons || 0) * 10) / 10, date: today });
  });

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

  // ── MACHINES ──────────────────────────────────────────────────────
  router.get('/machines', requireAnyRole(['production', 'kiosk', 'maintenance', 'office', 'manager', 'admin']), (req, res) => {
    const machines = db.prepare('SELECT * FROM machines ORDER BY id').all();
    const live = modbus.getAllState();
    const merged = machines.map(m => {
      const ls = live.find(l => l.id === m.id);
      return ls ? { ...m, ...ls } : m;
    });
    res.json(merged);
  });

  // Create new machine
  router.post('/machines', requireRole('manager'), (req, res) => {
    const {
      name, label, conn_mode, tcp_host, tcp_port, rtu_port, baud_rate, parity, stop_bits, slave_id,
      min_diameter, max_diameter,
      single_min_diameter, single_max_diameter, double_min_diameter, double_max_diameter
    } = req.body;
    if (!name) return res.status(400).json({ error: 'שם מכונה נדרש' });
    const result = db.prepare(`INSERT INTO machines (name,label,conn_mode,tcp_host,tcp_port,rtu_port,baud_rate,parity,stop_bits,slave_id,min_diameter,max_diameter,single_min_diameter,single_max_diameter,double_min_diameter,double_max_diameter)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(name.trim(), label||name.substring(0,1).toUpperCase(), conn_mode||'tcp',
           tcp_host||null, tcp_port||502, rtu_port||null, baud_rate||9600,
           parity||'none', stop_bits||1,
           slave_id||1, min_diameter||8, max_diameter||32,
           single_min_diameter || min_diameter || 8,
           single_max_diameter || max_diameter || 32,
           double_min_diameter || min_diameter || 8,
           double_max_diameter || 16);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  // Delete machine
  router.delete('/machines/:id', requireRole('manager'), (req, res) => {
    db.prepare('DELETE FROM machines WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  router.post('/machines/:id/send-params', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), async (req, res) => {
    const machineId = Number(req.params.id);
    const { diameter, totalLengthMm, productionQty, angles } = req.body;
    try {
      await modbus.writeParams(machineId, { diameter, totalLengthMm, productionQty, angles: angles || [] });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/machines/:id/assign', requireAnyRole(['production', 'manager', 'admin']), (req, res) => {
    const { itemId, orderNum } = req.body;
    db.prepare('UPDATE machines SET current_item_id=?,current_order_num=? WHERE id=?')
      .run(itemId, orderNum, req.params.id);
    db.prepare('UPDATE items SET status=?,started_at=?,machine_id=? WHERE id=?')
      .run('בייצור', new Date().toISOString(), req.params.id, itemId);
    wsBroadcast('machine_assign', { machineId: Number(req.params.id), itemId, orderNum });
    res.json({ success: true });
  });

  // ── MACHINE CONNECTION CONFIG ─────────────────────────────────────
  router.patch('/machines/:id/config', requireRole('manager'), (req, res) => {
    const {
      conn_mode, tcp_host, tcp_port, rtu_port, baud_rate, parity, stop_bits, slave_id,
      min_diameter, max_diameter,
      single_min_diameter, single_max_diameter, double_min_diameter, double_max_diameter,
      name, label, can_3d
    } = req.body;
    const mode = conn_mode || 'tcp';
    db.prepare(`UPDATE machines SET
      conn_mode=?,
      tcp_host=?,
      tcp_port=?,
      rtu_port=?,
      baud_rate=COALESCE(?,baud_rate),
      parity=COALESCE(?,parity),
      stop_bits=COALESCE(?,stop_bits),
      slave_id=COALESCE(?,slave_id),
      min_diameter=COALESCE(?,min_diameter),
      max_diameter=COALESCE(?,max_diameter),
      single_min_diameter=COALESCE(?,single_min_diameter),
      single_max_diameter=COALESCE(?,single_max_diameter),
      double_min_diameter=COALESCE(?,double_min_diameter),
      double_max_diameter=COALESCE(?,double_max_diameter),
      name=COALESCE(?,name),
      label=COALESCE(?,label),
      can_3d=COALESCE(?,can_3d)
      WHERE id=?`)
      .run(
        mode,
        mode === 'tcp' ? (tcp_host || null) : null,
        mode === 'tcp' ? (tcp_port || 502)  : null,
        mode === 'rtu' ? (rtu_port || null) : null,
        baud_rate || null, parity || null, stop_bits || null, slave_id || null,
        min_diameter || null, max_diameter || null,
        single_min_diameter || null, single_max_diameter || null,
        double_min_diameter || null, double_max_diameter || null,
        name || null, label || null,
        can_3d != null ? (can_3d ? 1 : 0) : null,
        req.params.id
      );
    if (modbus) modbus.reconfigMachine(req.params.id).catch(()=>{});
    res.json({ success: true });
  });

  router.post('/machines/:id/complete', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const machineId = Number(req.params.id);
    const { producedQty } = req.body;
    const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
    if (!machine?.current_item_id) return res.status(400).json({ error: 'אין פריט פעיל' });

    const item       = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
    const actualWaste = Math.max(0, (producedQty || 0) - (item?.quantity || 0));

    db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
      .run('הושלם', new Date().toISOString(), producedQty, actualWaste, machine.current_item_id);
    db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineId);

    const pallet = item ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(item.pallet_id) : null;
    if (pallet) checkOrderComplete(pallet.order_id);

    wsBroadcast('machine_complete', { machineId });
    res.json({ success: true, actualWaste });
  });

  // ── MACHINE STATE MACHINE ────────────────────────────────────────

  router.patch('/machines/:id/state', requireAnyRole(['production', 'maintenance', 'manager', 'admin']), (req, res) => {
    const machineId = Number(req.params.id);
    const { state, reason, operator_id } = req.body;
    if (!MACHINE_STATES.includes(state)) {
      return res.status(400).json({ error: `מצב לא תקין: ${state}. מצבים אפשריים: ${MACHINE_STATES.join(', ')}` });
    }
    const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
    if (!machine) return res.status(404).json({ error: 'מכונה לא נמצאה' });

    const currentState = machine.status || 'לא מחובר';
    const allowed = STATE_TRANSITIONS[currentState] || [];
    if (!allowed.includes(state)) {
      return res.status(409).json({
        error: `מעבר לא חוקי: ${currentState} → ${state}`,
        current: currentState,
        allowed
      });
    }

    // Block transition to ריצה if machine has active LOTO lock
    if (state === 'ריצה') {
      const activeLock = db.prepare("SELECT id FROM loto WHERE machine_id=? AND status='פעיל'").get(machineId);
      if (activeLock) {
        return res.status(409).json({ error: 'לא ניתן להפעיל מכונה עם נעילת LOTO פעילה', loto_id: activeLock.id });
      }
    }

    // Update machine status
    db.prepare('UPDATE machines SET status=? WHERE id=?').run(state, machineId);

    // Log the transition
    db.prepare('INSERT INTO machine_state_log (machine_id,from_state,to_state,reason,operator_id) VALUES (?,?,?,?,?)')
      .run(machineId, currentState, state, reason || null, operator_id || null);

    // Insert production event
    const eventMap = {
      'ריצה':   'MachineStarted',
      'תקלה':   'MachineStopped',
      'תחזוקה': 'MachineStopped',
      'לא מחובר': 'MachineStopped',
    };
    if (eventMap[state]) {
      db.prepare('INSERT INTO production_events (event_type,machine_id,payload) VALUES (?,?,?)')
        .run(eventMap[state], machineId, JSON.stringify({ from: currentState, to: state, reason }));
    }

    // If fault or maintenance, create alert
    if (state === 'תקלה') {
      db.prepare("INSERT INTO alerts (type,level,message,machine_id) VALUES (?,?,?,?)")
        .run('machine_fault', 'critical', `מכונה ${machine.name} עברה לתקלה${reason ? ': ' + reason : ''}`, machineId);
    }

    wsBroadcast('machine_state', { machineId, from: currentState, to: state, reason });
    res.json({ ok: true, from: currentState, to: state });
  });

  router.get('/machines/:id/state-log', requireAnyRole(['production', 'maintenance', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT sl.*, u.display_name as operator_name
      FROM machine_state_log sl
      LEFT JOIN users u ON sl.operator_id = u.id
      WHERE sl.machine_id = ?
      ORDER BY sl.created_at DESC
      LIMIT 100
    `).all(req.params.id);
    res.json(rows);
  });

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

  router.get('/reports/waste', requireAnyRole(['production', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    const { from, to } = req.query;
    const rows = db.prepare(`
      SELECT i.machine, i.diameter, i.shape_name,
             SUM(i.actual_waste) as total_waste, SUM(i.quantity) as total_ordered,
             ROUND(100.0 * SUM(i.actual_waste) / MAX(SUM(i.quantity),1), 1) as waste_pct,
             COUNT(*) as item_count
      FROM items i
      WHERE i.status='הושלם'
        ${from ? "AND DATE(i.completed_at) >= '" + from + "'" : ''}
        ${to   ? "AND DATE(i.completed_at) <= '" + to + "'"   : ''}
      GROUP BY i.machine, i.diameter, i.shape_name
      ORDER BY waste_pct DESC
    `).all();
    res.json(rows);
  });

  router.get('/waste/summary', requireAnyRole(['production', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    const { from, to } = req.query;
    const fromDate = from || new Date(Date.now()-30*86400000).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];
    res.json({
      period: { from:fromDate, to:toDate },
      byDiameter: db.prepare('SELECT i.diameter,SUM(i.quantity) as items_produced,SUM(i.total_weight) as net_weight,SUM(i.actual_waste) as actual_waste_g,ROUND(AVG(CAST(i.actual_waste AS REAL)/NULLIF(i.total_length_mm,0)*100),2) as waste_pct FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 GROUP BY i.diameter ORDER BY i.diameter').all(fromDate,toDate),
      topWaste: db.prepare('SELECT o.order_num,i.diameter,i.actual_waste,i.total_weight AS weight,i.shape_name FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 ORDER BY i.actual_waste DESC LIMIT 20').all(fromDate,toDate),
      rawMaterial: db.prepare('SELECT diameter,SUM(weight_scrapped) as total_scrapped,SUM(weight_received) as total_received,ROUND(100.0*SUM(weight_scrapped)/NULLIF(SUM(weight_received),0),1) as scrap_pct FROM raw_material GROUP BY diameter ORDER BY diameter').all(),
    });
  });

  router.get('/shifts', requireAnyRole(['production', 'kiosk', 'office', 'manager', 'admin']), (req, res) => {
    const { date, machine_id, limit = 50 } = req.query;
    let q = `SELECT s.*, u.display_name as operator_name, m.name as machine_name
             FROM shifts s
             LEFT JOIN users u ON s.operator_id=u.id
             LEFT JOIN machines m ON s.machine_id=m.id`;
    const wheres = [], params = [];
    if (date)       { wheres.push("s.date=?");       params.push(date); }
    if (machine_id) { wheres.push("s.machine_id=?"); params.push(machine_id); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY s.started_at DESC LIMIT ?';
    params.push(Number(limit));
    res.json(db.prepare(q).all(...params));
  });

  router.post('/shifts', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const { shift_type, date, operator_id, machine_id, notes } = req.body;
    const today = date || new Date().toISOString().slice(0, 10);
    const r = db.prepare(`INSERT INTO shifts (shift_type,date,operator_id,machine_id,notes) VALUES (?,?,?,?,?)`)
      .run(shift_type || 'morning', today, operator_id || null, machine_id || null, notes || null);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/shifts/:id/end', requireAnyRole(['production', 'kiosk', 'manager', 'admin']), (req, res) => {
    const { total_pieces, total_weight, notes } = req.body;
    db.prepare(`UPDATE shifts SET ended_at=CURRENT_TIMESTAMP, total_pieces=?, total_weight=?, notes=COALESCE(?,notes) WHERE id=?`)
      .run(total_pieces || 0, total_weight || 0, notes || null, req.params.id);
    res.json({ ok: true });
  });

  // ── DOWNTIME REASONS ──────────────────────────────────────────────
  router.get('/downtime-reasons', requireAnyRole(['production', 'kiosk', 'maintenance', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT * FROM downtime_reasons ORDER BY label').all());
  });

  // ── MACHINE STOPS ─────────────────────────────────────────────────
  router.get('/machine-stops', requireAnyRole(['production', 'kiosk', 'maintenance', 'manager', 'admin']), (req, res) => {
    const { machine_id, shift_id, active } = req.query;
    let q = `SELECT ms.*, dr.label as reason_label, dr.color as reason_color,
             u.display_name as reported_by_name
             FROM machine_stops ms
             LEFT JOIN downtime_reasons dr ON ms.reason_code=dr.code
             LEFT JOIN users u ON ms.reported_by=u.id`;
    const wheres = [], params = [];
    if (machine_id) { wheres.push('ms.machine_id=?'); params.push(machine_id); }
    if (shift_id)   { wheres.push('ms.shift_id=?');   params.push(shift_id); }
    if (active === '1') { wheres.push('ms.ended_at IS NULL'); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY ms.started_at DESC LIMIT 100';
    res.json(db.prepare(q).all(...params));
  });

  router.post('/machine-stops', requireAnyRole(['production', 'kiosk', 'maintenance', 'manager', 'admin']), (req, res) => {
    const { machine_id, shift_id, reason_code, notes, reported_by } = req.body;
    const r = db.prepare(`INSERT INTO machine_stops (machine_id,shift_id,reason_code,notes,reported_by) VALUES (?,?,?,?,?)`)
      .run(machine_id, shift_id || null, reason_code, notes || null, reported_by || null);
    // fire event
    db.prepare(`INSERT INTO production_events (event_type,machine_id,operator_id,payload) VALUES (?,?,?,?)`)
      .run('MachineStopped', machine_id, reported_by || null, JSON.stringify({ reason_code, notes }));
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/machine-stops/:id/end', requireAnyRole(['production', 'kiosk', 'maintenance', 'manager', 'admin']), (req, res) => {
    const stop = db.prepare('SELECT * FROM machine_stops WHERE id=?').get(req.params.id);
    if (!stop) return res.status(404).json({ error: 'not found' });
    const durMin = stop.started_at
      ? Math.round((Date.now() - new Date(stop.started_at).getTime()) / 60000)
      : 0;
    db.prepare(`UPDATE machine_stops SET ended_at=CURRENT_TIMESTAMP, duration_min=? WHERE id=?`)
      .run(durMin, req.params.id);
    res.json({ ok: true, duration_min: durMin });
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
    const { produced_qty, actual_waste, note, status, package_id, zone } = req.body;
    const fields = [], vals = [];
    if (produced_qty !== undefined) { fields.push('produced_qty=?'); vals.push(produced_qty); }
    if (actual_waste !== undefined) { fields.push('actual_waste=?'); vals.push(actual_waste); }
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

  // ── OEE / MACHINE KPIs ────────────────────────────────────────────
  router.get('/machines/oee', requireAnyRole(['production', 'maintenance', 'manager', 'admin']), (req, res) => {
    const today = new Date().toISOString().slice(0,10);
    const machines = db.prepare('SELECT * FROM machines').all();
    const result = machines.map(m => {
      // Availability: 1 - downtime / shift_hours (assume 8h shift = 480 min)
      const stopMins = db.prepare(
        `SELECT COALESCE(SUM(duration_min),0) as mins FROM machine_stops WHERE machine_id=? AND DATE(started_at)=?`
      ).get(m.id, today).mins;
      const availability = Math.max(0, Math.min(1, 1 - stopMins / 480));

      // Performance: produced pieces vs. theoretical (rough estimate)
      const pieces = db.prepare(
        `SELECT COALESCE(SUM(quantity),0) as q FROM items WHERE machine=? AND DATE(completed_at)=?`
      ).get(m.name, today).q;

      // Quality: pass rate from quality_checks today
      const qc = db.prepare(
        `SELECT SUM(pass_qty) as p, SUM(pass_qty+fail_qty) as t FROM quality_checks WHERE DATE(checked_at)=?`
      ).get(today);
      const quality = qc && qc.t > 0 ? qc.p / qc.t : 1;

      // Tons today
      const tonsToday = db.prepare(
        `SELECT COALESCE(SUM(i.total_weight),0)/1000 as tons FROM items i WHERE i.machine=? AND DATE(i.completed_at)=?`
      ).get(m.name, today).tons;

      const oee = Math.round(availability * 1 * quality * 100); // simplified (no performance factor)
      return { ...m, availability: Math.round(availability*100), quality: Math.round(quality*100), oee, pieces_today: pieces, tons_today: tonsToday, downtime_min: stopMins };
    });
    res.json(result);
  });

  router.get('/kpi/shift-summary', requireAnyRole(['production', 'office', 'manager', 'admin']), (req, res) => {
    const today = new Date().toISOString().slice(0,10);
    const now = new Date();
    const h = now.getHours();
    let shiftType = h >= 6 && h < 14 ? 'morning' : h >= 14 && h < 22 ? 'afternoon' : 'night';

    const activeShifts = db.prepare(`
      SELECT s.*, u.display_name as operator_name, m.name as machine_name
      FROM shifts s
      LEFT JOIN users u ON s.operator_id = u.id
      LEFT JOIN machines m ON s.machine_id = m.id
      WHERE s.date = ? AND s.ended_at IS NULL
    `).all(today);

    const itemsInProd = db.prepare(`
      SELECT i.id, i.diameter, i.quantity, i.produced_qty,
        COALESCE(i.total_weight, 0) as weight, i.status, i.machine,
        o.order_num,
        c.name as customer_name,
        COALESCE(m.name, i.machine) as machine_name
      FROM items i
      LEFT JOIN pallets p ON i.pallet_id = p.id
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN machines m ON i.machine_id = m.id
      WHERE i.status IN ('בייצור','ממתין')
      ORDER BY i.started_at DESC
      LIMIT 20
    `).all();

    const todayTons = db.prepare(`
      SELECT COALESCE(SUM(i.total_weight),0)/1000 as tons
      FROM items i WHERE i.status='הושלם' AND DATE(i.completed_at)=?
    `).get(today);

    const stops = db.prepare(`
      SELECT ms.*, dr.label as reason_label, m.name as machine_name
      FROM machine_stops ms
      LEFT JOIN downtime_reasons dr ON ms.reason_code = dr.code
      LEFT JOIN machines m ON ms.machine_id = m.id
      WHERE DATE(ms.started_at) = ? AND ms.ended_at IS NULL
    `).all(today);

    res.json({
      shiftType,
      activeShifts,
      itemsInProd,
      todayTons: Math.round((todayTons.tons || 0) * 10) / 10,
      activeStops: stops
    });
  });

  return router;
};
