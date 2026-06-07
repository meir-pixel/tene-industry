const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/intakeTraining missing dependency: ${name}`);
  return value;
}

module.exports = function createIntakeTrainingRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  router.get('/intake/training', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT id, title, document_type, problem_text, correction_text, active, created_at
      FROM intake_training_examples
      WHERE active=1
      ORDER BY id DESC
      LIMIT 100
    `).all();
    res.json(rows);
  });

  router.post('/intake/training', requireAnyRole(['manager', 'admin']), (req, res) => {
    const title = String(req.body.title || '').trim();
    const documentType = String(req.body.document_type || 'general').trim() || 'general';
    const problemText = String(req.body.problem_text || '').trim();
    const correctionText = String(req.body.correction_text || '').trim();
    if (!title || !problemText || !correctionText) {
      return res.status(400).json({ error: 'title, problem_text and correction_text are required' });
    }
    const result = db.prepare(`
      INSERT INTO intake_training_examples (title, document_type, problem_text, correction_text)
      VALUES (?, ?, ?, ?)
    `).run(title.slice(0, 120), documentType.slice(0, 60), problemText.slice(0, 1200), correctionText.slice(0, 1200));
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.delete('/intake/training/:id', requireAnyRole(['manager', 'admin']), (req, res) => {
    db.prepare('UPDATE intake_training_examples SET active=0 WHERE id=?').run(req.params.id);
    res.json({ success: true });
  });

  return router;
};
