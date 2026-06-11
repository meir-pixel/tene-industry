const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/financeCosts missing dependency: ${name}`);
  return value;
}

module.exports = function createFinanceCostsRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const requireRole = required('requireRole', deps.requireRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const industry = required('industry', deps.industry);
  const settingsService = required('settingsService', deps.settingsService);

// ── ORDER COSTS ────────────────────────────────────────────
function calculateOrderCost(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) return null;

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(orderId);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id); });
  const allItems = pallets.flatMap(p => p.items);

  // Get latest steel price (use existing steel_price_history table, or steel_prices if available)
  let steelPrice = db.prepare(
    'SELECT price_per_ton FROM steel_price_history ORDER BY effective_date DESC, id DESC LIMIT 1'
  ).get();
  if (!steelPrice) steelPrice = db.prepare(
    'SELECT price_per_ton FROM steel_prices ORDER BY effective_date DESC, id DESC LIMIT 1'
  ).get();
  const pricePerTon = steelPrice ? steelPrice.price_per_ton : 3800; // default ILS/ton

  // Total weight: prefer order.total_weight (most accurate), then sum items, then calculate from diameter+length
  let totalWeightKg = order.total_weight || 0;
  if (totalWeightKg === 0) {
    // Try summing items
    totalWeightKg = allItems.reduce((s, it) => {
      if (it.total_weight && it.total_weight > 0) return s + it.total_weight;
      // Calculate from diameter + length
      if (!Number.isFinite(Number(it.diameter))) return s;
      return s + (industry.weightPerUnit({
        diameter: it.diameter,
        total_length_mm: it.total_length_mm || 0,
      }) * (it.quantity || 1));
    }, 0);
  }
  const material_cost = (totalWeightKg / 1000) * pricePerTon;

  // Labor cost: approximate based on weight + complexity
  // base rate from settings (LABOR_COST_PER_HOUR → per ton conversion: ~8h/ton)
  const laborBasePerTon = settingsService.getNum('LABOR_COST_PER_HOUR', 120) * 8;
  const avgBends = allItems.reduce((s, it) => {
    const segs = (() => { try { return JSON.parse(it.segments || '[]'); } catch(e) { return []; } })();
    return s + Math.max(0, segs.length - 1);
  }, 0) / Math.max(1, allItems.length);
  const laborRatePerTon = laborBasePerTon + (avgBends * 40);
  const labor_cost = (totalWeightKg / 1000) * laborRatePerTon;

  // Machine cost: based on weight (approx ILS 80/ton)
  const machine_cost = (totalWeightKg / 1000) * 80;

  // Scrap cost: from settings (SCRAP_COST_PCT, default 3%)
  const scrapPct   = settingsService.getNum('SCRAP_COST_PCT', 3) / 100;
  const scrap_cost = material_cost * scrapPct;

  // Overhead: from settings (OVERHEAD_COST_FACTOR, default 0.15 = 15%)
  const overheadFactor = settingsService.getNum('OVERHEAD_COST_FACTOR', 0.15);
  const directCosts    = material_cost + labor_cost + machine_cost + scrap_cost;
  const overhead_cost  = directCosts * overheadFactor;
  const total_cost = directCosts + overhead_cost;

  // Revenue from order (portal_price is the customer-facing price in ILS)
  const revenue = order.portal_price || 0;

  const gross_margin = revenue - total_cost;
  const margin_pct   = revenue > 0 ? (gross_margin / revenue) * 100 : 0;
  const tons_delivered = totalWeightKg / 1000;
  const cost_per_ton   = tons_delivered > 0 ? total_cost / tons_delivered : 0;

  // Confidence: low if missing prices, high if verified
  const confidence = steelPrice ? 'high' : 'low';

  return {
    order_id: orderId, material_cost, labor_cost, machine_cost,
    scrap_cost, overhead_cost, total_cost, revenue,
    gross_margin, margin_pct, tons_delivered, cost_per_ton, confidence
  };
}

// GET /api/orders/:id/costs
router.get('/orders/:id/costs', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const orderId = Number(req.params.id);
  let existing = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  if (!existing) {
    const calc = calculateOrderCost(orderId);
    if (!calc) return res.status(404).json({ error: 'הזמנה לא נמצאה' });
    db.prepare(`INSERT OR REPLACE INTO order_costs
      (order_id,material_cost,labor_cost,machine_cost,scrap_cost,overhead_cost,
       total_cost,revenue,gross_margin,margin_pct,tons_delivered,cost_per_ton,confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(calc.order_id, calc.material_cost, calc.labor_cost, calc.machine_cost,
           calc.scrap_cost, calc.overhead_cost, calc.total_cost, calc.revenue,
           calc.gross_margin, calc.margin_pct, calc.tons_delivered, calc.cost_per_ton, calc.confidence);
    existing = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  }
  res.json(existing);
});

