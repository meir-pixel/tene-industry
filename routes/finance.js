const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/finance missing dependency: ${name}`);
  return value;
}

module.exports = function createFinanceRouter(deps) {
  const db              = required('db',              deps.db);
  const requireAnyRole  = required('requireAnyRole',  deps.requireAnyRole);


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
  const missingPurchasePriceDiameters = [];
  for (const row of itemsByDiam) {
    const price = db.prepare(`SELECT price_per_ton FROM steel_price_history WHERE diameter=? ORDER BY effective_date DESC LIMIT 1`).get(row.diameter);
    if (price && Number(price.price_per_ton) > 0) {
      cost_material += (row.total_weight / 1000) * price.price_per_ton;
    } else {
      missingPurchasePriceDiameters.push(Number(row.diameter));
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
    gross_profit: Math.round(gross_profit), margin_pct,
    cost_basis: missingPurchasePriceDiameters.length ? 'purchase_price_missing' : 'purchase_price',
    cost_basis_missing: missingPurchasePriceDiameters.length > 0,
    missing_purchase_price_diameters: missingPurchasePriceDiameters
  });
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

module.exports.manifest = {
  "id": "finance",
  "label": "Finance",
  "consumes": [
    {
      "table": "orders"
    },
    {
      "table": "invoices"
    }
  ],
  "produces": []
};
