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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database
const db = new Database('ironbend.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    priority_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_num TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    channel TEXT,
    delivery_date TEXT,
    delivery_time TEXT,
    delivery_address TEXT,
    priority TEXT DEFAULT 'רגיל',
    driver_notes TEXT,
    general_notes TEXT,
    status TEXT DEFAULT 'ממתינה לאישור',
    total_weight REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  );

  CREATE TABLE IF NOT EXISTS pallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    pallet_num INTEGER,
    max_weight REAL DEFAULT 500,
    total_weight REAL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pallet_id INTEGER,
    shape_id TEXT,
    shape_name TEXT,
    diameter REAL,
    length REAL,
    quantity INTEGER,
    weight REAL,
    note TEXT,
    struct_element TEXT,
    struct_floor TEXT,
    sheet_num TEXT,
    machine_id INTEGER,
    status TEXT DEFAULT 'ממתין',
    started_at DATETIME,
    completed_at DATETIME,
    produced_qty INTEGER DEFAULT 0,
    waste_qty INTEGER DEFAULT 0,
    FOREIGN KEY (pallet_id) REFERENCES pallets(id)
  );

  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    port TEXT,
    status TEXT DEFAULT 'לא מחובר',
    current_order_num TEXT,
    current_item_id INTEGER,
    counter INTEGER DEFAULT 0,
    last_seen DATETIME
  );

  INSERT OR IGNORE INTO machines (id, name, port) VALUES (1, 'מכונה 1 – כיפוף', 'COM3');
  INSERT OR IGNORE INTO machines (id, name, port) VALUES (2, 'מכונה 2 – כיפוף', 'COM4');
`);

// ── WEBSOCKET ──────────────────────────────────────────────────────
function wsBroadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', ws => {
  // Send current machine state on connect
  ws.send(JSON.stringify({ type: 'machines_state', data: modbus.getAllState() }));
});

// Modbus -> WebSocket bridge
modbus.onUpdate((machineId, state) => {
  // Sync to DB
  db.prepare(`UPDATE machines SET status=?, counter=?, last_seen=? WHERE id=?`)
    .run(state.status, state.counter, state.lastSeen, machineId);

  // Check if counter changed for active item → update produced_qty
  const machine = db.prepare('SELECT current_item_id FROM machines WHERE id=?').get(machineId);
  if (machine?.current_item_id) {
    db.prepare('UPDATE items SET produced_qty=? WHERE id=?').run(state.counter, machine.current_item_id);
  }

  wsBroadcast('machine_update', state);
});

// Start Modbus polling (comment out if no hardware connected)
// modbus.startPolling(1000);

// ── ROUTES ────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── CUSTOMERS ─────────────────────────────────────────────────────
app.get('/api/customers', (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? LIMIT 10`)
    .all(`%${q}%`, `%${q}%`);
  res.json(rows);
});

// ── ORDERS ────────────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const { status, date } = req.query;
  let sql = `SELECT o.*, c.name as customer_name, c.phone as customer_phone
             FROM orders o LEFT JOIN customers c ON o.customer_id = c.id`;
  const params = [];
  const where = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (date)   { where.push('DATE(o.delivery_date) = ?'); params.push(date); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'לא נמצא' });
  const pallets = db.prepare('SELECT * FROM pallets WHERE order_id = ?').all(order.id);
  pallets.forEach(p => { p.items = db.prepare('SELECT * FROM items WHERE pallet_id = ?').all(p.id); });
  order.pallets = pallets;
  res.json(order);
});

