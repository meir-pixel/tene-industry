const express = require('express');
const cors    = require('cors');
const Database = require('better-sqlite3');
const path    = require('path');
const http    = require('http');
const { WebSocketServer } = require('ws');
const modbus  = require('./modbus');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });
const PORT   = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('ironbend.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    priority_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_num TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    channel TEXT DEFAULT 'טלפון',
    delivery_date TEXT,
    delivery_time TEXT,
    delivery_address TEXT,
    priority TEXT DEFAULT 'רגיל',
    status TEXT DEFAULT 'ממתינה לאישור',
    total_weight REAL DEFAULT 0,
    waste_pct_charged REAL DEFAULT 3,
    billing_weight REAL DEFAULT 0,
    driver_notes TEXT,
    general_notes TEXT,
    priority_order_id TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS pallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    pallet_num INTEGER,
    max_weight REAL DEFAULT 500,
    total_weight REAL DEFAULT 0,
    status TEXT DEFAULT 'ממתין',
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pallet_id INTEGER,
    shape_id TEXT,
    shape_name TEXT,
    diameter REAL,
    segments JSON,
    total_length_mm REAL DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    production_qty INTEGER DEFAULT 0,
    weight_per_unit REAL DEFAULT 0,
    total_weight REAL DEFAULT 0,
    struct_element TEXT,
    struct_floor TEXT,
    sheet_num TEXT,
    machine TEXT,
    status TEXT DEFAULT 'ממתין',
    started_at DATETIME,
    completed_at DATETIME,
    worker_id INTEGER,
    produced_qty INTEGER DEFAULT 0,
    actual_waste INTEGER DEFAULT 0,
    note TEXT,
    FOREIGN KEY (pallet_id) REFERENCES pallets(id)
  );

  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    label TEXT,
    port TEXT,
    slave_id INTEGER DEFAULT 1,
    min_diameter REAL DEFAULT 8,
    max_diameter REAL DEFAULT 12,
    status TEXT DEFAULT 'לא מחובר',
    current_order_num TEXT,
    current_item_id INTEGER,
    counter INTEGER DEFAULT 0,
    last_seen DATETIME
  );

  CREATE TABLE IF NOT EXISTS shapes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bends INTEGER DEFAULT 0,
    sides_default JSON,
    angles_default JSON,
    emoji TEXT DEFAULT '⬡',
    description TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'ייצור',
    language TEXT DEFAULT 'he',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER,
    worker_id INTEGER,
    item_id INTEGER,
    order_num TEXT,
    action TEXT,
    counter_at_scan INTEGER DEFAULT 0,
    waste_calculated INTEGER DEFAULT 0,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── MIGRATIONS (safe column additions) ────────────────────────────
function addCol(table, col, def) {
  const cols = db.pragma(`table_info(${table})`).map(c => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`[DB] Migration: ${table}.${col} added`);
  }
}
addCol('customers',  'email',              'TEXT');
addCol('customers',  'notes',              'TEXT');
addCol('orders',     'waste_pct_charged',  'REAL DEFAULT 3');
addCol('orders',     'billing_weight',     'REAL DEFAULT 0');
addCol('orders',     'priority_order_id',  'TEXT');
addCol('orders',     'created_by',         'INTEGER');
addCol('pallets',    'status',             "TEXT DEFAULT 'ממתין'");
addCol('items',      'segments',           'JSON');
addCol('items',      'total_length_mm',    'REAL DEFAULT 0');
addCol('items',      'production_qty',     'INTEGER DEFAULT 0');
addCol('items',      'weight_per_unit',    'REAL DEFAULT 0');
addCol('items',      'actual_waste',       'INTEGER DEFAULT 0');
addCol('items',      'worker_id',          'INTEGER');
addCol('machines',   'label',              'TEXT');
addCol('machines',   'slave_id',           'INTEGER DEFAULT 1');
addCol('machines',   'min_diameter',       'REAL DEFAULT 8');
addCol('machines',   'max_diameter',       'REAL DEFAULT 12');

