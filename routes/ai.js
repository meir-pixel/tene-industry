const router = require('express').Router();

function required(name, value) {
  if (value === undefined || value === null) throw new Error(`routes/ai missing dependency: ${name}`);
  return value;
}

module.exports = function createAiRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const ai = required('ai', deps.ai);

  router.post('/ai/predict', requireAnyRole(['manager', 'admin']), (req, res) => {
    const { items } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });
    const result = ai.predictProductionTime(items);
    res.json(result);
  });

  router.get('/ai/predict-order/:orderId', requireAnyRole(['manager', 'admin']), (req, res) => {
    const order   = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'לא נמצא' });
    const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
    const items   = pallets.flatMap(p => db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id));
    const prediction   = ai.predictProductionTime(items);
    const feasibility  = ai.checkDeliveryFeasibility(order, items);
    res.json({ prediction, feasibility });
  });

  router.get('/ai/waste-patterns', requireAnyRole(['manager', 'admin']), (req, res) => {
    res.json(ai.analyzeWastePatterns());
  });

  router.get('/ai/machine-efficiency', requireAnyRole(['manager', 'admin']), (req, res) => {
    const days = Number(req.query.days || 7);
    res.json(ai.getMachineEfficiency(days));
  });

  return router;
};

module.exports.manifest = {
  "id": "ai",
  "label": "AI",
  "consumes": [
    {
      "table": "orders"
    },
    {
      "table": "items"
    },
    {
      "table": "production_logs"
    }
  ],
  "produces": []
};
