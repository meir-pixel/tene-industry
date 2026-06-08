const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/priority missing dependency: ${name}`);
  return value;
}

module.exports = function createPriorityRouter(deps) {
  const db = required('db', deps.db);
  const requireRole = required('requireRole', deps.requireRole);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const priority = required('priority', deps.priority);
  const PRIORITY_ENABLED = required('PRIORITY_ENABLED', deps.PRIORITY_ENABLED);

  router.post('/priority/sync/:orderId', requireRole('manager'), async (req, res) => {
    if (!PRIORITY_ENABLED) return res.status(501).json({ error: 'סנכרון Priority לא זמין בשלב זה', feature: 'priority' });
    try {
      const order = db.prepare(`SELECT o.*,c.* FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.orderId);
      if (!order) return res.status(404).json({ error: 'הזמנה לא נמצאה' });

      const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
      const items   = pallets.flatMap(p => db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id));

      const customer = { name: order.name, phone: order.phone, address: order.address, contactName: order.contact_name, contactPhone: order.contact_phone };
      const result   = await priority.createOrder(order, customer, items);

      if (result.ORDNAME) {
        db.prepare('UPDATE orders SET priority_order_id=? WHERE id=?').run(result.ORDNAME, order.id);
      }
      res.json({ success: true, priorityOrderId: result.ORDNAME, mocked: result.mocked });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/priority/status', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    res.json({ configured: priority.isConfigured(), enabled: PRIORITY_ENABLED }); // BUG-45
  });

  return router;
};

module.exports.manifest = {
  "id": "priority",
  "label": "Priority Sync",
  "consumes": [
    {
      "table": "orders"
    }
  ],
  "produces": []
};
