const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/intakeReview missing dependency: ${name}`);
  return value;
}

module.exports = function createIntakeReviewRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const enrichIntakeRow = required('enrichIntakeRow', deps.enrichIntakeRow);
  const createOrderFromPayload = required('createOrderFromPayload', deps.createOrderFromPayload);
  const intakeToOrderPayload = required('intakeToOrderPayload', deps.intakeToOrderPayload);
  const intakeWorkflow = required('intakeWorkflow', deps.intakeWorkflow);
  const intake = required('intake', deps.intake);

  router.get('/intake/log', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status; // optional filter: pending_review / approved / rejected
    const sql = status
      ? 'SELECT * FROM intake_log WHERE status=? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM intake_log ORDER BY created_at DESC LIMIT 100';
    res.json(db.prepare(sql).all(...(status ? [status] : [])).map(enrichIntakeRow));
  });

  router.post('/intake/:id/approve', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare('SELECT * FROM intake_log WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Intake row not found' });
    if (row.order_id) {
      const order = db.prepare('SELECT order_num FROM orders WHERE id=?').get(row.order_id);
      if (row.status !== 'approved') {
        db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('approved', row.id);
      }
      return res.json({ success: true, orderId: row.order_id, orderNum: order?.order_num, alreadyApproved: true });
    }
    try {
      const parsed = JSON.parse(row.parsed_data || '{}');
      const body = req.body || {};
      const customerOverride = body.customer_id ? {
        id: Number(body.customer_id),
        name: body.customer_name || null,
        phone: body.customer_phone || null,
        email: body.customer_email || null,
      } : null;
      const approve = db.transaction(() => {
        const result = createOrderFromPayload(intakeToOrderPayload(parsed, row.source || 'intake', customerOverride, row.raw_content || ''));
        db.prepare('UPDATE intake_log SET status=?,order_id=? WHERE id=?').run('approved', result.orderId, row.id);
        return result;
      });
      const result = approve();
      wsBroadcast('new_order', { orderNum: result.orderNum, orderId: result.orderId });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.post('/intake/:id/reject', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const r = db.prepare('UPDATE intake_log SET status=? WHERE id=?').run('rejected', req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ success: true });
  });

  router.post('/intake/parse-text', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const { text, source } = req.body;
    try {
      const parsed = intakeWorkflow.parseManualIntakeText({
        text,
        source,
        parseWhatsAppMessage: intake.parseWhatsAppMessage,
        parseOCRText: intake.parseOCRText,
      });
      const result = db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
        .run(source || 'manual', text.slice(0, 2000), JSON.stringify(parsed), 'pending_review');
      res.json({ success: true, id: result.lastInsertRowid, parsed, item_count: (parsed.items || []).length });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  return router;
};

module.exports.manifest = {
  id: 'intake-review',
  label: 'אישור קליטה',
  consumes: [{ event: 'new_intake' }, { table: 'intake_log' }],
  produces: [{ event: 'new_order' }],
};
