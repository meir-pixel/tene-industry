const router = require('express').Router();

function required(name, value) {
  if (!value) throw new Error(`routes/reports missing dependency: ${name}`);
  return value;
}

module.exports = function createReportsRouter(deps) {
  const db = required('db', deps.db);
  const requireRole = required('requireRole', deps.requireRole);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const statusContracts = required('statusContracts', deps.statusContracts);
  const ai = required('ai', deps.ai);

  router.get('/dashboard', requireRole('viewer'), (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const doneItemStatus = statusContracts.ITEM_STATUS.DONE;
    const completedOrderStatus = statusContracts.ORDER_STATUS.DONE_WAITING_PICKUP;
    const wasteData = db.prepare(`
      SELECT SUM(actual_waste) as totalWaste, SUM(quantity) as totalQty,
             COUNT(*) as completedItems
      FROM items WHERE DATE(completed_at)=? AND status=?
    `).get(today, doneItemStatus);

    const productionToday = db.prepare(`
      SELECT COUNT(*) as completedItems,
             COALESCE(SUM(total_weight),0) as producedWeightToday,
             COALESCE(SUM(total_weight),0)/1000 as producedTonsToday
      FROM items
      WHERE DATE(completed_at)=? AND status=?
    `).get(today, doneItemStatus);

    const wasteByMachine = db.prepare(`
      SELECT i.machine, SUM(i.actual_waste) as waste, SUM(i.quantity) as qty
      FROM items i WHERE DATE(i.completed_at)=? AND i.status=?
      GROUP BY i.machine
    `).all(today, doneItemStatus);

    res.json({
      ordersToday:      db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=?").get(today).c,
      completedOrdersToday: db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status=?").get(today, completedOrderStatus).c,
      completedToday:   productionToday.completedItems || 0,
      inProduction:     db.prepare("SELECT COUNT(*) as c FROM orders WHERE status=?").get(statusContracts.ORDER_STATUS.IN_PRODUCTION).c,
      pending:          db.prepare("SELECT COUNT(*) as c FROM orders WHERE status=?").get(statusContracts.ORDER_STATUS.PENDING_APPROVAL).c,
      urgentOpen:       db.prepare("SELECT COUNT(*) as c FROM orders WHERE priority='דחוף' AND status NOT IN (?,?)").get(statusContracts.ORDER_STATUS.DELIVERED_CONFIRMED, statusContracts.ORDER_STATUS.CANCELLED).c,
      totalWeightToday: db.prepare("SELECT SUM(total_weight) as w FROM orders WHERE DATE(created_at)=?").get(today).w || 0,
      producedWeightToday: productionToday.producedWeightToday || 0,
      producedTonsToday: Math.round((productionToday.producedTonsToday || 0) * 10) / 10,
      itemsInProduction:db.prepare("SELECT COUNT(*) as c FROM items WHERE status=?").get(statusContracts.ITEM_STATUS.IN_PRODUCTION).c,
      itemsDone:        productionToday.completedItems || 0,
      wasteAvgPct:      wasteData.totalQty > 0 ? ((wasteData.totalWaste / wasteData.totalQty) * 100).toFixed(1) : '0',
      wasteByMachine,
      recentOrders:     db.prepare(`SELECT o.*,c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id ORDER BY o.created_at DESC LIMIT 10`).all(),
      machines:         db.prepare('SELECT * FROM machines ORDER BY id').all(),
    });
  });



  router.get('/reports/summary', requireAnyRole(['office', 'finance', 'manager', 'admin']), (req, res) => {
    const { from, to } = req.query;
    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];

    res.json({
      period: { from: fromDate, to: toDate },
      orders: db.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total_weight) as weight
        FROM orders WHERE DATE(created_at) BETWEEN ? AND ?
        GROUP BY DATE(created_at) ORDER BY date
      `).all(fromDate, toDate),
      byStatus: db.prepare(`
        SELECT status, COUNT(*) as count FROM orders
        WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status
      `).all(fromDate, toDate),
      waste: ai.analyzeWastePatterns(),
      machineEfficiency: ai.getMachineEfficiency(30),
      topCustomers: db.prepare(`
        SELECT c.name, COUNT(o.id) as order_count, SUM(o.billing_weight) as total_weight
        FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
        WHERE DATE(o.created_at) BETWEEN ? AND ?
        GROUP BY o.customer_id ORDER BY total_weight DESC LIMIT 10
      `).all(fromDate, toDate),
    });
  });


  router.get('/reports/waste', requireAnyRole(['production', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    const { from, to } = req.query;
    const rows = db.prepare(`
      SELECT i.machine, i.diameter, i.shape_name,
             SUM(i.actual_waste) as total_waste, SUM(i.quantity) as total_ordered,
             ROUND(100.0 * SUM(i.actual_waste) / MAX(SUM(i.quantity),1), 1) as waste_pct,
             COUNT(*) as item_count
      FROM items i
      WHERE i.status='הושלם'
        ${from ? "AND DATE(i.completed_at) >= '" + from + "'" : ''}
        ${to   ? "AND DATE(i.completed_at) <= '" + to + "'"   : ''}
      GROUP BY i.machine, i.diameter, i.shape_name
      ORDER BY waste_pct DESC
    `).all();
    res.json(rows);
  });

  router.get('/waste/summary', requireAnyRole(['production', 'office', 'finance', 'manager', 'admin']), (req, res) => {
    const { from, to } = req.query;
    const fromDate = from || new Date(Date.now()-30*86400000).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];
    res.json({
      period: { from:fromDate, to:toDate },
      byDiameter: db.prepare('SELECT i.diameter,SUM(i.quantity) as items_produced,SUM(i.total_weight) as net_weight,SUM(i.actual_waste) as actual_waste_g,ROUND(AVG(CAST(i.actual_waste AS REAL)/NULLIF(i.total_length_mm,0)*100),2) as waste_pct FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 GROUP BY i.diameter ORDER BY i.diameter').all(fromDate,toDate),
      topWaste: db.prepare('SELECT o.order_num,i.diameter,i.actual_waste,i.total_weight AS weight,i.shape_name FROM items i JOIN pallets p ON i.pallet_id=p.id JOIN orders o ON p.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? AND i.actual_waste>0 ORDER BY i.actual_waste DESC LIMIT 20').all(fromDate,toDate),
      rawMaterial: db.prepare('SELECT diameter,SUM(weight_scrapped) as total_scrapped,SUM(weight_received) as total_received,ROUND(100.0*SUM(weight_scrapped)/NULLIF(SUM(weight_received),0),1) as scrap_pct FROM raw_material GROUP BY diameter ORDER BY diameter').all(),
    });
  });


  router.get('/kpi/monthly', requireAnyRole(['office', 'finance', 'manager', 'admin']), (req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().slice(0,10);
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0,10);

    const cur = db.prepare(`
      SELECT
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(o.total_weight),0) as total_weight_kg,
        COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue,
        COALESCE(SUM(CASE WHEN o.cost_material>0 THEN o.cost_material ELSE 0 END),0) as cost_material,
        COALESCE(SUM(CASE WHEN o.cost_labor>0 THEN o.cost_labor ELSE 0 END),0) as cost_labor,
        SUM(CASE WHEN o.status='הושלם' OR o.status='סופק' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN o.status='בייצור' THEN 1 ELSE 0 END) as in_production,
        SUM(CASE WHEN o.status='ממתינה לאישור' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN o.priority='דחוף' AND o.status NOT IN ('הושלם','סופק') THEN 1 ELSE 0 END) as urgent_open
      FROM orders o
      WHERE DATE(o.created_at) >= ?
    `).get(monthStart);

    const prev = db.prepare(`
      SELECT
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(o.total_weight),0) as total_weight_kg,
        COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN ? AND ?
    `).get(prevMonthStart, prevMonthEnd);

    const topCustomers = db.prepare(`
      SELECT c.name, COUNT(o.id) as orders, COALESCE(SUM(o.total_weight),0) as total_weight_kg,
        COALESCE(SUM(CASE WHEN o.sale_price>0 THEN o.sale_price ELSE 0 END),0) as revenue
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE DATE(o.created_at) >= ?
      GROUP BY c.id, c.name
      ORDER BY total_weight_kg DESC
      LIMIT 5
    `).all(monthStart);

    const tonsMonth = (cur.total_weight_kg || 0) / 1000;
    const revenue   = cur.revenue || 0;
    const cost      = (cur.cost_material || 0) + (cur.cost_labor || 0);
    const margin    = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;

    res.json({
      month: now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }),
      current: { ...cur, tons: Math.round(tonsMonth * 10) / 10, revenue, cost, margin },
      prev: { ...prev, tons: Math.round((prev.total_weight_kg||0) / 100) / 10 },
      topCustomers
    });
  });



  function toCSV(rows, cols) {
    const header = cols.map(c => c.label).join(',');
    const lines = rows.map(r => cols.map(c => {
      const v = r[c.key] ?? '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(','));
    return '﻿' + [header, ...lines].join('\r\n'); // BOM for Hebrew Excel
  }

  router.get('/export/orders', requireAnyRole(['office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT o.order_num, c.name as customer, o.delivery_date, o.status, o.total_weight,
             o.priority, o.channel, o.created_at
      FROM orders o LEFT JOIN customers c ON o.customer_id=c.id
      ORDER BY o.created_at DESC LIMIT 5000
    `).all();
    const cols = [
      { key:'order_num',    label:'מספר הזמנה' },
      { key:'customer',     label:'לקוח' },
      { key:'delivery_date',label:'תאריך אספקה' },
      { key:'status',       label:'סטטוס' },
      { key:'total_weight', label:'משקל (ק"ג)' },
      { key:'priority',     label:'עדיפות' },
      { key:'channel',      label:'ערוץ' },
      { key:'created_at',   label:'נוצרה' },
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send(toCSV(rows, cols));
  });

  router.get('/export/packages', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT pk.package_code, pk.order_num, pk.status, pk.weight, pk.diameter, pk.zone, pk.packed_at, pk.shipped_at
      FROM packages pk ORDER BY pk.packed_at DESC LIMIT 5000
    `).all();
    const cols = [
      { key:'package_code', label:'קוד חבילה' },
      { key:'order_num',    label:'מספר הזמנה' },
      { key:'status',       label:'סטטוס' },
      { key:'weight',       label:'משקל (ק"ג)' },
      { key:'diameter',     label:'קוטר' },
      { key:'zone',         label:'אזור מחסן' },
      { key:'packed_at',    label:'תאריך אריזה' },
      { key:'shipped_at',   label:'תאריך משלוח' },
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="packages.csv"');
    res.send(toCSV(rows, cols));
  });

  router.get('/export/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const rows = db.prepare(`
      SELECT r.material_type, r.diameter, s.name as supplier, r.lot_number, r.certificate_num,
             r.grade, r.received_date, r.weight_received, r.weight_used, r.warehouse_loc
      FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id
      ORDER BY r.received_date DESC LIMIT 5000
    `).all();
    const cols = [
      { key:'material_type',   label:'סוג חומר' },
      { key:'diameter',        label:'קוטר (mm)' },
      { key:'supplier',        label:'ספק' },
      { key:'lot_number',      label:'מספר אצווה' },
      { key:'certificate_num', label:'תעודת חומר' },
      { key:'grade',           label:'איכות פלדה' },
      { key:'received_date',   label:'תאריך קבלה' },
      { key:'weight_received', label:'משקל שהתקבל (ק"ג)' },
      { key:'weight_used',     label:'משקל שנצרך (ק"ג)' },
      { key:'warehouse_loc',   label:'מיקום במחסן' },
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
    res.send(toCSV(rows, cols));
  });



  // Convert parsed BVBS data to an IronBend order


  return router;
};
