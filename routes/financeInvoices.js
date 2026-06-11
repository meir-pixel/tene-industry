const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/financeInvoices missing dependency: ${name}`);
  return value;
}

module.exports = function createFinanceInvoicesRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);

  router.get('/invoices', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const { customer_id, status, order_id } = req.query;
    const wheres = [], params = [];
    if (customer_id) { wheres.push('i.customer_id=?'); params.push(customer_id); }
    if (status) { wheres.push('i.status=?'); params.push(status); }
    if (order_id) { wheres.push('i.order_id=?'); params.push(order_id); }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    const rows = db.prepare(`SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id ${where} ORDER BY i.created_at DESC LIMIT 100`).all(...params);
    res.json(rows);
  });

  router.post('/invoices', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    const { order_id, customer_id, items_json, subtotal, vat_rate, notes, invoice_type, created_by } = req.body;
    const year = new Date().getFullYear();
    const seq = db.prepare("SELECT COUNT(*)+1 as n FROM invoices WHERE invoice_num LIKE ?").get(`INV-${year}-%`).n;
    const invoice_num = `INV-${year}-${String(seq).padStart(5,'0')}`;
    const vat = vat_rate ?? 0.18;
    const sub = subtotal || 0;
    const vatAmount = sub * vat;
    const total = sub + vatAmount;
    const order = order_id ? db.prepare('SELECT order_num,customer_id FROM orders WHERE id=?').get(order_id) : null;
    const cust = (customer_id || order?.customer_id) ? db.prepare('SELECT name,vat_id FROM customers WHERE id=?').get(customer_id || order?.customer_id) : null;
    const r = db.prepare(`INSERT INTO invoices (invoice_num,invoice_type,order_id,order_num,customer_id,customer_name,customer_vat_id,issue_date,items_json,subtotal,vat_rate,vat_amount,total,notes,created_by)
      VALUES (?,?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?)`)
      .run(invoice_num, invoice_type||'tax_invoice', order_id||null, order?.order_num||null,
        customer_id||order?.customer_id||null, cust?.name||null, cust?.vat_id||null,
        JSON.stringify(items_json||[]), sub, vat, vatAmount, total, notes||null, created_by||null);
    wsBroadcast('new_invoice', { id: r.lastInsertRowid, invoice_num, total });
    res.json({ id: r.lastInsertRowid, invoice_num, total });
  });

  router.patch('/invoices/:id/pay', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => { // BUG-36: cannot pay cancelled invoice
    const { paid_amount, payment_method, payment_ref } = req.body;
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.status === 'ביטול') return res.status(409).json({ error: 'לא ניתן לשלם חשבונית מבוטלת' });
    const newPaid = (inv.paid_amount || 0) + (paid_amount || 0);
    const status = newPaid >= inv.total ? 'שולמה' : 'חלקית';
    db.prepare('UPDATE invoices SET paid_amount=?,status=?,payment_method=COALESCE(?,payment_method),payment_ref=COALESCE(?,payment_ref) WHERE id=?')
      .run(newPaid, status, payment_method||null, payment_ref||null, req.params.id);
    res.json({ ok: true, status, paid_amount: newPaid });
  });

  router.patch('/invoices/:id/cancel', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
    db.prepare("UPDATE invoices SET status='ביטול' WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'finance-invoices',
  label: 'חשבוניות',
  consumes: [{ table: 'orders' }, { table: 'customers' }],
  produces: [{ event: 'new_invoice' }],
};
