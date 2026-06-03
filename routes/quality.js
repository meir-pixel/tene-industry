const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/quality missing dependency: ${name}`);
  return value;
}

module.exports = function createQualityRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);

  router.get('/quality', requireAnyRole(['quality', 'production', 'office', 'manager', 'admin']), (req, res) => {
    const { order_id, item_id, result, limit=100 } = req.query;
    let sql = 'SELECT q.*,u.display_name as inspector_name FROM quality_checks q LEFT JOIN users u ON q.inspector_id=u.id WHERE 1=1';
    const params = [];
    if (order_id) { sql+=' AND q.order_id=?'; params.push(order_id); }
    if (item_id)  { sql+=' AND q.item_id=?';  params.push(item_id); }
    if (result)   { sql+=' AND q.result=?';   params.push(result); }
    sql+=' ORDER BY q.checked_at DESC LIMIT ?'; params.push(Number(limit));
    res.json(db.prepare(sql).all(...params));
  });
  router.post('/quality', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.item_id) return res.status(400).json({ error: 'item_id חובה' });
    const r = db.prepare('INSERT INTO quality_checks (item_id,order_id,order_num,inspector_id,check_type,sample_qty,pass_qty,fail_qty,deviation_mm,deviation_deg,result,action_taken,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(f.item_id,f.order_id||null,f.order_num||null,f.inspector_id||null,f.check_type||'length',f.sample_qty||1,f.pass_qty||0,f.fail_qty||0,f.deviation_mm||0,f.deviation_deg||0,f.result||'pass',f.action_taken||null,f.notes||null);
    db.prepare('UPDATE items SET qc_status=? WHERE id=?').run(f.result==='pass'?'עבר':'נכשל',f.item_id);
    res.json({ id: r.lastInsertRowid });
  });
  router.get('/quality/stats', requireAnyRole(['quality', 'production', 'office', 'manager', 'admin']), (req, res) => {
    res.json({
      total:   db.prepare('SELECT COUNT(*) as c FROM quality_checks').get().c,
      passed:  db.prepare("SELECT COUNT(*) as c FROM quality_checks WHERE result='pass'").get().c,
      failed:  db.prepare("SELECT COUNT(*) as c FROM quality_checks WHERE result='fail'").get().c,
      byType:  db.prepare('SELECT check_type,COUNT(*) as c,AVG(deviation_mm) as avg_dev FROM quality_checks GROUP BY check_type').all(),
    });
  });

  // ── MAINTENANCE
  router.get('/maintenance', requireAnyRole(['maintenance', 'production', 'office', 'manager', 'admin']), (req, res) => {
    const { machine_id, status, limit=100 } = req.query;
    let sql = 'SELECT m.*,mc.name as machine_name,mc.label as machine_label,u.display_name as reported_by_name,u2.display_name as assigned_to_name FROM maintenance_logs m LEFT JOIN machines mc ON m.machine_id=mc.id LEFT JOIN users u ON m.reported_by=u.id LEFT JOIN users u2 ON m.assigned_to=u2.id WHERE 1=1';
    const params = [];
    if (machine_id) { sql+=' AND m.machine_id=?'; params.push(machine_id); }
    if (status)     { sql+=' AND m.status=?';     params.push(status); }
    sql+=' ORDER BY m.started_at DESC LIMIT ?'; params.push(Number(limit));
    res.json(db.prepare(sql).all(...params));
  });
  router.post('/maintenance', requireAnyRole(['maintenance', 'production', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.machine_id||!f.description) return res.status(400).json({ error: 'מכונה ותיאור חובה' });
    if (f.log_type==='breakdown') {
      db.prepare("UPDATE machines SET status='תקלה' WHERE id=?").run(f.machine_id);
      wsBroadcast('machine_update',{ machineId:f.machine_id, status:'תקלה' });
    }
    const r = db.prepare('INSERT INTO maintenance_logs (machine_id,log_type,description,reported_by,priority,parts_used,cost) VALUES (?,?,?,?,?,?,?)')
      .run(f.machine_id,f.log_type||'breakdown',f.description,f.reported_by||null,f.priority||'רגיל',f.parts_used||null,f.cost||0);
    res.json({ id: r.lastInsertRowid });
  });
  router.patch('/maintenance/:id', requireAnyRole(['maintenance', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    const log = db.prepare('SELECT * FROM maintenance_logs WHERE id=?').get(req.params.id);
    if (!log) return res.status(404).json({ error: 'לא נמצא' });
    const resolvedAt = f.status==='סגורה' ? new Date().toISOString() : null;
    db.prepare('UPDATE maintenance_logs SET status=COALESCE(?,status),assigned_to=COALESCE(?,assigned_to),downtime_min=COALESCE(?,downtime_min),root_cause=COALESCE(?,root_cause),fix_notes=COALESCE(?,fix_notes),parts_used=COALESCE(?,parts_used),cost=COALESCE(?,cost),resolved_at=COALESCE(?,resolved_at) WHERE id=?')
      .run(f.status||null,f.assigned_to||null,f.downtime_min||null,f.root_cause||null,f.fix_notes||null,f.parts_used||null,f.cost||null,resolvedAt,req.params.id);
    if (f.status==='סגורה'&&log.log_type==='breakdown') db.prepare("UPDATE machines SET status='מחובר' WHERE id=?").run(log.machine_id);
    res.json({ success: true });
  });
  router.get('/maintenance/stats', requireAnyRole(['maintenance', 'production', 'office', 'manager', 'admin']), (req, res) => {
    res.json({
      open:        db.prepare("SELECT COUNT(*) as c FROM maintenance_logs WHERE status!='סגורה'").get().c,
      breakdowns:  db.prepare("SELECT COUNT(*) as c FROM maintenance_logs WHERE log_type='breakdown'").get().c,
      avgDowntime: db.prepare('SELECT ROUND(AVG(downtime_min),0) as avg FROM maintenance_logs WHERE downtime_min>0').get().avg||0,
      byMachine:   db.prepare('SELECT mc.label,mc.name,COUNT(*) as events,SUM(m.downtime_min) as total_down FROM maintenance_logs m LEFT JOIN machines mc ON m.machine_id=mc.id GROUP BY m.machine_id ORDER BY total_down DESC').all(),
    });
  });

  router.get('/incidents', requireAnyRole(['quality', 'maintenance', 'production', 'office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT i.*, m.name as machine_name
      FROM incidents i
      LEFT JOIN machines m ON i.machine_id = m.id
      ORDER BY
        CASE i.status WHEN 'פתוח' THEN 0 WHEN 'בטיפול' THEN 1 ELSE 2 END,
        i.created_at DESC
    `).all();
    res.json(rows);
  });

  router.post('/incidents', requireAnyRole(['quality', 'maintenance', 'production', 'manager', 'admin']), (req, res) => {
    const { title, machine_id, severity, description, assigned_to, financial_impact, opened_by } = req.body;
    const r = db.prepare(`
      INSERT INTO incidents (title,machine_id,severity,description,assigned_to,financial_impact,opened_by,timeline)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      title, machine_id || null, severity || 'בינוני',
      description || '', assigned_to || '', financial_impact || 0, opened_by || '',
      JSON.stringify([{ ts: new Date().toISOString(), text: 'אירוע נפתח' }])
    );
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/incidents/:id', requireAnyRole(['quality', 'maintenance', 'manager', 'admin']), (req, res) => {
    const { status, update_text, assigned_to, financial_impact } = req.body;
    const inc = db.prepare('SELECT * FROM incidents WHERE id=?').get(req.params.id);
    if (!inc) return res.status(404).json({ error: 'not found' });
    let timeline = JSON.parse(inc.timeline || '[]');
    if (update_text) timeline.push({ ts: new Date().toISOString(), text: update_text });
    db.prepare(`
      UPDATE incidents
      SET status           = COALESCE(?, status),
          assigned_to      = COALESCE(?, assigned_to),
          financial_impact = COALESCE(?, financial_impact),
          timeline         = ?,
          resolved_at      = CASE WHEN ? = 'סגור' THEN CURRENT_TIMESTAMP ELSE resolved_at END
      WHERE id = ?
    `).run(status || null, assigned_to || null, financial_impact ?? null,
           JSON.stringify(timeline), status || '', req.params.id);
    res.json({ ok: true });
  });

  // ── NCR – Non-Conformance Reports ─────────────────────────────────
  router.get('/ncr', requireAnyRole(['quality', 'production', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT n.*, m.name as machine_name
      FROM ncr n
      LEFT JOIN machines m ON n.machine_id = m.id
      ORDER BY n.created_at DESC
    `).all();
    res.json(rows);
  });

  router.post('/ncr', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    const seq = db.prepare('SELECT COUNT(*)+1 as n FROM ncr').get().n;
    const num = 'NCR-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
    const { order_id, order_num, machine_id, description, severity, root_cause,
            disposition, quantity_affected, diameter, assigned_to, notes } = req.body;
    const r = db.prepare(`
      INSERT INTO ncr (ncr_num,order_id,order_num,machine_id,description,severity,
                       root_cause,disposition,quantity_affected,diameter,assigned_to,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(num, order_id || null, order_num || '', machine_id || null, description,
           severity || 'בינוני', root_cause || '', disposition || '',
           quantity_affected || 0, diameter || null, assigned_to || '', notes || '');
    res.json({ id: r.lastInsertRowid, ncr_num: num });
  });

  router.patch('/ncr/:id', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare(`
      UPDATE ncr
      SET status      = COALESCE(?, status),
          severity    = COALESCE(?, severity),
          root_cause  = COALESCE(?, root_cause),
          disposition = COALESCE(?, disposition),
          assigned_to = COALESCE(?, assigned_to),
          notes       = COALESCE(?, notes),
          closed_by   = COALESCE(?, closed_by),
          closed_at   = CASE WHEN ? = 'סגור' THEN CURRENT_TIMESTAMP ELSE closed_at END
      WHERE id = ?
    `).run(f.status || null, f.severity || null, f.root_cause || null,
           f.disposition || null, f.assigned_to || null, f.notes || null,
           f.closed_by || null, f.status || '', req.params.id);
    res.json({ ok: true });
  });

  // ── CAPA – Corrective & Preventive Actions ────────────────────────
  router.get('/capa', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare(`
      SELECT c.*, n.ncr_num
      FROM capa c
      LEFT JOIN ncr n ON c.ncr_id = n.id
      ORDER BY c.created_at DESC
    `).all());
  });

  router.post('/capa', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    const seq = db.prepare('SELECT COUNT(*)+1 as n FROM capa').get().n;
    const num = 'CAPA-' + new Date().getFullYear() + '-' + String(seq).padStart(4, '0');
    const { ncr_id, title, type, problem_description, root_cause,
            actions, owner, due_date, verification_method } = req.body;
    const r = db.prepare(`
      INSERT INTO capa (capa_num,ncr_id,title,type,problem_description,root_cause,
                        actions,owner,due_date,verification_method)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(num, ncr_id || null, title, type || 'מתקן',
           problem_description || '', root_cause || '',
           JSON.stringify(actions || []), owner || '', due_date || '', verification_method || '');
    res.json({ id: r.lastInsertRowid, capa_num: num });
  });

  router.patch('/capa/:id', requireAnyRole(['quality', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare(`
      UPDATE capa
      SET status         = COALESCE(?, status),
          completion_pct = COALESCE(?, completion_pct),
          actions        = COALESCE(?, actions),
          owner          = COALESCE(?, owner),
          due_date       = COALESCE(?, due_date),
          problem_description = COALESCE(?, problem_description),
          root_cause     = COALESCE(?, root_cause),
          verification_method = COALESCE(?, verification_method)
      WHERE id = ?
    `).run(f.status || null, f.completion_pct ?? null,
            f.actions ? JSON.stringify(f.actions) : null,
            f.owner || null, f.due_date || null,
            f.problem_description || null, f.root_cause || null,
            f.verification_method || null, req.params.id);
    res.json({ ok: true });
  });

  // ── LOTO – Lockout / Tagout ───────────────────────────────────────
  router.get('/loto', requireAnyRole(['maintenance', 'production', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare(`
      SELECT l.*, m.name as machine_name
      FROM loto l
      LEFT JOIN machines m ON l.machine_id = m.id
      ORDER BY l.created_at DESC
    `).all());
  });

  router.post('/loto', requireAnyRole(['maintenance', 'manager', 'admin']), (req, res) => {
    const { machine_id, locked_by, reason, reason_detail, safety_notes } = req.body;
    const existing = db.prepare("SELECT id FROM loto WHERE machine_id=? AND status='פעיל'").get(machine_id);
    if (existing) return res.status(409).json({ error: 'המכונה כבר נעולה' });
    const r = db.prepare(`
      INSERT INTO loto (machine_id,locked_by,reason,reason_detail,safety_notes)
      VALUES (?,?,?,?,?)
    `).run(machine_id, locked_by, reason || 'תחזוקה', reason_detail || '', safety_notes || '');
    db.prepare("UPDATE machines SET status='נעול LOTO' WHERE id=?").run(machine_id);
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/loto/:id/release', requireAnyRole(['maintenance', 'manager', 'admin']), (req, res) => {
    const { released_by, release_notes } = req.body;
    const loto = db.prepare('SELECT * FROM loto WHERE id=?').get(req.params.id);
    if (!loto) return res.status(404).json({ error: 'not found' });
    db.prepare(`
      UPDATE loto
      SET status='שוחרר', released_by=?, release_notes=?,
          release_confirmed=1, released_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(released_by || '', release_notes || '', req.params.id);
    db.prepare("UPDATE machines SET status='לא מחובר' WHERE id=?").run(loto.machine_id);
    res.json({ ok: true });
  });

  // ── PREVENTIVE MAINTENANCE SCHEDULE ──────────────────────────────
  router.get('/pm-schedule', requireAnyRole(['maintenance', 'production', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare(`
      SELECT p.*, m.name as machine_name
      FROM pm_schedule p
      LEFT JOIN machines m ON p.machine_id = m.id
      WHERE p.active = 1
      ORDER BY p.next_due ASC
    `).all());
  });

  router.post('/pm-schedule', requireAnyRole(['maintenance', 'manager', 'admin']), (req, res) => {
    const { machine_id, pm_type, frequency, last_done, next_due, instructions } = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO pm_schedule (machine_id,pm_type,frequency,last_done,next_due,instructions)
      VALUES (?,?,?,?,?,?)
    `).run(machine_id, pm_type, frequency || 'חודשי', last_done || null, next_due || null, instructions || '');
    res.json({ ok: true });
  });

  return router;
};
