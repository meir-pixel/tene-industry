const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const modbus = require('../modbus');
const constants = require('../constants');
const statusContracts = require('../status-contracts');
const { ensureCoreSchema, runCoreMigrations } = require('../db/startup');
const createProductionRouter = require('../routes/production');
const createMaintenanceRouter = require('../routes/maintenance');
const {
  MACHINE_SAFETY_REASON,
  assertMachineOperationAllowed,
  assertMachineSafetyAuthorization,
  evaluateMachineOperationSafety,
} = require('../services/machineSafetyGate');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  ensureCoreSchema(db);
  runCoreMigrations(db);
  return db;
}

function seedMachine(db, overrides = {}) {
  const row = {
    id: overrides.id || 1,
    name: overrides.name || 'Safety Test Machine',
    label: overrides.label || 'S',
    status: overrides.status || 'ready',
    min_diameter: overrides.min_diameter ?? 8,
    max_diameter: overrides.max_diameter ?? 20,
    can_3d: overrides.can_3d ?? 0,
  };
  db.prepare(`
    INSERT INTO machines (id,name,label,status,min_diameter,max_diameter,can_3d)
    VALUES (@id,@name,@label,@status,@min_diameter,@max_diameter,@can_3d)
  `).run(row);
  return row;
}

function seedOrderItem(db, {
  orderNum = `SAFE-${Date.now()}`,
  orderStatus = statusContracts.ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
  itemStatus = statusContracts.ITEM_STATUS.WAITING,
  diameter = 12,
  is3d = 0,
} = {}) {
  const orderId = db.prepare('INSERT INTO orders (order_num,status) VALUES (?,?)')
    .run(orderNum, orderStatus).lastInsertRowid;
  const palletId = db.prepare('INSERT INTO pallets (order_id,pallet_num) VALUES (?,1)')
    .run(orderId).lastInsertRowid;
  const itemId = db.prepare(`
    INSERT INTO items
      (pallet_id,order_id,shape_name,diameter,quantity,production_qty,total_length_mm,status,is_3d)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(palletId, orderId, 'straight', diameter, 5, 5, 1000, itemStatus, is3d).lastInsertRowid;
  return { orderId, palletId, itemId, orderNum };
}

function expectSafetyReason(fn, reason) {
  assert.throws(fn, error => {
    assert.equal(error.code, reason);
    return true;
  });
}

function passRole() {
  return (_req, _res, next) => next();
}

async function startRoutes(db, adapter) {
  const app = express();
  app.use(express.json());
  app.use('/api', createProductionRouter({
    db,
    requireAnyRole: passRole,
    requireRole: passRole,
    wsBroadcast: () => {},
    modbus: adapter,
    statusContracts,
    MACHINE_STATES: constants.MACHINE_STATES,
    STATE_TRANSITIONS: constants.STATE_TRANSITIONS,
    checkOrderComplete: () => {},
    tryParseJSON: value => {
      try { return JSON.parse(value); } catch { return null; }
    },
  }));
  app.use('/api', createMaintenanceRouter({
    db,
    requireAnyRole: passRole,
    wsBroadcast: () => {},
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function jsonRequest(baseUrl, pathname, method, body) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('manual machine work route fails closed without creating or commanding work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
  const start = source.indexOf("router.post('/orders/manual'");
  const end = source.indexOf("router.post('/order-imports/preview'", start);
  assert.ok(start > -1 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /MACHINE_SAFETY_REASON\.SAFETY_CONTEXT_REQUIRED/);
  assert.doesNotMatch(block, /writeParams|UPDATE machines|INSERT INTO orders|INSERT INTO items/);
});

test('machine safety gate enforces order, item, machine compatibility and LOTO contracts', () => {
  const db = createDb();
  seedMachine(db);
  const valid = seedOrderItem(db, { orderNum: 'SAFE-VALID' });

  const allowed = assertMachineOperationAllowed({
    db,
    machineId: 1,
    itemId: valid.itemId,
    operation: 'command',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.order.id, valid.orderId);
  assert.ok(allowed.safetyAuthorization);

  const pending = seedOrderItem(db, {
    orderNum: 'SAFE-PENDING',
    orderStatus: statusContracts.ORDER_STATUS.PENDING_APPROVAL,
  });
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: pending.itemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.ORDER_NOT_RELEASED_FOR_PRODUCTION);

  const cancelledOrder = seedOrderItem(db, {
    orderNum: 'SAFE-CANCELLED-ORDER',
    orderStatus: statusContracts.ORDER_STATUS.CANCELLED,
  });
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: cancelledOrder.itemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.ORDER_NOT_RELEASED_FOR_PRODUCTION);

  for (const [label, itemStatus] of [
    ['cancelled', statusContracts.ITEM_STATUS.CANCELLED],
    ['completed', statusContracts.ITEM_STATUS.DONE],
    ['supplied', statusContracts.ITEM_STATUS.DELIVERED],
  ]) {
    const row = seedOrderItem(db, { orderNum: `SAFE-${label}`, itemStatus });
    expectSafetyReason(() => assertMachineOperationAllowed({
      db, machineId: 1, itemId: row.itemId, operation: 'assignment',
    }), MACHINE_SAFETY_REASON.ITEM_NOT_PRODUCTION_ELIGIBLE);
  }

  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: 999999, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.ITEM_NOT_FOUND);
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 999999, itemId: valid.itemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.MACHINE_NOT_FOUND);

  const orphanItemId = db.prepare(`
    INSERT INTO items (shape_name,diameter,quantity,status)
    VALUES ('orphan',12,1,?)
  `).run(statusContracts.ITEM_STATUS.WAITING).lastInsertRowid;
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: orphanItemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.ORDER_NOT_FOUND);

  const otherOrder = seedOrderItem(db, { orderNum: 'SAFE-OTHER' });
  expectSafetyReason(() => assertMachineOperationAllowed({
    db,
    machineId: 1,
    itemId: valid.itemId,
    orderId: otherOrder.orderId,
    operation: 'assignment',
  }), MACHINE_SAFETY_REASON.ITEM_ORDER_MISMATCH);

  db.prepare('UPDATE machines SET max_diameter=10 WHERE id=1').run();
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: valid.itemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.MACHINE_INCOMPATIBLE);
  db.prepare('UPDATE machines SET max_diameter=20 WHERE id=1').run();

  db.prepare("UPDATE machines SET status='לא מחובר' WHERE id=1").run();
  expectSafetyReason(() => assertMachineOperationAllowed({
    db, machineId: 1, itemId: valid.itemId, operation: 'assignment',
  }), MACHINE_SAFETY_REASON.MACHINE_NOT_AVAILABLE);
  db.prepare("UPDATE machines SET status='ready' WHERE id=1").run();

  db.prepare('INSERT INTO loto (machine_id,locked_by,reason) VALUES (?,?,?)')
    .run(1, 'tester', 'safety test');
  const loto = evaluateMachineOperationSafety({
    db, machineId: 1, itemId: valid.itemId, operation: 'assignment',
  });
  assert.equal(loto.allowed, false);
  assert.equal(loto.reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);
  db.close();
});

test('Modbus write boundary rejects absent, forged and mismatched safety authorization before client invocation', async () => {
  const db = createDb();
  seedMachine(db);
  const valid = seedOrderItem(db, { orderNum: 'SAFE-ADAPTER' });
  const instance = modbus.init(db);
  const writes = [];
  instance.clients[1] = {
    isOpen: true,
    writeRegisters: async (...args) => writes.push(args),
    close: () => {},
  };

  await assert.rejects(
    modbus.writeParams(1, {
      diameter: 12,
      totalLengthMm: 1000,
      productionQty: 5,
      itemId: valid.itemId,
      orderId: valid.orderId,
    }),
    error => error.code === MACHINE_SAFETY_REASON.SAFETY_CONTEXT_REQUIRED
  );
  await assert.rejects(
    modbus.writeParams(1, {
      diameter: 12,
      totalLengthMm: 1000,
      productionQty: 5,
      itemId: valid.itemId,
      orderId: valid.orderId,
      safetyAuthorization: { safetyApproved: true },
    }),
    error => error.code === MACHINE_SAFETY_REASON.SAFETY_CONTEXT_REQUIRED
  );
  assert.equal(writes.length, 0);

  const safety = assertMachineOperationAllowed({
    db,
    machineId: 1,
    itemId: valid.itemId,
    operation: 'command',
  });
  await assert.rejects(
    modbus.writeParams(1, {
      diameter: 12,
      totalLengthMm: 1000,
      productionQty: 5,
      itemId: valid.itemId + 1,
      orderId: valid.orderId,
      safetyAuthorization: safety.safetyAuthorization,
    }),
    error => error.code === MACHINE_SAFETY_REASON.SAFETY_AUTHORIZATION_MISMATCH
  );
  assert.equal(writes.length, 0);

  await modbus.writeParams(1, {
    diameter: 12,
    totalLengthMm: 1000,
    productionQty: 5,
    angles: [90],
    itemId: valid.itemId,
    orderId: valid.orderId,
    safetyAuthorization: safety.safetyAuthorization,
  });
  assert.equal(writes.length, 4);

  db.prepare('INSERT INTO loto (machine_id,locked_by,reason) VALUES (?,?,?)')
    .run(1, 'tester', 'reconfigure safety');
  await assert.rejects(
    modbus.writeParams(1, {
      diameter: 12,
      totalLengthMm: 1000,
      productionQty: 5,
      itemId: valid.itemId,
      orderId: valid.orderId,
      safetyAuthorization: safety.safetyAuthorization,
    }),
    error => error.code === MACHINE_SAFETY_REASON.ACTIVE_LOTO
  );
  assert.equal(writes.length, 4);

  let connectCalls = 0;
  instance.connectMachine = async () => { connectCalls += 1; };
  const reconfigure = await instance.reconfigMachine(1);
  assert.deepEqual(reconfigure, {
    reconfigured: false,
    reason: MACHINE_SAFETY_REASON.ACTIVE_LOTO,
  });
  assert.equal(connectCalls, 0);
  db.close();
});

test('machine routes enforce LOTO, valid authorization, transactional assignment and safe fault closure', async () => {
  const db = createDb();
  seedMachine(db, { status: 'סרק' });
  seedMachine(db, { id: 2, label: 'S2', status: 'ready' });
  const lotoItem = seedOrderItem(db, { orderNum: 'SAFE-LOTO-ROUTE' });
  db.prepare('UPDATE machines SET current_item_id=? WHERE id=1').run(lotoItem.itemId);
  const activeLotoId = db.prepare('INSERT INTO loto (machine_id,locked_by,reason) VALUES (?,?,?)')
    .run(1, 'tester', 'active LOTO').lastInsertRowid;
  const adapterCalls = [];
  const routes = await startRoutes(db, {
    getAllState: () => [],
    writeParams: async (machineId, command) => {
      assertMachineSafetyAuthorization(command.safetyAuthorization, {
        machineId,
        itemId: command.itemId,
        orderId: command.orderId,
        operation: 'command',
      });
      adapterCalls.push({ machineId, command });
    },
    getState: () => ({ counter: 0 }),
    reconfigMachine: async () => {},
  });

  const assign = await jsonRequest(routes.baseUrl, '/api/machines/1/assign', 'POST', {
    itemId: lotoItem.itemId,
    orderNum: lotoItem.orderNum,
  });
  assert.equal(assign.status, 409);
  assert.equal(assign.body.reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);

  const command = await jsonRequest(routes.baseUrl, '/api/machines/1/send-params', 'POST', {
    diameter: 12,
    totalLengthMm: 1000,
    productionQty: 5,
  });
  assert.equal(command.status, 409);
  assert.equal(command.body.reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);

  const scan = await jsonRequest(routes.baseUrl, '/api/scan', 'POST', {
    qrData: `${lotoItem.orderNum}|${lotoItem.itemId}`,
    machineId: 1,
    workerId: 1,
  });
  assert.equal(scan.status, 409);
  assert.equal(scan.body.reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);

  const state = await jsonRequest(routes.baseUrl, '/api/machines/1/state', 'PATCH', {
    state: 'ריצה',
  });
  assert.equal(state.status, 409);
  assert.equal(state.body.reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);
  assert.equal(adapterCalls.length, 0);

  const item = db.prepare('SELECT status,started_at,machine_id FROM items WHERE id=?').get(lotoItem.itemId);
  assert.equal(item.status, statusContracts.ITEM_STATUS.WAITING);
  assert.equal(item.started_at, null);
  assert.equal(item.machine_id, null);

  db.prepare("UPDATE loto SET status='שוחרר',released_at=CURRENT_TIMESTAMP WHERE id=?").run(activeLotoId);
  db.prepare("UPDATE machines SET status='ready',current_item_id=NULL,current_order_num=NULL WHERE id=1").run();
  const valid = seedOrderItem(db, { orderNum: 'SAFE-VALID-ROUTE' });

  const validAssign = await jsonRequest(routes.baseUrl, '/api/machines/1/assign', 'POST', {
    itemId: valid.itemId,
    orderNum: 'CLIENT-SPOOFED-ORDER',
  });
  assert.equal(validAssign.status, 200);
  assert.equal(validAssign.body.orderNum, valid.orderNum);
  const machine = db.prepare('SELECT current_item_id,current_order_num FROM machines WHERE id=1').get();
  assert.equal(machine.current_item_id, valid.itemId);
  assert.equal(machine.current_order_num, valid.orderNum);

  const validCommand = await jsonRequest(routes.baseUrl, '/api/machines/1/send-params', 'POST', {
    diameter: 12,
    totalLengthMm: 1000,
    productionQty: 5,
    safetyAuthorization: { safetyApproved: true },
  });
  assert.equal(validCommand.status, 200);
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].command.itemId, valid.itemId);
  assert.equal(adapterCalls[0].command.orderId, valid.orderId);

  const scanItem = seedOrderItem(db, { orderNum: 'SAFE-VALID-SCAN' });
  const validScan = await jsonRequest(routes.baseUrl, '/api/scan', 'POST', {
    qrData: `${scanItem.orderNum}|${scanItem.itemId}`,
    machineId: 2,
    workerId: 1,
  });
  assert.equal(validScan.status, 200);
  assert.equal(adapterCalls.length, 2);
  assert.equal(adapterCalls[1].command.itemId, scanItem.itemId);
  assert.equal(adapterCalls[1].command.orderId, scanItem.orderId);

  const rollbackItem = seedOrderItem(db, { orderNum: 'SAFE-ROLLBACK' });
  db.exec(`
    CREATE TRIGGER reject_assignment_item_update
    BEFORE UPDATE OF status ON items
    WHEN OLD.id=${Number(rollbackItem.itemId)}
    BEGIN
      SELECT RAISE(ABORT, 'forced assignment failure');
    END;
  `);
  const failed = await jsonRequest(routes.baseUrl, '/api/machines/1/assign', 'POST', {
    itemId: rollbackItem.itemId,
    orderNum: rollbackItem.orderNum,
  });
  assert.equal(failed.status, 500);
  const afterFailure = db.prepare('SELECT current_item_id,current_order_num FROM machines WHERE id=1').get();
  assert.equal(afterFailure.current_item_id, valid.itemId);
  assert.equal(afterFailure.current_order_num, valid.orderNum);

  db.prepare("UPDATE machines SET status='תקלה' WHERE id=1").run();
  const logId = db.prepare(`
    INSERT INTO maintenance_logs (machine_id,log_type,description,status)
    VALUES (1,'breakdown','fault','פתוחה')
  `).run().lastInsertRowid;
  const lotoId = db.prepare('INSERT INTO loto (machine_id,locked_by,reason) VALUES (?,?,?)')
    .run(1, 'tester', 'maintenance safety').lastInsertRowid;

  const response = await jsonRequest(routes.baseUrl, `/api/maintenance/${logId}`, 'PATCH', {
    status: 'סגורה',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.fault_closed, true);
  assert.equal(response.body.machine_available, false);
  assert.equal(response.body.safety_reason, MACHINE_SAFETY_REASON.ACTIVE_LOTO);
  assert.equal(db.prepare('SELECT status FROM maintenance_logs WHERE id=?').get(logId).status, 'סגורה');
  assert.equal(db.prepare('SELECT status FROM machines WHERE id=1').get().status, 'נעול LOTO');
  assert.equal(db.prepare('SELECT status FROM loto WHERE id=?').get(lotoId).status, 'פעיל');
  assert.equal(adapterCalls.length, 2);

  await routes.close();
  db.close();
});
