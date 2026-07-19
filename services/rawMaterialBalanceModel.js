'use strict';

const RAW_MATERIAL_DIAGNOSTIC = Object.freeze({
  PROBABLE_DOUBLE_COUNT: 'probable_double_count',
  COUNTER_USAGE_MISMATCH: 'counter_usage_mismatch',
  OVER_RESERVED: 'over_reserved',
  NEGATIVE_OBSERVED_AVAILABLE: 'negative_observed_available',
  USAGE_WITHOUT_RESERVATION: 'usage_without_reservation',
  RESERVATION_WITHOUT_USAGE: 'reservation_without_usage',
  RELEASED_RESERVATION_WITH_USAGE: 'released_reservation_with_usage',
  CONSUMED_RESERVATION_WITHOUT_USAGE: 'consumed_reservation_without_usage',
  ORPHANED_USAGE: 'orphaned_usage',
  ORPHANED_RESERVATION: 'orphaned_reservation',
  AMBIGUOUS_HISTORICAL_CONSUMPTION: 'ambiguous_historical_consumption',
  MANUAL_REVIEW_REQUIRED: 'manual_review_required',
  DUPLICATE_RESERVATION: 'duplicate_reservation',
  AMBIGUOUS_RESERVATION_ALLOCATION: 'ambiguous_reservation_allocation',
});

const DIAGNOSTIC_DEFINITION = Object.freeze({
  [RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT]: ['warning', 'usage_and_active_reservation_overlap'],
  [RAW_MATERIAL_DIAGNOSTIC.COUNTER_USAGE_MISMATCH]: ['error', 'legacy_counter_differs_from_usage_rows'],
  [RAW_MATERIAL_DIAGNOSTIC.OVER_RESERVED]: ['error', 'active_reservation_exceeds_observed_on_hand'],
  [RAW_MATERIAL_DIAGNOSTIC.NEGATIVE_OBSERVED_AVAILABLE]: ['error', 'observed_available_is_negative'],
  [RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION]: ['review', 'usage_has_no_related_reservation'],
  [RAW_MATERIAL_DIAGNOSTIC.RESERVATION_WITHOUT_USAGE]: ['review', 'started_demand_has_reservation_without_usage'],
  [RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE]: ['warning', 'released_reservation_retains_legacy_usage'],
  [RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE]: ['error', 'consumed_reservation_has_no_usage_row'],
  [RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE]: ['error', 'usage_reference_is_orphaned'],
  [RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION]: ['error', 'reservation_reference_is_orphaned'],
  [RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION]: ['review', 'usage_lacks_production_evidence'],
  [RAW_MATERIAL_DIAGNOSTIC.MANUAL_REVIEW_REQUIRED]: ['review', 'legacy_evidence_requires_manual_review'],
  [RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION]: ['error', 'multiple_active_reservations_for_demand'],
  [RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_RESERVATION_ALLOCATION]: ['review', 'reservation_has_no_raw_material_lot_link'],
});

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, review: 2 });
const OBSERVED_FIELDS = Object.freeze([
  'receivedKg',
  'legacyUsedCounterKg',
  'usageRowsKg',
  'scrappedCounterKg',
  'activeReservedKg',
  'consumedReservationKg',
  'releasedReservationKg',
]);

function roundKg(value) {
  return Number(Number(value).toFixed(3));
}

function normalizeObservedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('raw_material_observed_input_required');
  }

  const normalized = {};
  for (const field of OBSERVED_FIELDS) {
    const value = input[field] === undefined || input[field] === null ? 0 : Number(input[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`invalid_raw_material_quantity:${field}`);
    }
    normalized[field] = roundKg(value);
  }
  return normalized;
}