// POST /api/orders/:id/costs/recalculate
router.post('/orders/:id/costs/recalculate', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const orderId = Number(req.params.id);
  const locked = db.prepare('SELECT locked FROM order_costs WHERE order_id=?').get(orderId);
  if (locked && locked.locked) return res.status(403).json({ error: 'עלויות נעולות – נדרש מנהל לביטול הנעילה' });

  const calc = calculateOrderCost(orderId);
  if (!calc) return res.status(404).json({ error: 'הזמנה לא נמצאה' });

  // Snapshot before overwrite
  const prev = db.prepare('SELECT * FROM order_costs WHERE order_id=?').get(orderId);
  if (prev) {
    db.prepare('INSERT INTO cost_snapshots (order_id,snapshot,reason,created_by) VALUES (?,?,?,?)')
      .run(orderId, JSON.stringify(prev), req.body.reason || 'חישוב מחדש', req.headers['x-user'] || 'system');
  }

  db.prepare(`INSERT OR REPLACE INTO order_costs
    (order_id,material_cost,labor_cost,machine_cost,scrap_cost,overhead_cost,
     total_cost,revenue,gross_margin,margin_pct,tons_delivered,cost_per_ton,confidence,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(calc.order_id, calc.material_cost, calc.labor_cost, calc.machine_cost,
         calc.scrap_cost, calc.overhead_cost, calc.total_cost, calc.revenue,
         calc.gross_margin, calc.margin_pct, calc.tons_delivered, calc.cost_per_ton, calc.confidence);

  wsBroadcast('cost_update', { orderId, margin_pct: calc.margin_pct, gross_margin: calc.gross_margin });
  res.json({ ...calc, recalculated: true });
});

// PATCH /api/orders/:id/costs/lock
router.patch('/orders/:id/costs/lock', requireRole('manager'), (req, res) => {
  const { lock, reason } = req.body;
  const user = req.headers['x-user'] || 'מנהל';
  db.prepare(`UPDATE order_costs SET locked=?,locked_by=?,locked_at=datetime('now'),notes=? WHERE order_id=?`)
    .run(lock ? 1 : 0, lock ? user : null, reason || '', req.params.id);
  db.prepare('INSERT INTO financial_events (event_type,entity_type,entity_id,description,created_by) VALUES (?,?,?,?,?)')
    .run(lock ? 'cost_locked' : 'cost_unlocked', 'order', Number(req.params.id), reason || '', user);
  res.json({ success: true, locked: !!lock });
});

// GET /api/orders/:id/costs/snapshots
router.get('/orders/:id/costs/snapshots', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const snaps = db.prepare('SELECT * FROM cost_snapshots WHERE order_id=? ORDER BY created_at DESC LIMIT 20')
    .all(req.params.id);
  res.json(snaps.map(s => ({ ...s, snapshot: JSON.parse(s.snapshot) })));
});

  return router;
};

module.exports.manifest = {
  screens: [],
  access: { default: 'hidden', roles: { admin: 'edit' } },
  id: 'finance-costs',
  label: 'עלויות ומרווח',
  consumes: [{ table: 'orders' }, { table: 'items' }],
  produces: [{ event: 'cost_update' }],
};
