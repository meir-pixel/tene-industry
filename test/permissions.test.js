const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ROLE_PERMISSIONS,
  getRolePermission,
  normalizeRole,
  requireAnyRole,
  requireRole,
  roleMeetsMinimum,
} = require('../permissions');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('role model includes Sprint 1 target roles', () => {
  for (const role of ['admin', 'manager', 'office', 'finance', 'production', 'quality', 'maintenance', 'warehouse', 'driver', 'sales', 'kiosk', 'viewer']) {
    assert.ok(ROLE_PERMISSIONS[role], `missing role: ${role}`);
  }
  assert.equal(ROLE_PERMISSIONS.customer, undefined);
  assert.equal(ROLE_PERMISSIONS.supplier, undefined);
});

test('operator is a migration alias for kiosk only', () => {
  assert.equal(normalizeRole('operator'), 'kiosk');
  assert.equal(getRolePermission('operator').role, 'kiosk');
  assert.equal(roleMeetsMinimum('operator', 'kiosk'), true);
  assert.equal(roleMeetsMinimum('operator', 'production'), false);
});

test('requireRole rejects anonymous and spoofed header access', () => {
  const req = { headers: { 'x-user-role': 'admin', 'x-user-id': '1' } };
  const res = mockRes();
  let nextCalled = false;
  requireRole('admin')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireRole rejects wrong role and accepts admin JWT claims', () => {
  const deniedReq = { auth: { sub: '2', role: 'manager' } };
  const deniedRes = mockRes();
  let deniedNext = false;
  requireRole('admin')(deniedReq, deniedRes, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(deniedRes.statusCode, 403);

  const allowedReq = { auth: { sub: '1', role: 'admin' } };
  const allowedRes = mockRes();
  let allowedNext = false;
  requireRole('admin')(allowedReq, allowedRes, () => { allowedNext = true; });
  assert.equal(allowedNext, true);
  assert.equal(allowedReq.userRole, 'admin');
  assert.equal(allowedReq.userId, '1');
});

test('requireAnyRole accepts listed roles without hierarchy assumptions', () => {
  const financeReq = { auth: { sub: '3', role: 'finance' } };
  const financeRes = mockRes();
  let financeNext = false;
  requireAnyRole(['finance', 'manager', 'admin'])(financeReq, financeRes, () => { financeNext = true; });
  assert.equal(financeNext, true);
  assert.equal(financeReq.userRole, 'finance');

  const deniedReq = { auth: { sub: '4', role: 'office' } };
  const deniedRes = mockRes();
  let deniedNext = false;
  requireAnyRole(['finance', 'manager', 'admin'])(deniedReq, deniedRes, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(deniedRes.statusCode, 403);
});