function calculateObservedRawMaterialBalance(input) {
  const observed = normalizeObservedInput(input);
  const counterPhysicalOnHand = roundKg(
    observed.receivedKg - observed.legacyUsedCounterKg - observed.scrappedCounterKg
  );
  const usageRowPhysicalOnHand = roundKg(
    observed.receivedKg - observed.usageRowsKg - observed.scrappedCounterKg
  );
  const reservationAwareAvailableFromCounter = roundKg(
    counterPhysicalOnHand - observed.activeReservedKg
  );
  const reservationAwareAvailableFromUsageRows = roundKg(
    usageRowPhysicalOnHand - observed.activeReservedKg
  );
  const counterUsageDeltaKg = roundKg(observed.legacyUsedCounterKg - observed.usageRowsKg);

  return {
    observed,
    counterPhysicalOnHand,
    usageRowPhysicalOnHand,
    reservationAwareAvailableFromCounter,
    reservationAwareAvailableFromUsageRows,
    discrepancies: counterUsageDeltaKg === 0 ? [] : [{
      code: RAW_MATERIAL_DIAGNOSTIC.COUNTER_USAGE_MISMATCH,
      counterUsageDeltaKg,
    }],
    futureAuthoritativeBalance: {
      status: 'review_required',
      physicalOnHand: null,
      available: null,
      formula: {
        physicalOnHand: 'approvedReceipts-confirmedConsumption-confirmedScrap',
        available: 'physicalOnHand-openReserved',
      },
      reason: 'confirmed_consumption_ledger_unavailable',
    },
  };
}

function diagnostic(code, entity, evidence = {}) {
  const definition = DIAGNOSTIC_DEFINITION[code];
  if (!definition) throw new Error(`unknown_raw_material_diagnostic:${code}`);
  return {
    code,
    severity: definition[0],
    entity: {
      rawMaterialId: entity.rawMaterialId ?? null,
      orderId: entity.orderId ?? null,
      itemId: entity.itemId ?? null,
      diameter: entity.diameter ?? null,
      materialType: entity.materialType ?? null,
    },
    evidence,
    explanationKey: definition[1],
  };
}

function compareNullable(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'en');
}

function compareDiagnostics(left, right) {
  return (SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity])
    || left.code.localeCompare(right.code, 'en')
    || compareNullable(left.entity.rawMaterialId, right.entity.rawMaterialId)
    || compareNullable(left.entity.orderId, right.entity.orderId)
    || compareNullable(left.entity.itemId, right.entity.itemId)
    || compareNullable(left.entity.diameter, right.entity.diameter)
    || compareNullable(left.entity.materialType, right.entity.materialType);
}

