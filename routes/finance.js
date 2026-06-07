const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/finance missing dependency: ${name}`);
  return value;
}

module.exports = function createFinanceRouter(deps) {
  const db              = required('db',              deps.db);
  const requireAnyRole  = required('requireAnyRole',  deps.requireAnyRole);
  const requireRole     = required('requireRole',     deps.requireRole);
  const wsBroadcast     = required('wsBroadcast',     deps.wsBroadcast);
  const industry = required('industry', deps.industry);
  const settingsService = required('settingsService', deps.settingsService);


// ── FINANCIAL MARGIN ──────────────────────────────────────────────
router.get('/orders/:id/margin', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const order = db.prepare(`SELECT o.*, c.price_tier, c.discount_pct FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not found' });

  // Cost of steel: use steel_price_history (latest per diameter) × weight per diameter
  const itemsByDiam = db.prepare(`
    SELECT i.diameter, SUM(i.total_weight) as total_weight
    FROM items i JOIN pallets p ON i.pallet_id=p.id
    WHERE p.order_id=?
    GROUP BY i.diameter
  `).all(req.params.id);

  let cost_material = 0;
  for (const row of itemsByDiam) {
    const price = db.prepare(`SELECT price_per_ton FROM steel_price_history WHERE diameter=? ORDER BY effective_date DESC LIMIT 1`).get(row.diameter);
    if (price) cost_material += (row.total_weight / 1000) * price.price_per_ton;
  }

  // Fallback: use price_list if no steel price history
  if (cost_material === 0) {
    for (const row of itemsByDiam) {
      const pl = db.prepare('SELECT price_list FROM price_list WHERE diameter=?').get(row.diameter);
      if (pl) cost_material += (row.total_weight) * pl.price_list; // price_list is ₪/kg
    }
  }

  const sale_price = order.sale_price || order.portal_price || 0;
  const cost_labor = order.cost_labor || 0;
  const total_cost = cost_material + cost_labor;
  const gross_profit = sale_price - total_cost;
  const margin_pct = sale_price > 0 ? Math.round(gross_profit / sale_price * 100) : 0;

  res.json({
    order_id: order.id, order_num: order.order_num,
    cost_material: Math.round(cost_material), cost_labor,
    total_cost: Math.round(total_cost), sale_price,
    gross_profit: Math.round(gross_profit), margin_pct
  });
});

// ── INVENTORY FORECAST ────────────────────────────────────────────
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

// ── CUSTOMER LEDGER ────────────────────────────────────────────

// GET /api/customers/:id/ledger
router.get('/customers/:id/ledger', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const customerId = Number(req.params.id);
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'לקוח לא נמצא' });

  // All orders for this customer
  const orders = db.prepare(`
    SELECT o.*, oc.total_cost, oc.revenue, oc.gross_margin, oc.margin_pct, oc.tons_delivered
    FROM orders o
    LEFT JOIN order_costs oc ON o.id=oc.order_id
    WHERE o.customer_id=?
    ORDER BY o.created_at DESC
  `).all(customerId);

  // Credit info
  let credit = db.prepare('SELECT * FROM customer_credit WHERE customer_id=?').get(customerId);
  if (!credit) {
    // auto-create default
    db.prepare('INSERT OR IGNORE INTO customer_credit (customer_id,credit_limit,payment_terms) VALUES (?,?,?)')
      .run(customerId, 100000, 30);
    credit = db.prepare('SELECT * FROM customer_credit WHERE customer_id=?').get(customerId);
  }

  // Calculate open debt from unpaid invoices
  const openInvoices = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total
    FROM invoices WHERE customer_id=? AND status NOT IN ('שולמה','ביטול')
  `).get(customerId);
  const open_debt = openInvoices ? openInvoices.total : 0;

  // WIP value (orders in production)
  const wipOrders = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(oc.total_cost),0) as val
    FROM orders o LEFT JOIN order_costs oc ON o.id=oc.order_id
    WHERE o.customer_id=? AND o.status IN ('בייצור','ממתין','מאושר')
  `).get(customerId);
  const wip_value = wipOrders ? wipOrders.val : 0;

  // Totals
  const totalRevenue  = orders.reduce((s, o) => s + (o.revenue || 0), 0);
  const totalCost     = orders.reduce((s, o) => s + (o.total_cost || 0), 0);
  const totalMargin   = totalRevenue - totalCost;
  const avgMarginPct  = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;
  const totalTons     = orders.reduce((s, o) => s + (o.tons_delivered || 0), 0);

  // Update credit record
  db.prepare(`UPDATE customer_credit SET open_debt=?,wip_value=?,total_exposure=?,updated_at=datetime('now') WHERE customer_id=?`)
    .run(open_debt, wip_value, open_debt + wip_value, customerId);

  const total_exposure = open_debt + wip_value;
  const credit_available = Math.max(0, (credit.credit_limit || 0) - total_exposure);
  const credit_pct = credit.credit_limit > 0 ? (total_exposure / credit.credit_limit) * 100 : 0;
  const credit_alert = credit_pct >= 90 ? 'critical' : credit_pct >= 70 ? 'warning' : 'ok';

  res.json({
    customer,
    credit: { ...credit, open_debt, wip_value, total_exposure, credit_available, credit_pct, credit_alert },
    summary: { total_orders: orders.length, totalRevenue, totalCost, totalMargin, avgMarginPct, totalTons },
    orders
  });
});

