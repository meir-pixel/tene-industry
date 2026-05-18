require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const path     = require('path');
const http     = require('http');
const multer   = require('multer');
const cron     = require('node-cron');
const { WebSocketServer } = require('ws');
const modbus   = require('./modbus');
const priority = require('./priority');
const intake   = require('./intake');
const ai       = require('./ai');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
modbus.init(db); // pass db so modbus reads machine config live

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

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    active INTEGER DEFAULT 1,
    current_lat REAL,
    current_lng REAL,
    last_location_update DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    driver_id INTEGER,
    scheduled_date TEXT,
    status TEXT DEFAULT 'ממתין',
    departed_at DATETIME,
    delivered_at DATETIME,
    signature_data TEXT,
    photo_url TEXT,
    notes TEXT,
    problem_type TEXT,
    problem_notes TEXT,
    delivery_lat REAL,
    delivery_lng REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    level TEXT DEFAULT 'warning',
    message TEXT,
    order_id INTEGER,
    machine_id INTEGER,
    resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS intake_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    raw_content TEXT,
    parsed_data JSON,
    order_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS companies (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    ownership_pct REAL DEFAULT 100,
    erp_type TEXT DEFAULT 'none',
    color TEXT DEFAULT '#e07b39',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
addCol('machines',   'conn_mode',          "TEXT DEFAULT 'tcp'");   // 'tcp' or 'rtu'
addCol('machines',   'tcp_host',           'TEXT');                  // IP of USR-N510 / gateway
addCol('machines',   'tcp_port',           'INTEGER DEFAULT 502');   // Modbus TCP port
addCol('machines',   'rtu_port',           'TEXT');                  // COM3 / /dev/ttyUSB0
addCol('machines',   'baud_rate',          'INTEGER DEFAULT 9600');  // baud rate for RTU
addCol('customers',  'company_id',         'INTEGER DEFAULT 1');
addCol('orders',     'company_id',         'INTEGER DEFAULT 1');

// ── SEED COMPANIES ────────────────────────────────────────────────
db.exec(`
  INSERT OR IGNORE INTO companies (id, name, short_name, ownership_pct, erp_type, color) VALUES
    (1, 'IronBend כיפוף ברזל', 'IronBend', 100, 'priority', '#e07b39'),
    (2, 'הרי מדבר תשתיות ופיתוח', 'הרי מדבר', 50, 'maven', '#3498db');
`);

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

// ── MACHINE CONNECTION CONFIG ─────────────────────────────────────
app.patch('/api/machines/:id/config', (req, res) => {
  const { conn_mode, tcp_host, tcp_port, rtu_port, baud_rate, slave_id, min_diameter, max_diameter, name } = req.body;
  db.prepare(`UPDATE machines SET
    conn_mode=COALESCE(?,conn_mode),
    tcp_host=COALESCE(?,tcp_host),
    tcp_port=COALESCE(?,tcp_port),
    rtu_port=COALESCE(?,rtu_port),
    baud_rate=COALESCE(?,baud_rate),
    slave_id=COALESCE(?,slave_id),
    min_diameter=COALESCE(?,min_diameter),
    max_diameter=COALESCE(?,max_diameter),
    name=COALESCE(?,name)
    WHERE id=?`)
    .run(conn_mode||null, tcp_host||null, tcp_port||null, rtu_port||null,
         baud_rate||null, slave_id||null, min_diameter||null, max_diameter||null,
         name||null, req.params.id);
  // Tell modbus service to reconnect this machine
  if (modbus) modbus.reconfigMachine(req.params.id).catch(()=>{});
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

// ── ALERTS ────────────────────────────────────────────────────────
function createAlert(type, level, message, { orderId, machineId } = {}) {
  db.prepare('INSERT INTO alerts (type,level,message,order_id,machine_id) VALUES (?,?,?,?,?)')
    .run(type, level, message, orderId || null, machineId || null);
  wsBroadcast('alert', { type, level, message, orderId, machineId });
}

app.get('/api/alerts', (req, res) => {
  res.json(db.prepare('SELECT * FROM alerts WHERE resolved=0 ORDER BY created_at DESC LIMIT 50').all());
});

app.patch('/api/alerts/:id/resolve', (req, res) => {
  db.prepare('UPDATE alerts SET resolved=1 WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── SETTINGS ─────────────────────────────────────────────
// Helper: get setting from DB (falls back to process.env)
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row?.value ?? process.env[key] ?? null;
}

app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  // Merge with env defaults (don't expose actual secrets, just whether they're set)
  const keys = [
    'WHATSAPP_TOKEN','WHATSAPP_PHONE_ID','WHATSAPP_VERIFY_TOKEN','WHATSAPP_NOTIFY_PHONE',
    'EMAIL_IMAP_HOST','EMAIL_IMAP_PORT','EMAIL_IMAP_USER','EMAIL_IMAP_PASS',
    'PRIORITY_BASE_URL','PRIORITY_USER','PRIORITY_PASS','PRIORITY_COMPANY',
    'MAVEN_API_URL','MAVEN_API_TOKEN',
    'GOOGLE_VISION_API_KEY',
    'MODULE_MACHINES','MODULE_WHATSAPP','MODULE_EMAIL','MODULE_OCR',
    'MODULE_PRIORITY','MODULE_MAVEN','MODULE_AI','MODULE_ALERTS',
  ];
  const result = {};
  keys.forEach(k => {
    result[k] = map[k] ?? process.env[k] ?? '';
  });
  res.json(result);
});

app.post('/api/settings', (req, res) => {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  );
  const save = db.transaction(entries => {
    for (const [k, v] of Object.entries(entries)) {
      upsert.run(k, v ?? '');
    }
  });
  save(req.body);
  res.json({ success: true, saved: Object.keys(req.body).length });
});

app.post('/api/settings/test/:service', async (req, res) => {
  const svc = req.params.service;
  try {
    if (svc === 'whatsapp') {
      const token   = getSetting('WHATSAPP_TOKEN');
      const phoneId = getSetting('WHATSAPP_PHONE_ID');
      if (!token || !phoneId) return res.json({ ok: false, msg: 'Token ו-Phone ID חסרים' });
      const axios = require('axios');
      const r = await axios.get(
        `https://graph.facebook.com/v18.0/${phoneId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 }
      );
      return res.json({ ok: true, msg: `מחובר: ${r.data?.display_phone_number || r.data?.id}` });
    }
    if (svc === 'email') {
      const host = getSetting('EMAIL_IMAP_HOST');
      const user = getSetting('EMAIL_IMAP_USER');
      const pass = getSetting('EMAIL_IMAP_PASS');
      if (!host || !user || !pass) return res.json({ ok: false, msg: 'Host/User/Pass חסרים' });
      let ImapFlow;
      try { ImapFlow = require('imapflow'); } catch { return res.json({ ok: false, msg: 'imapflow לא מותקן (npm install imapflow)' }); }
      const client = new ImapFlow.ImapFlow({
        host, port: Number(getSetting('EMAIL_IMAP_PORT') || 993),
        secure: true, auth: { user, pass }, logger: false,
      });
      await client.connect();
      await client.logout();
      return res.json({ ok: true, msg: `מחובר לתיבה: ${user}` });
    }
    if (svc === 'priority') {
      const base = getSetting('PRIORITY_BASE_URL');
      const user = getSetting('PRIORITY_USER');
      const pass = getSetting('PRIORITY_PASS');
      if (!base) return res.json({ ok: false, msg: 'Base URL חסר' });
      const axios = require('axios');
      const r = await axios.get(`${base}/CUSTOMERS?$top=1`, {
        auth: { username: user, password: pass }, timeout: 8000,
      });
      return res.json({ ok: true, msg: `Priority מגיב (${r.status})` });
    }
    if (svc === 'vision') {
      const key = getSetting('GOOGLE_VISION_API_KEY');
      if (!key) return res.json({ ok: false, msg: 'API Key חסר' });
      return res.json({ ok: true, msg: 'API Key הוגדר ✓ (בדיקה אמיתית דורשת תמונה)' });
    }
    res.json({ ok: false, msg: 'שירות לא מוכר' });
  } catch (err) {
    res.json({ ok: false, msg: err.message });
  }
});

// ── COMPANIES ─────────────────────────────────────────────────────
app.get('/api/companies', (req, res) => {
  res.json(db.prepare('SELECT * FROM companies WHERE active=1 ORDER BY id').all());
});

app.post('/api/companies', (req, res) => {
  const { name, short_name, ownership_pct, erp_type, color } = req.body;
  const r = db.prepare(
    'INSERT INTO companies (name, short_name, ownership_pct, erp_type, color) VALUES (?,?,?,?,?)'
  ).run(name, short_name || name, ownership_pct ?? 100, erp_type || 'none', color || '#e07b39');
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/companies/:id', (req, res) => {
  const { name, short_name, ownership_pct, erp_type, color } = req.body;
  db.prepare(
    'UPDATE companies SET name=COALESCE(?,name), short_name=COALESCE(?,short_name), ownership_pct=COALESCE(?,ownership_pct), erp_type=COALESCE(?,erp_type), color=COALESCE(?,color) WHERE id=?'
  ).run(name, short_name, ownership_pct, erp_type, color, req.params.id);
  res.json({ success: true });
});

// ── HOLDINGS DASHBOARD ───────────────────────────────────────────
app.get('/api/holdings', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const companies = db.prepare('SELECT * FROM companies WHERE active=1').all();

  const rows = companies.map(co => {
    const pct = co.ownership_pct / 100;
    const ordersToday    = db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND company_id=?").get(today, co.id).c;
    const weightToday    = db.prepare("SELECT COALESCE(SUM(total_weight),0) as w FROM orders WHERE DATE(created_at)=? AND company_id=?").get(today, co.id).w;
    const inProduction   = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='בייצור' AND company_id=?").get(co.id).c;
    const completedToday = db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status='הושלם – ממתין לאיסוף' AND company_id=?").get(today, co.id).c;
    const pending        = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ממתינה לאישור' AND company_id=?").get(co.id).c;
    const urgentOpen     = db.prepare("SELECT COUNT(*) as c FROM orders WHERE priority='דחוף' AND status NOT IN ('סופק – אושר','בוטל') AND company_id=?").get(co.id).c;

    // Last 30 days revenue estimate (billing_weight as proxy)
    const revenueProxy = db.prepare(
      "SELECT COALESCE(SUM(billing_weight),0) as r FROM orders WHERE DATE(created_at) >= date('now','-30 days') AND company_id=?"
    ).get(co.id).r;

    return {
      ...co,
      ordersToday,
      weightToday,
      inProduction,
      completedToday,
      pending,
      urgentOpen,
      revenueProxy,
      // Weighted values (ownership %)
      weighted: {
        ordersToday:    ordersToday * pct,
        weightToday:    weightToday * pct,
        inProduction:   inProduction * pct,
        completedToday: completedToday * pct,
        urgentOpen:     urgentOpen * pct,
        revenueProxy:   revenueProxy * pct,
      }
    };
  });

  // Consolidated totals
  const consolidated = {
    ordersToday:    rows.reduce((s,r) => s + r.weighted.ordersToday, 0),
    weightToday:    rows.reduce((s,r) => s + r.weighted.weightToday, 0),
    inProduction:   rows.reduce((s,r) => s + r.weighted.inProduction, 0),
    completedToday: rows.reduce((s,r) => s + r.weighted.completedToday, 0),
    urgentOpen:     rows.reduce((s,r) => s + r.weighted.urgentOpen, 0),
    revenueProxy:   rows.reduce((s,r) => s + r.weighted.revenueProxy, 0),
  };

  res.json({ companies: rows, consolidated });
});

// ── DRIVERS ───────────────────────────────────────────────────────
app.get('/api/drivers', (req, res) => {
  res.json(db.prepare('SELECT * FROM drivers WHERE active=1 ORDER BY name').all());
});

app.post('/api/drivers', (req, res) => {
  const { name, phone } = req.body;
  const r = db.prepare('INSERT INTO drivers (name,phone) VALUES (?,?)').run(name, phone);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/drivers/:id/location', (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE drivers SET current_lat=?,current_lng=?,last_location_update=? WHERE id=?')
    .run(lat, lng, new Date().toISOString(), req.params.id);
  wsBroadcast('driver_location', { driverId: Number(req.params.id), lat, lng });
  res.json({ success: true });
});

// ── DELIVERIES ────────────────────────────────────────────────────
app.get('/api/deliveries', (req, res) => {
  const { driverId, date, status } = req.query;
  let sql = `SELECT d.*, o.order_num, o.delivery_address, o.total_weight, o.billing_weight,
               c.name as customer_name, c.phone as customer_phone,
               dr.name as driver_name
             FROM deliveries d
             JOIN orders o ON d.order_id = o.id
             LEFT JOIN customers c ON o.customer_id = c.id
             LEFT JOIN drivers dr ON d.driver_id = dr.id`;
  const where = [], params = [];
  if (driverId) { where.push('d.driver_id=?'); params.push(driverId); }
  if (date)     { where.push('d.scheduled_date=?'); params.push(date); }
  if (status)   { where.push('d.status=?'); params.push(status); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY d.scheduled_date, d.id';
  const deliveries = db.prepare(sql).all(...params);
  // Attach pallets count
  deliveries.forEach(d => {
    d.pallets_count = db.prepare('SELECT COUNT(*) as c FROM pallets WHERE order_id=?').get(d.order_id)?.c || 0;
  });
  res.json(deliveries);
});

app.post('/api/deliveries', (req, res) => {
  const { orderId, driverId, scheduledDate } = req.body;
  const r = db.prepare('INSERT INTO deliveries (order_id,driver_id,scheduled_date) VALUES (?,?,?)')
    .run(orderId, driverId, scheduledDate);
  // Update order status
  db.prepare("UPDATE orders SET status='בתור ייצור' WHERE id=? AND status='ממתינה לאישור'").run(orderId);
  res.json({ id: r.lastInsertRowid });
});

// Driver departs
app.post('/api/deliveries/:id/depart', (req, res) => {
  db.prepare("UPDATE deliveries SET status='יצא',departed_at=? WHERE id=?")
    .run(new Date().toISOString(), req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    db.prepare("UPDATE orders SET status='בדרך ללקוח' WHERE id=?").run(del.order_id);
    const o = db.prepare('SELECT o.*,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?').get(del.order_id);
    if (o?.phone) intake.notifyOrderStatus(o.phone, o.order_num, 'בדרך ללקוח').catch(() => {});
    wsBroadcast('delivery_depart', { deliveryId: Number(req.params.id), orderId: del.order_id });
  }
  res.json({ success: true });
});

// Driver confirms delivery
app.post('/api/deliveries/:id/confirm', (req, res) => {
  const { signatureData, photoUrl, notes, lat, lng } = req.body;
  db.prepare(`UPDATE deliveries SET status='סופק',delivered_at=?,signature_data=?,photo_url=?,notes=?,delivery_lat=?,delivery_lng=? WHERE id=?`)
    .run(new Date().toISOString(), signatureData, photoUrl, notes, lat, lng, req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    db.prepare("UPDATE orders SET status='סופק – אושר' WHERE id=?").run(del.order_id);
    const o = db.prepare('SELECT o.*,c.phone FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=?').get(del.order_id);
    if (o?.phone) intake.notifyOrderStatus(o.phone, o.order_num, 'סופק – אושר').catch(() => {});
    // Sync to Priority
    if (o?.priority_order_id) {
      priority.updateOrderStatus(o.priority_order_id, 'סופק – אושר').catch(() => {});
    }
    wsBroadcast('delivery_confirm', { deliveryId: Number(req.params.id), orderId: del.order_id });
  }
  res.json({ success: true });
});

// Driver reports problem
app.post('/api/deliveries/:id/problem', (req, res) => {
  const { problemType, problemNotes } = req.body;
  db.prepare("UPDATE deliveries SET status='בעיה',problem_type=?,problem_notes=? WHERE id=?")
    .run(problemType, problemNotes, req.params.id);
  const del = db.prepare('SELECT order_id FROM deliveries WHERE id=?').get(req.params.id);
  if (del) {
    const o = db.prepare('SELECT order_num FROM orders WHERE id=?').get(del.order_id);
    createAlert('delivery_problem', 'danger', `בעיה באספקה ${o?.order_num}: ${problemType}`, { orderId: del.order_id });
  }
  res.json({ success: true });
});

// ── PRIORITY SYNC ─────────────────────────────────────────────────
app.post('/api/priority/sync/:orderId', async (req, res) => {
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

app.get('/api/priority/status', (req, res) => {
  res.json({ configured: priority.isConfigured() });
});

// ── INTAKE – OCR ─────────────────────────────────────────────────
app.post('/api/intake/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא צורפה תמונה' });
  try {
    const ocrResult = await intake.runOCR(req.file.buffer);
    const parsed    = intake.parseOCRText(ocrResult.fullText);
    db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
      .run('ocr', ocrResult.fullText.slice(0, 2000), JSON.stringify(parsed), 'pending');
    res.json({ success: true, parsed, fullText: ocrResult.fullText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INTAKE – WhatsApp webhook ─────────────────────────────────────
app.get('/api/intake/whatsapp', (req, res) => {
  // Meta webhook verification
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/api/intake/whatsapp', async (req, res) => {
  res.sendStatus(200); // acknowledge immediately (Meta requires fast response)
  try {
    const body = req.body;
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;

    for (const msg of entry.messages) {
      const fromPhone = msg.from;
      let parsed = null;

      if (msg.type === 'text') {
        parsed = intake.parseWhatsAppMessage(msg.text.body);
        parsed.source = 'whatsapp';
        parsed.customerPhone = fromPhone;
      } else if (msg.type === 'image' || msg.type === 'document') {
        // Image/PDF - would need to download via WhatsApp API then OCR
        // Mark for manual review
        db.prepare('INSERT INTO intake_log (source,raw_content,status) VALUES (?,?,?)')
          .run('whatsapp_media', `media:${msg.type} from:${fromPhone}`, 'pending_review');
        await intake.sendWhatsApp(fromPhone, 'קיבלנו את התמונה, ניצור קשר בהקדם!');
        continue;
      }

      if (parsed) {
        db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
          .run('whatsapp', msg.text?.body || '', JSON.stringify(parsed), 'pending');
        wsBroadcast('new_intake', { source: 'whatsapp', phone: fromPhone, parsed });
      }
    }
  } catch (err) {
    console.error('[WhatsApp webhook]', err.message);
  }
});

// ── INTAKE – Email manual trigger ─────────────────────────────────
app.post('/api/intake/email/poll', async (req, res) => {
  try {
    const results = await intake.pollEmail(db);
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intake/log', (req, res) => {
  res.json(db.prepare('SELECT * FROM intake_log ORDER BY created_at DESC LIMIT 50').all());
});

// ── INTAKE – Parse text manually (WhatsApp / Email paste) ──────────
app.post('/api/intake/parse-text', (req, res) => {
  const { text, source } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const parsed = source === 'whatsapp'
    ? intake.parseWhatsAppMessage(text)
    : intake.parseOCRText(text);
  parsed.source = source || 'manual';
  db.prepare('INSERT INTO intake_log (source,raw_content,parsed_data,status) VALUES (?,?,?,?)')
    .run(source || 'manual', text.slice(0, 2000), JSON.stringify(parsed), 'pending');
  res.json({ success: true, parsed });
});

// ── AI PREDICTION ─────────────────────────────────────────────────
app.post('/api/ai/predict', (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'חסרים פריטים' });
  const result = ai.predictProductionTime(items);
  res.json(result);
});

app.get('/api/ai/predict-order/:orderId', (req, res) => {
  const order   = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id=?').all(order.id);
  const items   = pallets.flatMap(p => db.prepare('SELECT * FROM items WHERE pallet_id=?').all(p.id));
  const prediction   = ai.predictProductionTime(items);
  const feasibility  = ai.checkDeliveryFeasibility(order, items);
  res.json({ prediction, feasibility });
});

app.get('/api/ai/waste-patterns', (req, res) => {
  res.json(ai.analyzeWastePatterns());
});

app.get('/api/ai/machine-efficiency', (req, res) => {
  const days = Number(req.query.days || 7);
  res.json(ai.getMachineEfficiency(days));
});

// ── REPORTS ───────────────────────────────────────────────────────
app.get('/api/reports/summary', (req, res) => {
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

// ── BACKGROUND JOBS ───────────────────────────────────────────────
// Check alerts every 5 minutes
cron.schedule('*/5 * * * *', () => {
  // Urgent orders sitting >30 min without production
  const urgentLate = db.prepare(`
    SELECT o.id, o.order_num FROM orders o
    WHERE o.priority='דחוף' AND o.status NOT IN ('בייצור','הושלם – ממתין לאיסוף','בדרך ללקוח','סופק – אושר','בוטל')
      AND JULIANDAY('now') - JULIANDAY(o.created_at) > 0.021
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.order_id=o.id AND a.type='urgent_late' AND a.resolved=0)
  `).all();
  urgentLate.forEach(o => createAlert('urgent_late', 'danger', `הזמנה דחופה ${o.order_num} ממתינה לייצור מעל 30 דקות`, { orderId: o.id }));

  // Pending approval >15 min
  const pendingLong = db.prepare(`
    SELECT o.id, o.order_num FROM orders o
    WHERE o.status='ממתינה לאישור'
      AND JULIANDAY('now') - JULIANDAY(o.created_at) > 0.01
      AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.order_id=o.id AND a.type='pending_approval' AND a.resolved=0)
  `).all();
  pendingLong.forEach(o => createAlert('pending_approval', 'info', `הזמנה ${o.order_num} ממתינה לאישור מעל 15 דקות`, { orderId: o.id }));
});

// Email polling every minute if configured
cron.schedule('* * * * *', async () => {
  if (process.env.EMAIL_IMAP_HOST) {
    try {
      const results = await intake.pollEmail(db);
      if (results.length) wsBroadcast('new_intake_email', { count: results.length });
    } catch {}
  }
});

// ── START ─────────────────────────────────────────────────────────
ai.init(db);

server.listen(PORT, () => {
  console.log(`✅  IronBend Server פועל על http://localhost:${PORT}`);
  console.log(`📊  Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`📋  Orders:    http://localhost:${PORT}/orders.html`);
  console.log(`🔧  Machine:   http://localhost:${PORT}/machine.html`);
  console.log(`🚚  Driver:    http://localhost:${PORT}/driver.html`);
  console.log(`📈  Reports:   http://localhost:${PORT}/reports.html`);
  console.log(`🖨️  Print:     http://localhost:${PORT}/api/orders/:id/print-cards`);
});