// ── SEED MACHINES (A/B/C/D) ───────────────────────────────────────
db.exec(`
  INSERT OR IGNORE INTO machines (id, name, label, slave_id, min_diameter, max_diameter, port) VALUES
    (1, 'מכונה A – XINJE', 'A', 1,  8, 12, 'COM3'),
    (2, 'מכונה B – XINJE', 'B', 2, 14, 20, 'COM4'),
    (3, 'מכונה C – MEP',   'C', 3,  8, 20, 'COM5'),
    (4, 'מכונה D – עתידי', 'D', 4, 20, 40, 'COM6');
`);
// Update labels on existing rows
db.exec(`
  UPDATE machines SET label='A', slave_id=1, min_diameter=8,  max_diameter=12 WHERE id=1 AND label IS NULL;
  UPDATE machines SET label='B', slave_id=2, min_diameter=14, max_diameter=20 WHERE id=2 AND label IS NULL;
`);

// ── SEED SHAPES ──────────────────────────────────────────────────
const shapeCount = db.prepare('SELECT COUNT(*) as c FROM shapes').get().c;
if (shapeCount === 0) {
  const insertShape = db.prepare(`INSERT OR IGNORE INTO shapes (id, name, bends, sides_default, angles_default, emoji, description) VALUES (?,?,?,?,?,?,?)`);
  const shapes = [
    ['s1',  'ישר',           0, '[1000]',                         '[]',                     '➖', 'ברזל ישר ללא כיפופים'],
    ['s2',  'L – זווית',     1, '[500,200]',                      '[90]',                   '⌐',  'כיפוף L בקצה'],
    ['s3',  'U – אנקר',      2, '[300,600,300]',                  '[90,90]',                '∪',  'צורת U – עוגן סרגל'],
    ['s4',  'Z – הזזה',      2, '[300,400,300]',                  '[135,135]',              'Z',  'כיפוף Z'],
    ['s5',  'S – כפול',      3, '[200,300,300,200]',              '[135,135,135]',          'S',  'כיפוף S כפול'],
    ['s6',  'אוברל – קרס',   3, '[200,400,400,200]',              '[90,180,90]',            '⎡',  'אוברל עם קרסים'],
    ['s7',  'אסדה פתוחה',    3, '[200,500,500,200]',              '[90,90,90]',             '⬓',  'צורת C פתוחה'],
    ['s8',  'מלבן – אצבה',   4, '[400,200,400,200]',              '[90,90,90,90]',          '□',  'כוש מלבני (Stirrup)'],
    ['s9',  'ריבוע – אצבה',  4, '[300,300,300,300]',              '[90,90,90,90]',          '◻',  'כוש מרובע (Stirrup)'],
    ['s10', 'חמישה כיפופים', 5, '[150,200,400,200,400,150]',      '[90,90,90,90,90]',       '⌂',  'צורה מורכבת 5 כיפופים'],
    ['s11', 'ששה כיפופים',   6, '[150,150,400,150,400,150,150]', '[90,90,90,90,90,90]',    '⬡',  'צורה מורכבת 6 כיפופים'],
    ['s12', 'מותאם אישית',   0, '[500]',                          '[]',                     '✏️', 'צורה מותאמת אישית'],
  ];
  for (const s of shapes) insertShape.run(...s);
  console.log('[DB] Shapes seeded');
}

// ── SEED WORKERS ──────────────────────────────────────────────────
const workerCount = db.prepare('SELECT COUNT(*) as c FROM workers').get().c;
if (workerCount === 0) {
  db.exec(`INSERT INTO workers (name, role, language) VALUES ('מנהל','מנהל','he'),('עובד 1','ייצור','he'),('עובד 2','ייצור','th')`);
}

// ── WEBSOCKET ─────────────────────────────────────────────────────
function wsBroadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'machines_state', data: modbus.getAllState() }));
});

modbus.onUpdate((machineId, state) => {
  db.prepare(`UPDATE machines SET status=?, counter=?, last_seen=? WHERE id=?`)
    .run(state.status, state.counter, state.lastSeen, machineId);
  const machine = db.prepare('SELECT current_item_id FROM machines WHERE id=?').get(machineId);
  if (machine?.current_item_id) {
    db.prepare('UPDATE items SET produced_qty=? WHERE id=?').run(state.counter, machine.current_item_id);
  }
  wsBroadcast('machine_update', state);
});

