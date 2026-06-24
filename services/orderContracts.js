'use strict';

const {
  ORDER_STATUS,
  normalizeOrderStatus,
  isValidOrderStatus,
  isValidOrderTransition,
  allowedOrderTransitions,
} = require('../status-contracts');

const ORDER_CONTRACT = Object.freeze({
  version: 1,
  identity: Object.freeze(['id', 'order_num', 'stable_order_id']),
  approvalRoles: Object.freeze(['manager', 'admin']),
  statusField: 'status',
});

const ORDER_ITEM_CONTRACT = Object.freeze({
  version: 1,
  identity: Object.freeze(['id', 'item_uid']),
  quantityField: 'quantity',
  shapeSnapshotField: 'shape_snapshot_json',
});

function createStableOrderId(orderNum) {
  const value = String(orderNum || '').trim();
  if (!value) throw Object.assign(new Error('order_num is required for stable order identity'), { statusCode: 400 });
  return value;
}

function buildOrderItemUid(orderId, itemId) {
  return 'order-' + Number(orderId) + ':item-' + Number(itemId);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildShapeSnapshot(item = {}) {
  const snapshot = {
    contract: 'ORDER_ITEM_SHAPE_SNAPSHOT',
    version: ORDER_ITEM_CONTRACT.version,
    shapeId: item.shapeId ?? item.shape_id ?? null,
    shapeName: item.shapeName ?? item.shape_name ?? null,
    diameter: numberOrNull(item.diameter),
    totalLengthMm: numberOrNull(item.totalLengthMm ?? item.total_length_mm),
    spiralDiameterMm: numberOrNull(item.spiralDiameterMm ?? item.spiral_diameter_mm),
    spiralTurns: numberOrNull(item.spiralTurns ?? item.spiral_turns),
    is3d: Boolean(item.is3d ?? item.is_3d),
    segments: parseJsonArray(item.segments).map(segment => ({
      length_mm: numberOrNull(segment.length_mm ?? segment.length),
      angle_deg: numberOrNull(segment.angle_deg ?? segment.angle),
    })),
  };
  return Object.freeze(snapshot);
}

function shapeSnapshotJson(item = {}) {
  return JSON.stringify(buildShapeSnapshot(item));
}

function canManagerApproveOrder(role) {
  return ORDER_CONTRACT.approvalRoles.includes(String(role || ''));
}

function isOrderApprovalTransition(from, to) {
  const normalizedFrom = normalizeOrderStatus(from);
  const normalizedTo = normalizeOrderStatus(to);
  return normalizedTo === ORDER_STATUS.APPROVED_WAITING_PRODUCTION && (
    normalizedFrom === ORDER_STATUS.PENDING_APPROVAL ||
    normalizedFrom === ORDER_STATUS.CUSTOMER_PENDING_APPROVAL
  );
}

function assertOrderStatusTransition({ from, to, role }) {
  const normalizedFrom = normalizeOrderStatus(from);
  const normalizedTo = normalizeOrderStatus(to);
  if (!isValidOrderStatus(normalizedTo)) {
    throw Object.assign(new Error('invalid order status'), { statusCode: 400, allowed: Object.values(ORDER_STATUS) });
  }
  if (!isValidOrderTransition(normalizedFrom, normalizedTo)) {
    throw Object.assign(new Error('invalid order status transition'), {
      statusCode: 409,
      from: normalizedFrom,
      to: normalizedTo,
      allowed: allowedOrderTransitions(normalizedFrom),
    });
  }
  if (isOrderApprovalTransition(normalizedFrom, normalizedTo) && !canManagerApproveOrder(role)) {
    throw Object.assign(new Error('manager approval required'), { statusCode: 403 });
  }
  return { from: normalizedFrom, to: normalizedTo, isApproval: isOrderApprovalTransition(normalizedFrom, normalizedTo) };
}

module.exports = {
  ORDER_CONTRACT,
  ORDER_ITEM_CONTRACT,
  createStableOrderId,
  buildOrderItemUid,
  buildShapeSnapshot,
  shapeSnapshotJson,
  canManagerApproveOrder,
  isOrderApprovalTransition,
  assertOrderStatusTransition,
};
