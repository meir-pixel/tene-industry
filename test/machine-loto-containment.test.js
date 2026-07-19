'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const modbus = require('../modbus');
const {
  MACHINE_COMMAND_REASON,
  MACHINE_AUTHORIZATION_TTL_MS,
  areMachineWritesEnabled,
  createMachineWriteAuthorization,
} = require('../services/machineSafetyGate');

async function withMachineWritesEnv(value, run) {
  const existed = Object.prototype.hasOwnProperty.call(process.env, 'MACHINE_WRITES_ENABLED');
  const previous = process.env.MACHINE_WRITES_ENABLED;
  if (value === undefined) delete process.env.MACHINE_WRITES_ENABLED;
  else process.env.MACHINE_WRITES_ENABLED = value;
  try {
    return await run();
  } finally {
    if (existed) process.env.MACHINE_WRITES_ENABLED = previous;
    else delete process.env.MACHINE_WRITES_ENABLED;
  }
}

function createWriteHarness() {
  const instance = modbus.init(null);
  const registerCalls = [];
  let clientLookups = 0;
  let connectionAttempts = 0;
  const client = {
    isOpen: true,
    writeRegisters: async (...args) => registerCalls.push(args),
    close: () => {},
  };
  instance.clients = new Proxy({ 1: client }, {
    get(target, key, receiver) {
      clientLookups += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  instance.connectMachine = async () => {
    connectionAttempts += 1;
    throw new Error('unexpected connection attempt');
  };
  return {
    instance,
    registerCalls,
    clientLookups: () => clientLookups,
    connectionAttempts: () => connectionAttempts,
  };
}

function writeCommand(overrides = {}) {
  return {
    diameter: 12,
    totalLengthMm: 1000,
    productionQty: 5,
    angles: [90, 135],
    itemId: 22,
    orderId: 33,
    ...overrides,
  };
}

async function expectWriteRejection({
  envValue,
  command = writeCommand(),
  reason,
}) {
  return withMachineWritesEnv(envValue, async () => {
    const harness = createWriteHarness();
    await assert.rejects(
      modbus.writeParams(1, command),
      error => error.code === reason
    );
    assert.equal(harness.clientLookups(), 0);
    assert.equal(harness.connectionAttempts(), 0);
    assert.equal(harness.registerCalls.length, 0);
  });
}

for (const [label, value] of [
  ['missing', undefined],
  ['empty', ''],
  ['false', 'false'],
  ['one', '1'],
  ['yes', 'yes'],
  ['uppercase true', 'TRUE'],
]) {
  test(`machine writes are disabled for ${label} MACHINE_WRITES_ENABLED`, async () => {
    await expectWriteRejection({
      envValue: value,
      reason: MACHINE_COMMAND_REASON.WRITES_DISABLED,
    });
  });
}

test('only lowercase true after outer trim enables the authorization path', async () => {
  assert.equal(areMachineWritesEnabled({ MACHINE_WRITES_ENABLED: ' true ' }), true);
  assert.equal(areMachineWritesEnabled({ MACHINE_WRITES_ENABLED: 'TRUE' }), false);
  await expectWriteRejection({
    envValue: ' true ',
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_REQUIRED,
  });
});

test('enabled writes reject missing and plain forged authorization before client lookup', async () => {
  await expectWriteRejection({
    envValue: 'true',
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_REQUIRED,
  });
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({
      safetyAuthorization: {
        approved: true,
        machineId: 1,
        operation: 'write_params',
      },
    }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_INVALID,
  });
});

test('valid authorization preserves the existing register payload and uses one mock client', async () => {
  await withMachineWritesEnv('true', async () => {
    const harness = createWriteHarness();
    const safetyAuthorization = createMachineWriteAuthorization({
      machineId: 1,
      operation: 'write_params',
      itemId: 22,
      orderId: 33,
    });

    await modbus.writeParams(1, writeCommand({ safetyAuthorization }));

    assert.equal(harness.clientLookups(), 1);
    assert.equal(harness.connectionAttempts(), 0);
    assert.deepEqual(harness.registerCalls, [
      [1, [12]],
      [2, [1000]],
      [3, [5]],
      [100, [90, 135]],
    ]);
  });
});

test('authorization for another machine is rejected before client lookup', async () => {
  const safetyAuthorization = createMachineWriteAuthorization({
    machineId: 2,
    operation: 'write_params',
    itemId: 22,
    orderId: 33,
  });
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({ safetyAuthorization }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH,
  });
});

test('authorization for another action is rejected before client lookup', async () => {
  const safetyAuthorization = createMachineWriteAuthorization({
    machineId: 1,
    operation: 'start_machine',
    itemId: 22,
    orderId: 33,
  });
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({ safetyAuthorization }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH,
  });
});

test('authorization is bound to optional item and order identifiers', async () => {
  const safetyAuthorization = createMachineWriteAuthorization({
    machineId: 1,
    operation: 'write_params',
    itemId: 999,
    orderId: 888,
  });
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({ safetyAuthorization }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_MISMATCH,
  });
});

test('expired authorization is rejected without a real delay', async () => {
  const safetyAuthorization = createMachineWriteAuthorization({
    machineId: 1,
    operation: 'write_params',
    itemId: 22,
    orderId: 33,
  }, {
    now: () => Date.now() - MACHINE_AUTHORIZATION_TTL_MS - 1,
  });
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({ safetyAuthorization }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_EXPIRED,
  });
});

test('copying or replacing authorization fields cannot manufacture authorization', async () => {
  const genuine = createMachineWriteAuthorization({
    machineId: 1,
    operation: 'write_params',
    itemId: 22,
    orderId: 33,
  });
  const copied = {
    ...genuine,
    machineId: '1',
    operation: 'write_params',
  };
  await expectWriteRejection({
    envValue: 'true',
    command: writeCommand({ safetyAuthorization: copied }),
    reason: MACHINE_COMMAND_REASON.AUTHORIZATION_INVALID,
  });
});
