'use strict';

const statusContracts = require('../status-contracts');

const MACHINE_SAFETY_REASON = Object.freeze({
  MACHINE_NOT_FOUND: 'machine_not_found',
  ITEM_NOT_FOUND: 'item_not_found',
  ORDER_NOT_FOUND: 'order_not_found',
  ORDER_NOT_RELEASED_FOR_PRODUCTION: 'order_not_released_for_production',
  ITEM_NOT_PRODUCTION_ELIGIBLE: 'item_not_production_eligible',
  ITEM_ORDER_MISMATCH: 'item_order_mismatch',
  MACHINE_NOT_AVAILABLE: 'machine_not_available',
  MACHINE_INCOMPATIBLE: 'machine_incompatible',
  ACTIVE_LOTO: 'active_loto',
  SAFETY_CONTEXT_REQUIRED: 'safety_context_required',
  SAFETY_AUTHORIZATION_MISMATCH: 'safety_authorization_mismatch',
  SAFETY_AUTHORIZATION_EXPIRED: 'safety_authorization_expired',
});

const ELIGIBLE_ORDER_STATUSES = new Set([
  statusContracts.ORDER_STATUS.APPROVED_WAITING_PRODUCTION,
  statusContracts.ORDER_STATUS.PRODUCTION_QUEUE,
  statusContracts.ORDER_STATUS.IN_PRODUCTION,
]);

const ELIGIBLE_ITEM_STATUSES = new Set([
  statusContracts.ITEM_STATUS.WAITING,
  statusContracts.ITEM_STATUS.IN_PRODUCTION,
]);

const AVAILABLE_MACHINE_STATUSES = new Set([
  'מחובר',
  'סרק',
  'הכנה',
  'ידני',
  'ריצה',
  'בייצור',
  'connected',
  'ready',
  'idle',
  'running',
]);

const AUTHORIZATION_TTL_MS = 5000;
const issuedAuthorizations = new WeakSet();

class MachineSafetyError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = 'MachineSafetyError';
    this.code = reason;
    this.reason = reason;
    this.statusCode = 409;
    this.details = details;
  }
}

function numericId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function loadItemContext(db, itemId) {
  return db.prepare(`
    SELECT i.*,
           COALESCE(i.order_id, p.order_id) AS resolved_order_id,
           o.order_num,
           o.status AS order_status
    FROM items i
    LEFT JOIN pallets p ON p.id=i.pallet_id
    LEFT JOIN orders o ON o.id=COALESCE(i.order_id, p.order_id)
    WHERE i.id=?
  `).get(itemId);
}

function machineCompatible(machine, item) {
  const diameter = Number(item?.diameter);
  if (Number.isFinite(diameter) && diameter > 0) {
    const min = Number(machine?.min_diameter);
    const max = Number(machine?.max_diameter);
    if (Number.isFinite(min) && diameter < min) return false;
    if (Number.isFinite(max) && diameter > max) return false;
  }
  if (Number(item?.is_3d || 0) === 1 && Number(machine?.can_3d || 0) !== 1) return false;
  return true;
}

function createSafetyAuthorization({ machineId, itemId, orderId, operation }) {
  const authorization = Object.freeze({
    kind: 'machine_operation_safety',
    machineId,
    itemId: itemId || null,
    orderId: orderId || null,
    operation,
    issuedAt: Date.now(),
  });
  issuedAuthorizations.add(authorization);
  return authorization;
}

function denied(reason, details = {}) {
  return {
    allowed: false,
    reason,
    details,
    machine: details.machine || null,
    item: details.item || null,
    order: details.order || null,
    safetyAuthorization: null,
  };
}

