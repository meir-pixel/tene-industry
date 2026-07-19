'use strict';

const MACHINE_COMMAND_REASON = Object.freeze({
  WRITES_DISABLED: 'machine_writes_disabled',
  AUTHORIZATION_REQUIRED: 'machine_authorization_required',
  AUTHORIZATION_INVALID: 'machine_authorization_invalid',
  AUTHORIZATION_EXPIRED: 'machine_authorization_expired',
  AUTHORIZATION_MISMATCH: 'machine_authorization_mismatch',
});

const MACHINE_AUTHORIZATION_TTL_MS = 5000;
const issuedAuthorizations = new WeakSet();

class MachineCommandError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'MachineCommandError';
    this.code = reason;
    this.reason = reason;
  }
}

function areMachineWritesEnabled(env = process.env) {
  return String(env?.MACHINE_WRITES_ENABLED || '').trim() === 'true';
}

function requiredIdentity(value, reason = MACHINE_COMMAND_REASON.AUTHORIZATION_INVALID) {
  const identity = String(value ?? '').trim();
  if (!identity) throw new MachineCommandError(reason);
  return identity;
}

function optionalIdentity(value) {
  const identity = String(value ?? '').trim();
  return identity || null;
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : Date.now();
  if (!Number.isFinite(value)) {
    throw new MachineCommandError(MACHINE_COMMAND_REASON.AUTHORIZATION_INVALID);
  }
  return value;
}

function createMachineWriteAuthorization({
  machineId,
  operation,
  itemId = null,
  orderId = null,
} = {}, {
  now = Date.now,
} = {}) {
  const authorization = Object.freeze({
    kind: 'machine_write_authorization',
    machineId: requiredIdentity(machineId),
    operation: requiredIdentity(operation),
    itemId: optionalIdentity(itemId),
    orderId: optionalIdentity(orderId),
    issuedAt: resolveNow(now),
  });
  issuedAuthorizations.add(authorization);
  return authorization;
}

function assertMachineWriteAuthorization(authorization, {
  machineId,
  operation,
  itemId = null,
  orderId = null,
} = {}, {
  now = Date.now,
} = {}) {
  if (!authorization) {
    throw new MachineCommandError(MACHINE_COMMAND_REASON.AUTHORIZATION_REQUIRED);
  }
  if (typeof authorization !== 'object' || !issuedAuthorizations.has(authorization)) {
    throw new MachineCommandError(MACHINE_COMMAND_REASON.AUTHORIZATION_INVALID);
  }

  const currentTime = resolveNow(now);
  if (currentTime - authorization.issuedAt > MACHINE_AUTHORIZATION_TTL_MS) {
    throw new MachineCommandError(MACHINE_COMMAND_REASON.AUTHORIZATION_EXPIRED);
  }

  const expectedMachineId = requiredIdentity(
    machineId,
    MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH
  );
  const expectedOperation = requiredIdentity(
    operation,
    MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH
  );
  const expectedItemId = optionalIdentity(itemId);
  const expectedOrderId = optionalIdentity(orderId);
  if (
    authorization.machineId !== expectedMachineId
    || authorization.operation !== expectedOperation
    || authorization.itemId !== expectedItemId
    || authorization.orderId !== expectedOrderId
  ) {
    throw new MachineCommandError(MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH);
  }
  return authorization;
}

module.exports = {
  MACHINE_COMMAND_REASON,
  MACHINE_AUTHORIZATION_TTL_MS,
  MachineCommandError,
  areMachineWritesEnabled,
  createMachineWriteAuthorization,
  assertMachineWriteAuthorization,
};
