const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_CORE_MODULES,
  createModuleGate,
} = require('../core/module-gates');

test('module gate keeps core modules open regardless of entitlements', () => {
  const gate = createModuleGate({
    isModuleEnabled: () => false,
    defaultLicenseMode: 'production',
  });

  for (const moduleId of DEFAULT_CORE_MODULES) {
    const decision = gate.checkModule(moduleId);
    assert.equal(decision.allowed, true, `${moduleId} should remain open`);
    assert.equal(decision.reason, 'core_module');
  }
});

test('module gate allows product modules in open development modes', () => {
  const gate = createModuleGate({
    isModuleEnabled: () => false,
    defaultLicenseMode: 'production',
  });

  for (const licenseMode of ['dev', 'development', 'test', 'free']) {
    const decision = gate.checkModule('orders', { licenseMode });
    assert.equal(decision.allowed, true, `${licenseMode} should be open`);
    assert.equal(decision.reason, 'open_mode');
  }
});

test('module gate blocks unlicensed product modules in production', () => {
  const gate = createModuleGate({
    isModuleEnabled: moduleId => moduleId === 'orders',
    defaultLicenseMode: 'production',
  });

  assert.deepEqual(gate.checkModule('orders'), {
    allowed: true,
    moduleId: 'orders',
    core: false,
    reason: 'licensed',
  });
  assert.deepEqual(gate.checkModule('finance'), {
    allowed: false,
    moduleId: 'finance',
    core: false,
    reason: 'module_not_licensed',
  });
});

test('module gate middleware returns 403 before route execution', () => {
  const gate = createModuleGate({
    isModuleEnabled: () => false,
    defaultLicenseMode: 'production',
  });
  const middleware = gate.requireModule('finance');
  const req = {};
  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, {
    error: 'Module is not included in this license',
    code: 'module_not_licensed',
    module: 'finance',
  });
});

test('module gate middleware calls next for licensed modules', () => {
  const gate = createModuleGate({
    isModuleEnabled: moduleId => moduleId === 'finance',
  });
  const middleware = gate.requireModule('finance');
  let nextCalled = false;

  middleware({}, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