// modbus.startPolling(5000); // uncomment when hardware connected

// ── HELPERS ──────────────────────────────────────────────────────
function calcWeightPerUnit(diameter, totalLengthMm) {
  const WEIGHTS = { 6:0.222,8:0.395,10:0.617,12:0.888,14:1.21,16:1.58,18:2.00,20:2.47,22:2.98,25:3.85,28:4.83,32:6.31,36:7.99,40:9.86 };
  const kgPerM = WEIGHTS[diameter] ?? (diameter * diameter * 0.00617);
  return (totalLengthMm / 1000) * kgPerM;
}

function generateOrderNum() {
  const year  = new Date().getFullYear();
  const count = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  return `HZ-${year}-${String(count + 1).padStart(3, '0')}`;
}

function checkOrderComplete(orderId) {
  const pending = db.prepare(`
    SELECT COUNT(*) as c FROM items i
    JOIN pallets p ON i.pallet_id = p.id
    WHERE p.order_id = ? AND i.status != 'הושלם'
  `).get(orderId);
  if (pending.c === 0) {
    db.prepare("UPDATE orders SET status='הושלם – ממתין לאיסוף' WHERE id=?").run(orderId);
    const o = db.prepare('SELECT order_num FROM orders WHERE id=?').get(orderId);
    wsBroadcast('order_complete', { orderId, orderNum: o?.order_num });
  }
}

// ── ROUTES ────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── CUSTOMERS ─────────────────────────────────────────────────────
app.get('/api/customers', (req, res) => {
  const q = req.query.q || '';
  res.json(db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR priority_id LIKE ? ORDER BY name LIMIT 20`)
    .all(`%${q}%`, `%${q}%`, `%${q}%`));
});

app.get('/api/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.orders = db.prepare('SELECT id,order_num,status,created_at,total_weight FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 10').all(c.id);
  res.json(c);
});

app.post('/api/customers', (req, res) => {
  const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'שם חובה' });
  const r = db.prepare(`INSERT INTO customers (name,phone,email,address,contact_name,contact_phone,priority_id,notes) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, phone, email, address, contactName, contactPhone, priorityId, notes);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/customers/:id', (req, res) => {
  const { name, phone, email, address, contactName, contactPhone, priorityId, notes } = req.body;
  db.prepare(`UPDATE customers SET name=?,phone=?,email=?,address=?,contact_name=?,contact_phone=?,priority_id=?,notes=? WHERE id=?`)
    .run(name, phone, email, address, contactName, contactPhone, priorityId, notes, req.params.id);
  res.json({ success: true });
});

// ── ORDERS ────────────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const { status, date, priority } = req.query;
  let sql = `SELECT o.*, c.name as customer_name, c.phone as customer_phone
             FROM orders o LEFT JOIN customers c ON o.customer_id = c.id`;
  const params = [], where = [];
  if (status)   { where.push('o.status = ?');          params.push(status); }
  if (date)     { where.push('DATE(o.delivery_date)=?'); params.push(date); }
  if (priority) { where.push('o.priority = ?');         params.push(priority); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
  order.pallets = pallets;
  res.json(order);
});