app.post('/api/orders', (req, res) => {
  const { customer, order, pallets } = req.body;

  let customerId;
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(customer.phone);
  if (existing) {
    customerId = existing.id;
    db.prepare('UPDATE customers SET name=?, address=?, contact_name=?, contact_phone=? WHERE id=?')
      .run(customer.name, customer.address, customer.contactName, customer.contactPhone, customerId);
  } else {
    const r = db.prepare('INSERT INTO customers (name, phone, address, contact_name, contact_phone) VALUES (?,?,?,?,?)')
      .run(customer.name, customer.phone, customer.address, customer.contactName, customer.contactPhone);
    customerId = r.lastInsertRowid;
  }

  const count    = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const orderNum = `HZ-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;

  const orderResult = db.prepare(`
    INSERT INTO orders (order_num, customer_id, channel, delivery_date, delivery_time, delivery_address, priority, driver_notes, general_notes, total_weight)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(orderNum, customerId, order.channel, order.deliveryDate, order.deliveryTime,
         order.deliveryAddress, order.priority, order.driverNotes, order.generalNotes, order.totalWeight);

  const orderId = orderResult.lastInsertRowid;

  pallets.forEach((pallet, idx) => {
    const pr = db.prepare('INSERT INTO pallets (order_id, pallet_num, max_weight, total_weight) VALUES (?,?,?,?)')
      .run(orderId, idx + 1, pallet.maxWeight, pallet.totalWeight);
    pallet.items.forEach(item => {
      db.prepare(`INSERT INTO items (pallet_id, shape_id, shape_name, diameter, length, quantity, weight, note, struct_element, struct_floor, sheet_num)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pr.lastInsertRowid, item.shapeId, item.shapeName, item.diameter, item.length,
             item.qty, item.weight, item.note, item.structElement, item.structFloor, item.sheetNum);
    });
  });

  wsBroadcast('new_order', { orderNum, orderId });
  res.json({ success: true, orderNum, orderId });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  wsBroadcast('order_status', { id: Number(req.params.id), status });
  res.json({ success: true });
});

// ── MACHINES ──────────────────────────────────────────────────────
app.get('/api/machines', (req, res) => {
  const machines = db.prepare('SELECT * FROM machines').all();
  // Merge with live Modbus state
  const live = modbus.getAllState();
  const merged = machines.map(m => {
    const ls = live.find(l => l.id === m.id);
    return ls ? { ...m, ...ls } : m;
  });
  res.json(merged);
});

// Assign item to machine (operator selects job at machine)
app.post('/api/machines/:id/assign', (req, res) => {
  const { itemId, orderNum } = req.body;
  db.prepare('UPDATE machines SET current_item_id=?, current_order_num=? WHERE id=?')
    .run(itemId, orderNum, req.params.id);
  db.prepare('UPDATE items SET status=?, started_at=?, machine_id=? WHERE id=?')
    .run('בייצור', new Date().toISOString(), req.params.id, itemId);
  wsBroadcast('machine_assign', { machineId: Number(req.params.id), itemId, orderNum });
  res.json({ success: true });
});

// Complete current item on machine
app.post('/api/machines/:id/complete', (req, res) => {
  const machineId = Number(req.params.id);
  const { producedQty, wasteQty = 0 } = req.body;
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(machineId);
  if (!machine?.current_item_id) return res.status(400).json({ error: 'אין פריט פעיל' });

  db.prepare('UPDATE items SET status=?, completed_at=?, produced_qty=?, waste_qty=? WHERE id=?')
    .run('הושלם', new Date().toISOString(), producedQty, wasteQty, machine.current_item_id);
  db.prepare('UPDATE machines SET current_item_id=NULL, current_order_num=NULL, counter=0 WHERE id=?')
    .run(machineId);

  // Auto-complete order if all items done
  const item   = db.prepare('SELECT pallet_id FROM items WHERE id=?').get(machine.current_item_id);
  const pallet = item ? db.prepare('SELECT order_id FROM pallets WHERE id=?').get(item.pallet_id) : null;
  if (pallet) {
    const pending = db.prepare(`SELECT COUNT(*) as c FROM items i
      JOIN pallets p ON i.pallet_id = p.id WHERE p.order_id=? AND i.status != 'הושלם'`).get(pallet.order_id);
    if (pending.c === 0) {
      db.prepare("UPDATE orders SET status='הושלם – ממתין לאיסוף' WHERE id=?").run(pallet.order_id);
      const order = db.prepare('SELECT order_num FROM orders WHERE id=?').get(pallet.order_id);
      wsBroadcast('order_complete', { orderId: pallet.order_id, orderNum: order?.order_num });
    }
  }

  wsBroadcast('machine_complete', { machineId });
  res.json({ success: true });
});

// ── SCAN (QR) ─────────────────────────────────────────────────────
app.post('/api/scan', (req, res) => {
  const { qrData, action, machine } = req.body;
  const [orderNum, itemId] = qrData.split('|');
  if (action === 'start') {
    db.prepare('UPDATE items SET status=?, started_at=?, machine_id=? WHERE id=?')
      .run('בייצור', new Date().toISOString(), machine, itemId);
    db.prepare('UPDATE machines SET current_item_id=?, current_order_num=? WHERE id=?')
      .run(itemId, orderNum, machine);
  } else if (action === 'end') {
    const producedQty = req.body.producedQty || 0;
    db.prepare('UPDATE items SET status=?, completed_at=?, produced_qty=? WHERE id=?')
      .run('הושלם', new Date().toISOString(), producedQty, itemId);
    db.prepare('UPDATE machines SET current_item_id=NULL, current_order_num=NULL WHERE id=?').run(machine);
  }
  res.json({ success: true });
});

// ── DASHBOARD ─────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json({
    ordersToday:    db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=?").get(today).c,
    completedToday: db.prepare("SELECT COUNT(*) as c FROM orders WHERE DATE(created_at)=? AND status='הושלם – ממתין לאיסוף'").get(today).c,
    inProduction:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='בייצור'").get().c,
    pending:        db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ממתינה לאישור'").get().c,
    totalWeightToday: db.prepare("SELECT SUM(total_weight) as w FROM orders WHERE DATE(created_at)=?").get(today).w || 0,
    itemsInProduction: db.prepare("SELECT COUNT(*) as c FROM items WHERE status='בייצור'").get().c,
    itemsDone:      db.prepare("SELECT COUNT(*) as c FROM items WHERE DATE(completed_at)=? AND status='הושלם'").get(today).c,
    recentOrders:   db.prepare(`SELECT o.*, c.name as customer_name FROM orders o
      LEFT JOIN customers c ON o.customer_id=c.id ORDER BY o.created_at DESC LIMIT 10`).all(),
    machines:       db.prepare('SELECT * FROM machines').all(),
  });
});

// ── START ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ IronBend Server פועל על http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`📋 Orders:    http://localhost:${PORT}/orders.html`);
  console.log(`🔧 Machine:   http://localhost:${PORT}/machine.html`);
});
