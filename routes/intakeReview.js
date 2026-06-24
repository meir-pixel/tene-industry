const router = require('express').Router();
const {
  findSourceIdentityDuplicate,
  sourceIdentityConflictPayload,
  sourceIdentityFromRequest,
} = require('../services/importSourceIdentity');

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

  function parseStoredIntake(row) {
    try {
      return JSON.parse(row.parsed_data || '{}');
    } catch {
      return {};
    }
  }

  function parsedOverride(original, candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return original;
    const parsed = { ...candidate };
    parsed.items = Array.isArray(candidate.items) ? candidate.items : [];
    return parsed;
  }

  function sourceIdentityForRow(row) {
    return row?.source_system || row?.external_id
      ? { source_system: row.source_system || null, external_id: row.external_id || null }
      : null;
  }

  function correctionPair(original, corrected) {
    const before = JSON.stringify(original || {});
    const after = JSON.stringify(corrected || {});
    if (before === after) return null;
    return {
      problem: before.slice(0, 1200),
      correction: after.slice(0, 1200),
    };
  }

  function saveCorrectionExample(row, original, corrected) {
    const pair = correctionPair(original, corrected);
    if (!pair) return;
    db.prepare(`
      INSERT INTO intake_training_examples (title, document_type, problem_text, correction_text)
      VALUES (?, ?, ?, ?)
    `).run(
      `Intake correction #${row.id}`,
      row.source || 'intake_review',
      pair.problem,
      pair.correction
    );
  }

  router.get('/intake/log', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status; // optional filter: pending_review / approved / rejected
    const sql = status
      ? 'SELECT * FROM intake_log WHERE status=? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM intake_log ORDER BY created_at DESC LIMIT 100';
    res.json(db.prepare(sql).all(...(status ? [status] : [])).map(enrichIntakeRow));
  });

  function itemNeedsPostOrderReview(item) {
    if (item.review_status === 'approved') return false;
    return /review|required|unclear|uncertain|verify|ambiguous|not clear|דורש|בדיקה|לא ברור/i.test(item.note || '');
  }

  router.get('/intake/order-review-tasks', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT il.*, o.order_num, c.name AS customer_name
      FROM intake_log il
      JOIN orders o ON o.id = il.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE il.status='approved'
      ORDER BY il.created_at DESC
      LIMIT 100
    `).all();
    const tasks = rows.map(row => {
      const items = db.prepare('SELECT id,note,review_status FROM items WHERE order_id=? ORDER BY id').all(row.order_id);
      const reviewItems = items.filter(itemNeedsPostOrderReview);
      if (!reviewItems.length) return null;
      return {
        ...enrichIntakeRow(row),
        post_order_review: true,
        review_count: reviewItems.length,
        review_items: reviewItems,
      };
    }).filter(Boolean);
    res.json(tasks);
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
      const originalParsed = parseStoredIntake(row);
      const parsed = intakeWorkflow.withStructuredReviewNotes(
        parsedOverride(originalParsed, req.body?.parsed_data),
        { sourceIdentity: sourceIdentityForRow(row) }
      );
      const body = req.body || {};
      const customerOverride = body.customer_id ? {
        id: Number(body.customer_id),
        name: body.customer_name || null,
        phone: body.customer_phone || null,
        email: body.customer_email || null,
      } : null;
      const duplicate = findSourceIdentityDuplicate(db, 'intake_log', row, { excludeId: row.id });
      if (duplicate) {
        return res.status(409).json(sourceIdentityConflictPayload('intake', duplicate));
      }
      const approve = db.transaction(() => {
        saveCorrectionExample(row, originalParsed, parsed);
        const result = createOrderFromPayload(intakeToOrderPayload(parsed, row.source || 'intake', customerOverride, row.raw_content || ''));
        db.prepare('UPDATE intake_log SET status=?,order_id=?,parsed_data=? WHERE id=?').run('approved', result.orderId, JSON.stringify(parsed), row.id);
        return result;
      });
      const result = approve();
      wsBroadcast('new_order', { orderNum: result.orderNum, orderId: result.orderId });
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 400).json({ success: false, error: error.message });
    }
  });

  router.post('/intake/:id/draft', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const row = db.prepare('SELECT * FROM intake_log WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Intake row not found' });
    if (row.order_id || row.status === 'approved') {
      return res.status(409).json({
        success: false,
        error: 'Intake row is already linked to an approved order; draft save cannot mutate it.',
      });
    }
    try {
      const originalParsed = parseStoredIntake(row);
      const parsed = intakeWorkflow.withStructuredReviewNotes(
        parsedOverride(originalParsed, req.body?.parsed_data),
        { sourceIdentity: sourceIdentityForRow(row) }
      );
      const saveDraft = db.transaction(() => {
        saveCorrectionExample(row, originalParsed, parsed);
        db.prepare('UPDATE intake_log SET status=?,parsed_data=? WHERE id=?')
          .run('pending_review', JSON.stringify(parsed), row.id);
      });
      saveDraft();
      res.json({ success: true, id: row.id, parsed });
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
    const identity = sourceIdentityFromRequest(req, source || 'manual');
    const duplicate = findSourceIdentityDuplicate(db, 'intake_log', identity);
    if (duplicate) return res.status(409).json(sourceIdentityConflictPayload('intake', duplicate));
    try {
      const parsed = intakeWorkflow.withStructuredReviewNotes(intakeWorkflow.parseManualIntakeText({
        text,
        source,
        parseWhatsAppMessage: intake.parseWhatsAppMessage,
        parseOCRText: intake.parseOCRText,
      }), { sourceIdentity: identity });
      const result = db.prepare('INSERT INTO intake_log (source,source_system,external_id,raw_content,parsed_data,status) VALUES (?,?,?,?,?,?)')
        .run(source || 'manual', identity?.source_system || null, identity?.external_id || null, text.slice(0, 2000), JSON.stringify(parsed), 'pending_review');
      res.json({ success: true, id: result.lastInsertRowid, parsed, item_count: (parsed.items || []).length });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message });
    }
  });

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'intake-review',
  label: 'אישור קליטה',
  consumes: [{ event: 'new_intake' }, { table: 'intake_log' }],
  produces: [{ event: 'new_order' }],
};