app.post('/api/orders', (req, res) => {
  const { customer, order, pallets } = req.body;

  let customerId;
  const existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(customer.phone);
  if (existing) {
    customerId = existing.id;
    db.prepare('UPDATE customers SET name=?,address=?,contact_name=?,contact_phone=? WHERE id=?')
      .run(customer.name, customer.address, customer.contactName, customer.contactPhone, customerId);
  } else {
    const r = db.prepare('INSERT INTO customers (name,phone,address,contact_name,contact_phone) VALUES (?,?,?,?,?)')
      .run(customer.name, customer.phone, customer.address, customer.contactName, customer.contactPhone);
    customerId = r.lastInsertRowid;
  }

  const orderNum = generateOrderNum();
  const wastePct = order.wastePctCharged ?? 3;
  const totalWeight = order.totalWeight ?? 0;
  const billingWeight = totalWeight * (1 + wastePct / 100);

  const orderResult = db.prepare(`
    INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_time,delivery_address,priority,driver_notes,general_notes,total_weight,waste_pct_charged,billing_weight,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(orderNum, customerId, order.channel, order.deliveryDate, order.deliveryTime,
         order.deliveryAddress, order.priority, order.driverNotes, order.generalNotes,
         totalWeight, wastePct, billingWeight, order.createdBy || null);

  const orderId = orderResult.lastInsertRowid;

  (pallets || []).forEach((pallet, idx) => {
    const pr = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,?,?,?)')
      .run(orderId, idx + 1, pallet.maxWeight || 500, pallet.totalWeight || 0);

    (pallet.items || []).forEach(item => {
      const sides = item.sides || [];
      const totalLengthMm = sides.reduce((s, v) => s + v, 0);
      const segments = JSON.stringify(
        sides.map((len, i) => ({ length_mm: len, angle_deg: (item.angles || [])[i] ?? 0 }))
      );
      const weightPerUnit = calcWeightPerUnit(item.diameter, totalLengthMm);
      const productionQty = Math.ceil((item.qty || 1) * (1 + wastePct / 100));

      // Auto-assign machine by diameter
      let machine = 'A';
      if (item.diameter >= 14 && item.diameter <= 20) machine = 'B';
      else if (item.diameter > 20) machine = 'D';

      db.prepare(`INSERT INTO items (pallet_id,shape_id,shape_name,diameter,segments,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,note,struct_element,struct_floor,sheet_num,machine)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pr.lastInsertRowid, item.shapeId, item.shapeName, item.diameter,
             segments, totalLengthMm, item.qty || 1, productionQty,
             weightPerUnit, weightPerUnit * (item.qty || 1),
             item.note, item.structElement, item.structFloor, item.sheetNum, machine);
    });
  });

  wsBroadcast('new_order', { orderNum, orderId });
  res.json({ success: true, orderNum, orderId });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  wsBroadcast('order_status', { id: Number(req.params.id), status });
  res.json({ success: true });
});

