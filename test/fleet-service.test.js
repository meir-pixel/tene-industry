const assert = require('node:assert/strict');
const test = require('node:test');

const { daysUntil, vehicleHealth, vehicleInput } = require('../services/fleet');

test('daysUntil compares dates from local day boundary', () => {
  const now = new Date('2026-06-02T15:00:00');

  assert.equal(daysUntil('2026-06-02', now), 0);
  assert.equal(daysUntil('2026-06-03', now), 1);
  assert.equal(daysUntil('2026-06-01', now), -1);
  assert.equal(daysUntil('', now), null);
});

test('vehicleHealth marks missing, due-soon and overdue vehicle obligations', () => {
  const now = new Date('2026-06-02T12:00:00');
  const health = vehicleHealth({
    test_expiry: '2026-06-01',
    insurance_expiry: '2026-06-20',
    next_service_date: null,
    next_service_km: 12000,
    odometer_km: 12500,
  }, { now });

  assert.equal(health.status, 'danger');
  assert.deepEqual(health.missing, ['טיפול']);
  assert.deepEqual(health.dueSoon, ['ביטוח']);
  assert.deepEqual(health.overdue, ['טסט', 'טיפול לפי ק"מ']);
});

test('vehicleInput normalizes optional vehicle fields for database writes', () => {
  const input = vehicleInput({
    vehicle_desc: '',
    license_plate: '123-45-678',
    odometer_km: 88,
    active: 0,
  });

  assert.equal(input.vehicle_desc, null);
  assert.equal(input.license_plate, '123-45-678');
  assert.equal(input.vehicle_status, 'active');
  assert.equal(input.odometer_km, 88);
  assert.equal(input.active, 0);
});