function classifyRawMaterialIntegrity(input = {}) {
  const balance = input.balance || calculateObservedRawMaterialBalance(input.observed || input);
  const observed = balance.observed;
  const entity = input.entity || {};
  const usageCount = Number(input.usageCount || 0);
  const activeReservationCount = Number(input.activeReservationCount || 0);
  const productionEvidence = Boolean(input.productionEvidence);
  const diagnostics = [];
  const add = (code, evidence) => diagnostics.push(diagnostic(code, entity, evidence));

  const includeStockDiagnostics = input.scope !== 'demand';
  const includeDemandRelationships = !['lot', 'stock'].includes(input.scope);

  if (includeStockDiagnostics && balance.discrepancies.length) {
    add(RAW_MATERIAL_DIAGNOSTIC.COUNTER_USAGE_MISMATCH, {
      legacyUsedCounterKg: observed.legacyUsedCounterKg,
      usageRowsKg: observed.usageRowsKg,
      counterUsageDeltaKg: balance.discrepancies[0].counterUsageDeltaKg,
    });
  }
  if (includeStockDiagnostics && observed.activeReservedKg > Math.min(balance.counterPhysicalOnHand, balance.usageRowPhysicalOnHand)) {
    add(RAW_MATERIAL_DIAGNOSTIC.OVER_RESERVED, {
      activeReservedKg: observed.activeReservedKg,
      counterPhysicalOnHand: balance.counterPhysicalOnHand,
      usageRowPhysicalOnHand: balance.usageRowPhysicalOnHand,
    });
  }
  if (includeStockDiagnostics && (balance.reservationAwareAvailableFromCounter < 0 || balance.reservationAwareAvailableFromUsageRows < 0)) {
    add(RAW_MATERIAL_DIAGNOSTIC.NEGATIVE_OBSERVED_AVAILABLE, {
      reservationAwareAvailableFromCounter: balance.reservationAwareAvailableFromCounter,
      reservationAwareAvailableFromUsageRows: balance.reservationAwareAvailableFromUsageRows,
    });
  }
  if (observed.usageRowsKg > 0 && observed.activeReservedKg > 0 && !productionEvidence) {
    add(RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT, {
      usageRowsKg: observed.usageRowsKg,
      activeReservedKg: observed.activeReservedKg,
    });
  }
  const totalReservationKg = roundKg(
    observed.activeReservedKg + observed.consumedReservationKg + observed.releasedReservationKg
  );
  if (includeDemandRelationships && observed.usageRowsKg > 0 && totalReservationKg === 0) {
    add(RAW_MATERIAL_DIAGNOSTIC.USAGE_WITHOUT_RESERVATION, { usageRowsKg: observed.usageRowsKg });
  }
  if (includeDemandRelationships && observed.activeReservedKg > 0 && observed.usageRowsKg === 0 && productionEvidence) {
    add(RAW_MATERIAL_DIAGNOSTIC.RESERVATION_WITHOUT_USAGE, {
      activeReservedKg: observed.activeReservedKg,
    });
  }
  if (includeDemandRelationships && observed.releasedReservationKg > 0 && observed.usageRowsKg > 0) {
    add(RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE, {
      releasedReservationKg: observed.releasedReservationKg,
      usageRowsKg: observed.usageRowsKg,
    });
  }
  if (includeDemandRelationships && observed.consumedReservationKg > 0 && observed.usageRowsKg === 0) {
    add(RAW_MATERIAL_DIAGNOSTIC.CONSUMED_RESERVATION_WITHOUT_USAGE, {
      consumedReservationKg: observed.consumedReservationKg,
    });
  }
  if (usageCount > 0 && !productionEvidence) {
    add(RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION, {
      usageCount,
      usageRowsKg: observed.usageRowsKg,
    });
  }
  if (includeDemandRelationships && activeReservationCount > 1) {
    add(RAW_MATERIAL_DIAGNOSTIC.DUPLICATE_RESERVATION, {
      activeReservationCount,
      activeReservedKg: observed.activeReservedKg,
    });
  }
  if (includeDemandRelationships && input.orphanedUsage) add(RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE, input.orphanedUsage);
  if (includeDemandRelationships && input.orphanedReservation) add(RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION, input.orphanedReservation);
  if (input.ambiguousReservationAllocation) {
    add(RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_RESERVATION_ALLOCATION, input.ambiguousReservationAllocation);
  }

  const needsManualReview = diagnostics.some(row => [
    RAW_MATERIAL_DIAGNOSTIC.PROBABLE_DOUBLE_COUNT,
    RAW_MATERIAL_DIAGNOSTIC.COUNTER_USAGE_MISMATCH,
    RAW_MATERIAL_DIAGNOSTIC.RELEASED_RESERVATION_WITH_USAGE,
    RAW_MATERIAL_DIAGNOSTIC.AMBIGUOUS_HISTORICAL_CONSUMPTION,
    RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE,
    RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION,
  ].includes(row.code));
  if (needsManualReview) add(RAW_MATERIAL_DIAGNOSTIC.MANUAL_REVIEW_REQUIRED, {
    diagnosticCodes: diagnostics.map(row => row.code).sort(),
  });

  return diagnostics.sort(compareDiagnostics);
}

module.exports = {
  RAW_MATERIAL_DIAGNOSTIC,
  calculateObservedRawMaterialBalance,
  classifyRawMaterialIntegrity,
  compareDiagnostics,
};