// ── PRINT CARDS ───────────────────────────────────────────────────
app.get('/api/orders/:id/print-cards', (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?`).get(req.params.id);
  if (!order) return res.status(404).send('הזמנה לא נמצאה');

  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=? ORDER BY pallet_num').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id=? ORDER BY id').all(p.id); });
  order.pallets = pallets;

  const allItems = pallets.flatMap(p => p.items);
  const totalCards = allItems.length;

  const machineColors = { A: '#3498db', B: '#27ae60', C: '#9b59b6', D: '#e74c3c' };

  const cards = allItems.map((item, idx) => {
    const segments = tryParseJSON(item.segments, []);
    const qrData   = `${order.order_num}|${item.id}`;
    const mc       = item.machine || 'A';
    const mcColor  = machineColors[mc] || '#555';

    return `
    <div class="card" id="card-${item.id}">
      <div class="card-top-bar" style="background:${mcColor}">מכונה ${mc}</div>
      <div class="card-header">
        <div class="order-num">${order.order_num}</div>
        <div class="card-idx">${idx + 1} / ${totalCards}</div>
      </div>
      <div class="customer-name">${order.customer_name || ''}</div>
      <div class="delivery-addr">${order.delivery_address || ''}</div>
      <div class="specs-row">
        <div class="spec-box diam">Ø${item.diameter}</div>
        <div class="spec-box">אורך: ${Math.round((item.total_length_mm || 0) / 10)} ס"מ</div>
        <div class="spec-box">כמות: <strong>${item.quantity}</strong> יח'</div>
        <div class="spec-box">משקל: ${((item.total_weight || 0)).toFixed(1)} ק"ג</div>
      </div>
      ${item.struct_element ? `<div class="struct-info">איבר: ${item.struct_element}${item.struct_floor ? ' | ' + item.struct_floor : ''}${item.sheet_num ? ' | גיליון ' + item.sheet_num : ''}</div>` : ''}
      ${segments.length > 0 ? `<div class="seg-list">${segments.map((s,i) => `<span>${String.fromCharCode(65+i)}: ${s.length_mm}מ"מ${s.angle_deg ? ' / ' + s.angle_deg + '°' : ''}</span>`).join('')}</div>` : ''}
      <div class="card-body">
        <div id="qr-${item.id}" class="qr-box"></div>
        <div class="shape-area">
          <svg id="svg-${item.id}" width="90" height="70" style="overflow:visible"></svg>
        </div>
      </div>
      ${item.note ? `<div class="item-note">⚠️ ${item.note}</div>` : ''}
      <div class="card-footer">סרוק להפעלה · סריקה הבאה = סגירה</div>
    </div>`;
  });

  // Master card
  const masterCard = `
  <div class="card master-card">
    <div class="card-top-bar" style="background:#e07b39">★ כרטיסיית מאסטר</div>
    <div class="card-header">
      <div class="order-num">${order.order_num}</div>
      <div class="card-idx">מאסטר</div>
    </div>
    <div class="customer-name">${order.customer_name || ''}</div>
    <div class="delivery-addr">${order.delivery_address || ''} · ${order.delivery_date || ''}</div>
    <table class="master-table">
      <thead><tr><th>#</th><th>Ø</th><th>שם</th><th>כמות</th><th>ק"ג</th><th>✓</th></tr></thead>
      <tbody>
        ${allItems.map((item, i) => `<tr>
          <td>${i + 1}</td>
          <td>${item.diameter}</td>
          <td>${item.shape_name || ''}</td>
          <td>${item.quantity}</td>
          <td>${((item.total_weight || 0)).toFixed(1)}</td>
          <td class="check-cell">○</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="master-totals">סה"כ משקל: <strong>${((order.total_weight || 0)).toFixed(1)} ק"ג</strong> · ${pallets.length} משטחים · ${allItems.length} פריטים</div>
    <div id="qr-master" class="qr-box-center"></div>
    <div class="card-footer" style="background:#e07b39">★ כרטיסיית מאסטר – לא לאיבוד!</div>
  </div>`;

  const orderJson = JSON.stringify(order);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>כרטיסיות ייצור – ${order.order_num}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="/shape-editor.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Arial', sans-serif; background: #f0f0f0; padding: 16px; direction: rtl; }
  h2 { margin-bottom: 12px; font-size: 16px; color: #333; }
  .cards-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .card {
    width: 148mm; min-height: 105mm; background: #fff; border: 1px solid #ccc;
    border-radius: 6px; overflow: hidden; page-break-inside: avoid;
    display: flex; flex-direction: column; font-size: 11px;
  }
  .card-top-bar { padding: 4px 10px; color: #fff; font-weight: bold; font-size: 12px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 2px; }
  .order-num { font-size: 15px; font-weight: 900; color: #1a2332; }
  .card-idx { font-size: 11px; color: #666; }
  .customer-name { padding: 0 10px; font-size: 13px; font-weight: 700; color: #333; }
  .delivery-addr { padding: 1px 10px 4px; font-size: 10px; color: #666; border-bottom: 1px solid #eee; }
  .specs-row { display: flex; gap: 4px; padding: 5px 10px; flex-wrap: wrap; }
  .spec-box { background: #f5f5f5; border-radius: 4px; padding: 3px 6px; font-size: 11px; white-space: nowrap; }
  .spec-box.diam { background: #1a2332; color: #fff; font-weight: 900; font-size: 14px; }
  .struct-info { padding: 2px 10px; font-size: 10px; color: #555; background: #f9f9f9; }
  .seg-list { padding: 3px 10px; display: flex; gap: 6px; flex-wrap: wrap; font-size: 10px; color: #444; border-top: 1px solid #f0f0f0; }
  .seg-list span { background: #e8f4fd; border-radius: 3px; padding: 1px 5px; }
  .card-body { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; flex: 1; }
  .qr-box canvas, .qr-box img { width: 80px !important; height: 80px !important; }
  .qr-box-center { display: flex; justify-content: center; padding: 8px; }
  .qr-box-center canvas, .qr-box-center img { width: 80px !important; height: 80px !important; }
  .shape-area { display: flex; align-items: center; justify-content: center; flex: 1; }
  .item-note { padding: 3px 10px; background: #fff3cd; font-size: 10px; color: #856404; }
  .card-footer { padding: 4px 10px; background: #1a2332; color: #aaa; font-size: 9px; text-align: center; margin-top: auto; }
  .master-card .master-table { width: 100%; border-collapse: collapse; font-size: 10px; margin: 4px 0; }
  .master-table th, .master-table td { border: 1px solid #ddd; padding: 3px 5px; text-align: center; }
  .master-table th { background: #f0f0f0; font-weight: 700; }
  .check-cell { font-size: 14px; color: #aaa; }
  .master-totals { padding: 4px 10px; font-size: 11px; color: #333; background: #f5f5f5; }
  .print-btn { margin-bottom: 12px; padding: 10px 24px; background: #1a2332; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  @media print {
    body { background: #fff; padding: 0; }
    .print-btn, h2 { display: none; }
    .cards-grid { gap: 0; }
    .card { border: 1px solid #999; margin: 2mm; }
  }
</style>
</head>
<body>
<h2>כרטיסיות ייצור – ${order.order_num} · ${order.customer_name || ''}</h2>
<button class="print-btn" onclick="window.print()">🖨️ הדפס כרטיסיות</button>
<div class="cards-grid">
  ${masterCard}
  ${cards.join('\n')}
</div>
<script>
const order = ${orderJson};

// Generate QR codes
${allItems.map(item => `
  new QRCode(document.getElementById('qr-${item.id}'), {
    text: '${order.order_num}|${item.id}',
    width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M
  });
`).join('')}
new QRCode(document.getElementById('qr-master'), {
  text: '${order.order_num}|master', width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M
});

// Draw shape SVGs
const items = ${JSON.stringify(allItems)};
items.forEach(item => {
  try {
    const seg = typeof item.segments === 'string' ? JSON.parse(item.segments) : (item.segments || []);
    const sides = seg.map(s => s.length_mm);
    const angles = seg.map(s => s.angle_deg).slice(0, -1);
    if (sides.length < 1) return;
    const { path } = shapeSVGPath(sides, angles, 90, 70, 10);
    const svgEl = document.getElementById('svg-' + item.id);
    if (svgEl && path) {
      svgEl.innerHTML = '<path d="' + path + '" fill="none" stroke="#1a2332" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
    }
  } catch(e) {}
});
</script>
</body>
</html>`);
});

// ── SHAPES ────────────────────────────────────────────────────────
app.get('/api/shapes', (req, res) => {
  const { bends } = req.query;
  let sql = 'SELECT * FROM shapes WHERE active=1';
  const params = [];
  if (bends !== undefined) { sql += ' AND bends=?'; params.push(Number(bends)); }
  sql += ' ORDER BY bends, name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/shapes', (req, res) => {
  const { id, name, bends, sidesDefault, anglesDefault, emoji, description } = req.body;
  db.prepare(`INSERT OR REPLACE INTO shapes (id,name,bends,sides_default,angles_default,emoji,description) VALUES (?,?,?,?,?,?,?)`)
    .run(id, name, bends || 0, JSON.stringify(sidesDefault || []), JSON.stringify(anglesDefault || []), emoji || '⬡', description || '');
  res.json({ success: true });
});

// ── WORKERS ───────────────────────────────────────────────────────
app.get('/api/workers', (req, res) => {
  res.json(db.prepare('SELECT * FROM workers WHERE active=1 ORDER BY name').all());
});

app.post('/api/workers', (req, res) => {
  const { name, role, language } = req.body;
  const r = db.prepare('INSERT INTO workers (name,role,language) VALUES (?,?,?)').run(name, role || 'ייצור', language || 'he');
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/workers/:id', (req, res) => {
  const { name, role, language, active } = req.body;
  db.prepare('UPDATE workers SET name=?,role=?,language=?,active=? WHERE id=?').run(name, role, language, active ?? 1, req.params.id);
  res.json({ success: true });
});

// ── MACHINES ──────────────────────────────────────────────────────
app.get('/api/machines', (req, res) => {
  const machines = db.prepare('SELECT * FROM machines ORDER BY id').all();
  const live = modbus.getAllState();
  const merged = machines.map(m => {
    const ls = live.find(l => l.id === m.id);
    return ls ? { ...m, ...ls } : m;
  });
  res.json(merged);
});

app.post('/api/machines/:id/send-params', async (req, res) => {
  const machineId = Number(req.params.id);
  const { diameter, totalLengthMm, productionQty, angles } = req.body;
  try {
    await modbus.writeParams(machineId, { diameter, totalLengthMm, productionQty, angles: angles || [] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/machines/:id/assign', (req, res) => {
  const { itemId, orderNum } = req.body;
  db.prepare('UPDATE machines SET current_item_id=?,current_order_num=? WHERE id=?')
    .run(itemId, orderNum, req.params.id);
  db.prepare('UPDATE items SET status=?,started_at=?,machine_id=? WHERE id=?')
    .run('בייצור', new Date().toISOString(), req.params.id, itemId);
  wsBroadcast('machine_assign', { machineId: Number(req.params.id), itemId, orderNum });
  res.json({ success: true });
});

app.post('/api/machines/:id/complete', (req, res) => {
  const machineId = Number(req.params.id);
  const { producedQty } = req.body;
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
  if (!machine?.current_item_id) return res.status(400).json({ error: 'אין פריט פעיל' });

  const item       = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
  const actualWaste = Math.max(0, (producedQty || 0) - (item?.quantity || 0));

  db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
    .run('הושלם', new Date().toISOString(), producedQty, actualWaste, machine.current_item_id);
  db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineId);

  const pallet = item ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(item.pallet_id) : null;
  if (pallet) checkOrderComplete(pallet.order_id);

  wsBroadcast('machine_complete', { machineId });
  res.json({ success: true, actualWaste });
});

// ── SCAN (QR) ─────────────────────────────────────────────────────
app.post('/api/scan', (req, res) => {
  const { qrData, machineId, workerId } = req.body;
  if (!qrData || !machineId) return res.status(400).json({ error: 'חסרים פרמטרים' });

  const [orderNum, itemId] = qrData.split('|');
  const itemIdNum = Number(itemId);
  const machineIdNum = Number(machineId);

  if (isNaN(itemIdNum)) return res.status(400).json({ error: 'QR לא תקין' });

  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
  if (!machine) return res.status(404).json({ error: 'מכונה לא נמצאה' });

  const item = db.prepare(`
    SELECT i.*, p.order_id FROM items i JOIN pallets p ON i.pallet_id=p.id WHERE i.id=?
  `).get(itemIdNum);
  if (!item) return res.status(404).json({ error: 'פריט לא נמצא' });

  const now = new Date().toISOString();

  // Close previous item on this machine
  if (machine.current_item_id && machine.current_item_id !== itemIdNum) {
    const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
    const prevItem = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
    const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

    db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
      .run('הושלם', now, liveCounter, actualWaste, machine.current_item_id);

    db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
      .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'close_prev', liveCounter, actualWaste);

    const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
    if (prevPallet) checkOrderComplete(prevPallet.order_id);
  }

  // Start new item
  db.prepare('UPDATE items SET status=?,started_at=?,worker_id=? WHERE id=?')
    .run('בייצור', now, workerId, itemIdNum);
  db.prepare('UPDATE machines SET current_item_id=?,current_order_num=?,counter=0 WHERE id=?')
    .run(itemIdNum, orderNum, machineIdNum);

  // Auto-update order status to 'בייצור'
  db.prepare("UPDATE orders SET status='בייצור' WHERE id=? AND status IN ('בתור ייצור','ממתינה לאישור')")
    .run(item.order_id);

  // Send params to machine via Modbus
  const segments = tryParseJSON(item.segments, []);
  const angles   = segments.slice(1).map(s => s.angle_deg || 0);
  modbus.writeParams(machineIdNum, {
    diameter:       item.diameter,
    totalLengthMm:  item.total_length_mm,
    productionQty:  item.production_qty || item.quantity,
    angles,
  }).catch(() => {}); // non-blocking

  db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan) VALUES (?,?,?,?,?,?)')
    .run(machineIdNum, workerId, itemIdNum, orderNum, 'start', 0);

  wsBroadcast('machine_assign', { machineId: machineIdNum, itemId: itemIdNum, orderNum, workerId });

  res.json({ success: true, item, orderNum, machineLabel: machine.label });
});

// End-of-day: close last item on machine
app.post('/api/machines/:id/end-of-day', (req, res) => {
  const machineIdNum = Number(req.params.id);
  const { workerId } = req.body;
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineIdNum);
  if (!machine?.current_item_id) return res.json({ success: true, message: 'אין פריט פעיל' });

  const liveCounter = modbus.getState(machineIdNum)?.counter ?? machine.counter ?? 0;
  const prevItem    = db.prepare('SELECT * FROM items WHERE id=?').get(machine.current_item_id);
  const actualWaste = Math.max(0, liveCounter - (prevItem?.quantity || 0));

  db.prepare('UPDATE items SET status=?,completed_at=?,produced_qty=?,actual_waste=? WHERE id=?')
    .run('הושלם', new Date().toISOString(), liveCounter, actualWaste, machine.current_item_id);
  db.prepare('UPDATE machines SET current_item_id=NULL,current_order_num=NULL,counter=0 WHERE id=?').run(machineIdNum);

  db.prepare('INSERT INTO scan_log (machine_id,worker_id,item_id,order_num,action,counter_at_scan,waste_calculated) VALUES (?,?,?,?,?,?,?)')
    .run(machineIdNum, workerId, machine.current_item_id, machine.current_order_num, 'end_of_day', liveCounter, actualWaste);

  const prevPallet = prevItem ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(prevItem.pallet_id) : null;
  if (prevPallet) checkOrderComplete(prevPallet.order_id);

  wsBroadcast('end_of_day', { machineId: machineIdNum });
  res.json({ success: true, producedQty: liveCounter, actualWaste });
});

// ── DASHBOARD ─────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const wasteData = db.prepare(`
    SELECT SUM(actual_waste) as totalWaste, SUM(quantity) as totalQty,
           COUNT(*) as completedItems
    FROM items WHERE DATE(completed_at)=? AND status='הושלם'
  `).get(today);

  const wasteByMachine = db.prepare(`
    SELECT i.machine, SUM(i.actual_waste) as waste, SUM(i.quantity) as qty
    FROM items i WHERE DATE(i.completed_at)=? AND i.status='הושלם'
    GROUP BY i.machine
  `).all(today);

  res.json({
    ordersToday:      db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=?").get(today).c,
    completedToday:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status='הושלם – ממתין לאיסוף'").get(today).c,
    inProduction:     db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='בייצור'").get().c,
    pending:          db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ממתינה לאישור'").get().c,
    urgentOpen:       db.prepare("SELECT COUNT(*) as c FROM orders WHERE priority='דחוף' AND status NOT IN ('סופק – אושר','בוטל')").get().c,
    totalWeightToday: db.prepare("SELECT SUM(total_weight) as w FROM orders WHERE DATE(created_at)=?").get(today).w || 0,
    itemsInProduction:db.prepare("SELECT COUNT(*) as c FROM items WHERE status='בייצור'").get().c,
    itemsDone:        db.prepare("SELECT COUNT(*) as c FROM items WHERE DATE(completed_at)=? AND status='הושלם'").get(today).c,
    wasteAvgPct:      wasteData.totalQty > 0 ? ((wasteData.totalWaste / wasteData.totalQty) * 100).toFixed(1) : '0',
    wasteByMachine,
    recentOrders:     db.prepare(`SELECT o.*,c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id ORDER BY o.created_at DESC LIMIT 10`).all(),
    machines:         db.prepare('SELECT * FROM machines ORDER BY id').all(),
  });
});

// ── REPORTS ───────────────────────────────────────────────────────
app.get('/api/reports/waste', (req, res) => {
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

// ── UTILS ─────────────────────────────────────────────────────────
function tryParseJSON(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── START ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅  IronBend Server פועל על http://localhost:${PORT}`);
  console.log(`📊  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`📋  Orders:    http://localhost:${PORT}/orders.html`);
  console.log(`🔧  Machine:   http://localhost:${PORT}/machine.html`);
  console.log(`🖨️  Print:     http://localhost:${PORT}/api/orders/:id/print-cards`);
});
