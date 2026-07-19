'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RAW_MATERIAL_DIAGNOSTIC,
  calculateObservedRawMaterialBalance,
  classifyRawMaterialIntegrity,
} = require('../services/rawMaterialBalanceModel');

function observed(overrides = {}) {
  return {
    receivedKg: 100,
    legacyUsedCounterKg: 0,
    usageRowsKg: 0,
    scrappedCounterKg: 0,
    activeReservedKg: 0,
    consumedReservationKg: 0,
    releasedReservationKg: 0,
    ...overrides,
  };
}

function codes(rows) {
  return rows.map(row => row.code);
}

test('100 kg received with no use, reservation or scrap remains fully observed on hand', () => {
  const result = calculateObservedRawMaterialBalance(observed());
  assert.equal(result.counterPhysicalOnHand, 100);
  assert.equal(result.usageRowPhysicalOnHand, 100);
  assert.equal(result.reservationAwareAvailableFromCounter, 100);
  assert.equal(result.reservationAwareAvailableFromUsageRows, 100);
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.futureAuthoritativeBalance.status, 'review_required');
  assert.equal(result.futureAuthoritativeBalance.physicalOnHand, null);
});

test('legacy double-count pattern exposes 90 physical-style and 80 reservation-aware values', () => {
  const input = observed({ legacyUsedCounterKg: 10, usageRowsKg: 10, activeReservedKg: 10 });
  const balance = calculateObservedRawMaterialBalance(input);
  const diagnostics = classifyRawMaterialIntegrity({ balance, usageCount: 1, activeReservationCount: 1 });
  assert.equal(balance.counterPhysicalOnHand, 90);
  assert.equal(balance.usageRowPhysicalOnHand, 90);
  assert.equal(balance.reservationAwareAvailableFromCounter, 80);
  assert.equal(balance.reservationAwareAvailableFromUsageRows, 80);
  assert.ok(codes(diagnostics).includes(RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT));
  assert.ok(codes(diagnostics).includes(RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION));
});

test('counter and usage-row totals can agree without selecting confirmed production truth', () => {
  const result = calculateObservedRawMaterialBalance(observed({ legacyUsedCounterKg: 12.5, usageRowsKg: 12.5 }));
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.futureAuthoritativeBalance.available, null);
});

test('counter and usage-row disagreement is explicit and classified', () => {
  const balance = calculateObservedRawMaterialBalance(observed({ legacyUsedCounterKg: 10, usageRowsKg: 7 }));
  assert.deepEqual(balance.discrepancies, [{ code: 'counter_usage_mismatch', counterUsageDeltaKg: 3 }]);
  assert.ok(codes(classifyRawMaterialIntegrity({ balance })).includes(RAW_MATERIAL_DIAGNOSTIC.COUNTER_USAGE_MISMATCH));
});

test('active reservations above observed stock preserve negative availability and diagnostics', () => {
  const balance = calculateObservedRawMaterialBalance(observed({ activeReservedKg: 120 }));
  const diagnostics = classifyRawMaterialIntegrity({ balance, activeReservationCount: 1 });
  assert.equal(balance.reservationAwareAvailableFromCounter, -20);
  assert.equal(balance.reservationAwareAvailableFromUsageRows, -20);
  assert.ok(codes(diagnostics).includes(RAW_MATERIAL_DIAGNOSTIC.OVER_RESERVED));
  assert.ok(codes(diagnostics).includes(RAW_MATERIAL_DIAGNOSTIC.NEGATIVE_OBSERVED_AVAILABLE));
});

test('scrap is subtracted exactly once in both observed formulas', () => {
  const result = calculateObservedRawMaterialBalance(observed({ legacyUsedCounterKg: 10, usageRowsKg: 10, scrappedCounterKg: 5 }));
  assert.equal(result.counterPhysicalOnHand, 85);
  assert.equal(result.usageRowPhysicalOnHand, 85);
});

test('floating quantities are rounded deterministically to three decimals', () => {
  const result = calculateObservedRawMaterialBalance(observed({ receivedKg: 100.1234, legacyUsedCounterKg: 10.1116, usageRowsKg: 10.1116, activeReservedKg: 0.0006 }));
  assert.equal(result.counterPhysicalOnHand, 90.011);
  assert.equal(result.reservationAwareAvailableFromCounter, 90.01);
});

test('invalid and non-finite quantities are rejected with stable field-specific errors', () => {
  assert.throws(() => calculateObservedRawMaterialBalance(observed({ receivedKg: NaN })), {
    name: 'RangeError', message: 'invalid_raw_material_quantity:receivedKg',
  });
  assert.throws(() => calculateObservedRawMaterialBalance(observed({ usageRowsKg: Infinity })), {
    name: 'RangeError', message: 'invalid_raw_material_quantity:usageRowsKg',
  });
  assert.throws(() => calculateObservedRawMaterialBalance(observed({ activeReservedKg: -1 })), {
    name: 'RangeError', message: 'invalid_raw_material_quantity:activeReservedKg',
  });
});

test('balance calculation does not mutate its input', () => {
  const input = observed({ legacyUsedCounterKg: 10 });
  const before = structuredClone(input);
  calculateObservedRawMaterialBalance(input);
  assert.deepEqual(input, before);
});

test('reservation-only demand before production is not automatically classified as a defect', () => {
  const balance = calculateObservedRawMaterialBalance(observed({ receivedKg: 0, activeReservedKg: 10 }));
  const diagnostics = classifyRawMaterialIntegrity({ balance, scope: 'demand', activeReservationCount: 1, productionEvidence: false });
  assert.deepEqual(diagnostics, []);
});