function evaluateMachineOperationSafety({
  db,
  machineId,
  itemId = null,
  orderId = null,
  operation = 'command',
  requireItem = true,
  checkMachineAvailability = true,
  issueAuthorization = true,
} = {}) {
  if (!db) return denied(MACHINE_SAFETY_REASON.SAFETY_CONTEXT_REQUIRED);

  const resolvedMachineId = numericId(machineId);
  if (!resolvedMachineId) return denied(MACHINE_SAFETY_REASON.MACHINE_NOT_FOUND);
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(resolvedMachineId);
  if (!machine) return denied(MACHINE_SAFETY_REASON.MACHINE_NOT_FOUND);

  const activeLoto = db.prepare("SELECT id FROM loto WHERE machine_id=? AND status='פעיל' ORDER BY id LIMIT 1").get(resolvedMachineId);
  if (activeLoto) {
    return denied(MACHINE_SAFETY_REASON.ACTIVE_LOTO, {
      machine,
      lotoId: activeLoto.id,
    });
  }

  if (checkMachineAvailability && !AVAILABLE_MACHINE_STATUSES.has(String(machine.status || '').trim())) {
    return denied(MACHINE_SAFETY_REASON.MACHINE_NOT_AVAILABLE, { machine });
  }

  const resolvedItemId = numericId(itemId);
  if (requireItem && !resolvedItemId) {
    return denied(MACHINE_SAFETY_REASON.SAFETY_CONTEXT_REQUIRED, { machine });
  }

  let item = null;
  let order = null;
  let resolvedOrderId = numericId(orderId);

  if (resolvedItemId) {
    item = loadItemContext(db, resolvedItemId);
    if (!item) return denied(MACHINE_SAFETY_REASON.ITEM_NOT_FOUND, { machine });

    const itemOrderId = numericId(item.resolved_order_id);
    if (resolvedOrderId && itemOrderId !== resolvedOrderId) {
      return denied(MACHINE_SAFETY_REASON.ITEM_ORDER_MISMATCH, { machine, item });
    }
    resolvedOrderId = resolvedOrderId || itemOrderId;

    if (!ELIGIBLE_ITEM_STATUSES.has(item.status)) {
      return denied(MACHINE_SAFETY_REASON.ITEM_NOT_PRODUCTION_ELIGIBLE, { machine, item });
    }
    if (!machineCompatible(machine, item)) {
      return denied(MACHINE_SAFETY_REASON.MACHINE_INCOMPATIBLE, { machine, item });
    }
  }

  if (requireItem || resolvedOrderId) {
    if (!resolvedOrderId) return denied(MACHINE_SAFETY_REASON.ORDER_NOT_FOUND, { machine, item });
    order = db.prepare('SELECT * FROM orders WHERE id=?').get(resolvedOrderId);
    if (!order) return denied(MACHINE_SAFETY_REASON.ORDER_NOT_FOUND, { machine, item });
    if (!ELIGIBLE_ORDER_STATUSES.has(statusContracts.normalizeOrderStatus(order.status))) {
      return denied(MACHINE_SAFETY_REASON.ORDER_NOT_RELEASED_FOR_PRODUCTION, { machine, item, order });
    }
  }

  return {
    allowed: true,
    reason: null,
    details: {},
    machine,
    item,
    order,
    safetyAuthorization: issueAuthorization
      ? createSafetyAuthorization({
          machineId: resolvedMachineId,
          itemId: resolvedItemId,
          orderId: resolvedOrderId,
          operation,
        })
      : null,
  };
}

function assertMachineOperationAllowed(input) {
  const result = evaluateMachineOperationSafety(input);
  if (!result.allowed) throw new MachineSafetyError(result.reason, result.details);
  return result;
}

function assertMachineSafetyAuthorization(authorization, expected = {}) {
  if (!authorization || typeof authorization !== 'object' || !issuedAuthorizations.has(authorization)) {
    throw new MachineSafetyError(MACHINE_SAFETY_REASON.SAFETY_CONTEXT_REQUIRED);
  }
  if (Date.now() - authorization.issuedAt > AUTHORIZATION_TTL_MS) {
    throw new MachineSafetyError(MACHINE_SAFETY_REASON.SAFETY_AUTHORIZATION_EXPIRED);
  }

  const expectedMachineId = numericId(expected.machineId);
  const expectedItemId = numericId(expected.itemId);
  const expectedOrderId = numericId(expected.orderId);
  const mismatch = (expectedMachineId && authorization.machineId !== expectedMachineId)
    || (expectedItemId && authorization.itemId !== expectedItemId)
    || (expectedOrderId && authorization.orderId !== expectedOrderId)
    || (expected.operation && authorization.operation !== expected.operation);
  if (mismatch) {
    throw new MachineSafetyError(MACHINE_SAFETY_REASON.SAFETY_AUTHORIZATION_MISMATCH);
  }
  return authorization;
}

function isMachineSafetyError(error) {
  return error instanceof MachineSafetyError;
}

module.exports = {
  MACHINE_SAFETY_REASON,
  MachineSafetyError,
  evaluateMachineOperationSafety,
  assertMachineOperationAllowed,
  assertMachineSafetyAuthorization,
  isMachineSafetyError,
};
