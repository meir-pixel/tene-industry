const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ORDER_STATUS,
  ITEM_STATUS,
  normalizeOrderStatus,
  isValidOrderTransition,
  allowedOrderTransitions,
  isValidOrderStatus,
  isValidItemStatus
} = require('../status-contracts');

test('order status aliases normalize to canonical values', () => {
  assert.equal(normalizeOrderStatus('אושרה'), ORDER_STATUS.APPROVED_WAITING_PRODUCTION);
  assert.equal(normalizeOrderStatus('מאושר'), ORDER_STATUS.APPROVED_WAITING_PRODUCTION);
  assert.equal(normalizeOrderStatus('סופק'), ORDER_STATUS.DELIVERED_CONFIRMED);
  assert.equal(normalizeOrderStatus('בוטל'), ORDER_STATUS.CANCELLED);
});

test('order status transitions accept valid moves and reject invalid skips', () => {
  assert.equal(
    isValidOrderTransition(ORDER_STATUS.PENDING_APPROVAL, ORDER_STATUS.APPROVED_WAITING_PRODUCTION),
    true
  );
  assert.equal(
    isValidOrderTransition(ORDER_STATUS.PENDING_APPROVAL, ORDER_STATUS.IN_PRODUCTION),
    false
  );
  assert.deepEqual(
    allowedOrderTransitions(ORDER_STATUS.SENT),
    [ORDER_STATUS.DELIVERED_CONFIRMED]
  );
});

test('production item statuses are centralized', () => {
  assert.equal(isValidItemStatus(ITEM_STATUS.WAITING), true);
  assert.equal(isValidItemStatus(ITEM_STATUS.IN_PRODUCTION), true);
  assert.equal(isValidItemStatus(ITEM_STATUS.DONE), true);
  assert.equal(isValidItemStatus('bad-status'), false);
});


test('unknown order statuses are rejected by the order contract', () => {
  assert.equal(isValidOrderStatus(ORDER_STATUS.PENDING_APPROVAL), true);
  assert.equal(isValidOrderStatus('bad-order-status'), false);
});