// PATCH /api/customers/:id/credit
router.patch('/customers/:id/credit', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const { credit_limit, payment_terms, notes } = req.body;
  db.prepare(`INSERT OR REPLACE INTO customer_credit (customer_id,credit_limit,payment_terms,notes,updated_at)
    VALUES (?,?,?,?,datetime('now'))`).run(req.params.id, credit_limit, payment_terms || 30, notes || '');
  res.json({ success: true });
});

// ── STEEL PRICES (use existing steel_price_history endpoint) ──
// Note: POST /api/steel-prices is handled by existing endpoint at line ~3059

// ── FINANCIAL DASHBOARD KPIs ──────────────────────────────────

router.get('/finance/kpis', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const { period } = req.query; // 'week', 'month', 'quarter'
  const daysBack = period === 'quarter' ? 90 : period === 'week' ? 7 : 30;
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0,10);

  // Revenue & margin
  const costSummary = db.prepare(`
    SELECT
      COALESCE(SUM(oc.revenue),0)       as total_revenue,
      COALESCE(SUM(oc.total_cost),0)    as total_cost,
      COALESCE(SUM(oc.gross_margin),0)  as total_margin,
      COALESCE(SUM(oc.tons_delivered),0) as total_tons,
      COUNT(*)                           as order_count,
      COALESCE(AVG(oc.margin_pct),0)    as avg_margin_pct
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    WHERE o.created_at >= ?
  `).get(since);

  // Unpaid invoices
  const unpaid = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as cnt
    FROM invoices WHERE status NOT IN ('שולמה','ביטול')
  `).get();

  // Overdue
  const overdue = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as cnt
    FROM invoices WHERE status NOT IN ('שולמה','ביטול') AND due_date < date('now')
  `).get();

  // Top 5 customers by revenue
  const topCustomers = db.prepare(`
    SELECT c.name, COALESCE(SUM(oc.revenue),0) as revenue,
           COALESCE(SUM(oc.gross_margin),0) as margin,
           COALESCE(AVG(oc.margin_pct),0) as margin_pct
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    JOIN customers c ON c.id=o.customer_id
    WHERE o.created_at >= ?
    GROUP BY c.id ORDER BY revenue DESC LIMIT 5
  `).all(since);

  // Latest steel price
  const latestPrice = db.prepare('SELECT price_per_ton, effective_date FROM steel_price_history ORDER BY effective_date DESC, id DESC LIMIT 1').get();

  // Orders with margin < 5% (warning)
  const lowMargin = db.prepare(`
    SELECT o.order_num, c.name as customer, oc.margin_pct, oc.gross_margin
    FROM order_costs oc
    JOIN orders o ON o.id=oc.order_id
    JOIN customers c ON c.id=o.customer_id
    WHERE oc.revenue > 0 AND oc.margin_pct < 5 AND o.status NOT IN ('בוטל','הושלם')
    ORDER BY oc.margin_pct ASC LIMIT 10
  `).all();

  res.json({
    period: { days: daysBack, since },
    summary: costSummary,
    receivables: { unpaid: unpaid?.total || 0, unpaid_count: unpaid?.cnt || 0,
                   overdue: overdue?.total || 0, overdue_count: overdue?.cnt || 0 },
    steel_price: latestPrice,
    top_customers: topCustomers,
    low_margin_orders: lowMargin
  });
});

// ── FINANCIAL EVENTS LOG ──────────────────────────────────────


router.get('/finance/events', requireAnyRole(['finance', 'manager', 'admin']), (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const events = db.prepare('SELECT * FROM financial_events ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(Number(limit), Number(offset));
  res.json(events);
});

// ── Admin Database Migration (Cloud Upload/Download) ──────────────
// Download active database backup — BUG-20: admin only
  return router;
};
