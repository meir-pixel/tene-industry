const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/financeCredit missing dependency: ${name}`);
  return value;
}

module.exports = function createFinanceCreditRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);

  // Active credit accounts and transactions. Keep separate from customer_credit ledger/exposure.
  router.get('/credit', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare('SELECT ca.*,c.name as customer_name,c.phone as customer_phone FROM credit_accounts ca LEFT JOIN customers c ON ca.customer_id=c.id ORDER BY ca.blocked DESC,ca.current_debt DESC').all());
  });

  router.get('/credit/:customerId', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id,credit_limit) VALUES (?,0)').run(req.params.customerId);
    const acc = db.prepare('SELECT ca.*,c.name as customer_name FROM credit_accounts ca LEFT JOIN customers c ON ca.customer_id=c.id WHERE ca.customer_id=?').get(req.params.customerId);
    acc.transactions = db.prepare('SELECT * FROM credit_transactions WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').all(req.params.customerId);
    res.json(acc);
  });

  router.patch('/credit/:customerId', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id) VALUES (?)').run(req.params.customerId);
    db.prepare('UPDATE credit_accounts SET credit_limit=COALESCE(?,credit_limit),payment_terms=COALESCE(?,payment_terms),blocked=COALESCE(?,blocked),block_reason=COALESCE(?,block_reason),notes=COALESCE(?,notes),updated_at=CURRENT_TIMESTAMP WHERE customer_id=?')
      .run(f.credit_limit ?? null, f.payment_terms || null, f.blocked ?? null, f.block_reason || null, f.notes || null, req.params.customerId);
    res.json({ success: true });
  });

  router.post('/credit/:customerId/transaction', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const { type, amount, order_id, description } = req.body;
    if (!type || !amount) return res.status(400).json({ error: 'סוג וסכום חובה' });
    db.prepare('INSERT OR IGNORE INTO credit_accounts (customer_id) VALUES (?)').run(req.params.customerId);
    const r = db.prepare('INSERT INTO credit_transactions (customer_id,order_id,type,amount,description) VALUES (?,?,?,?,?)')
      .run(req.params.customerId, order_id || null, type, amount, description || null);
    const delta = (type === 'payment' || type === 'credit_note') ? -Math.abs(amount) : Math.abs(amount);
    db.prepare('UPDATE credit_accounts SET current_debt=ROUND(current_debt+?,2),updated_at=CURRENT_TIMESTAMP WHERE customer_id=?')
      .run(delta, req.params.customerId);
    const acc = db.prepare('SELECT * FROM credit_accounts WHERE customer_id=?').get(req.params.customerId);
    if (acc && acc.credit_limit > 0 && acc.current_debt > acc.credit_limit) {
      db.prepare("UPDATE credit_accounts SET blocked=1,block_reason='חריגה ממסגרת אשראי' WHERE customer_id=?").run(req.params.customerId);
    }
    res.json({ id: r.lastInsertRowid });
  });

  // Block status from credit endpoint.
  router.get('/credit/:customerId/status', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const acc = db.prepare('SELECT blocked,block_reason,credit_limit,current_debt FROM credit_accounts WHERE customer_id=?').get(req.params.customerId);
    res.json(acc || { blocked: 0, credit_limit: 0, current_debt: 0 });
  });

  return router;
};

module.exports.manifest = {
  "id": "finance-credit",
  "label": "Finance Credit",
  "consumes": [
    {
      "table": "credit_accounts"
    },
    {
      "table": "credit_transactions"
    }
  ],
  "produces": []
};
