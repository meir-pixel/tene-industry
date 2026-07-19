'use strict';

const {
  RAW_MATERIAL_DIAGNOSTIC,
  calculateObservedRawMaterialBalance,
  classifyRawMaterialIntegrity,
  compareDiagnostics,
} = require('./rawMaterialBalanceModel');

const RECOGNIZED_RESERVATION_STATUSES = new Set(['active', 'consumed', 'released']);
const SUPPORTING_PRODUCTION_STATUSES = new Set(['בייצור', 'הושלם', 'in_production', 'done', 'completed']);

function roundKg(value) {
  return Number(Number(value || 0).toFixed(3));
}

function normalizeDiameter(value) {
  const diameter = Number(value);
  return Number.isFinite(diameter) ? diameter : value;
}

function normalizeMaterialType(value) {
  return String(value || 'coil').trim().toLowerCase() || 'coil';
}

function keyPart(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

function demandKey(orderId, itemId) {
  return `${keyPart(orderId)}|${keyPart(itemId)}`;
}

function stockKey(diameter, materialType) {
  return `${keyPart(normalizeDiameter(diameter))}|${normalizeMaterialType(materialType)}`;
}

function compareIds(left, right) {
  return (Number(left.rawMaterialId || 0) - Number(right.rawMaterialId || 0))
    || (Number(left.orderId || 0) - Number(right.orderId || 0))
    || (Number(left.itemId || 0) - Number(right.itemId || 0))
    || (Number(left.usageId || 0) - Number(right.usageId || 0))
    || (Number(left.reservationId || 0) - Number(right.reservationId || 0))
    || String(left.type || '').localeCompare(String(right.type || ''), 'en');
}

function supportingProductionEvidence(row) {
  const status = row?.item_status ?? null;
  const normalizedStatus = String(status || '').trim().toLowerCase();
  return {
    producedQty: row?.produced_qty === null || row?.produced_qty === undefined ? null : Number(row.produced_qty),
    status,
    startedAt: row?.started_at ?? null,
    completedAt: row?.completed_at ?? null,
    recognizedStatus: SUPPORTING_PRODUCTION_STATUSES.has(normalizedStatus),
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

function diagnosticKey(row) {
  return JSON.stringify(canonicalValue({
    code: row.code,
    scope: row.scope,
    entity: row.entity,
    evidence: row.evidence,
  }));
}

function deduplicateDiagnostics(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = diagnosticKey(row);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()].sort(compareDiagnostics);
}

function emptyObserved(overrides = {}) {
  return {
    receivedKg: 0,
    legacyUsedCounterKg: 0,
    usageRowsKg: 0,
    scrappedCounterKg: 0,
    activeReservedKg: 0,
    consumedReservationKg: 0,
    releasedReservationKg: 0,
    ...overrides,
  };
}

function buildRawMaterialReconciliationReport(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('better_sqlite3_db_required');
  const clock = options.clock || (() => new Date());
  const generated = clock();
  const generatedAt = generated instanceof Date ? generated.toISOString() : new Date(generated).toISOString();

  const rawMaterials = db.prepare(`
    SELECT id, diameter, COALESCE(material_type, 'coil') AS material_type,
           COALESCE(weight_received, 0) AS weight_received,
           COALESCE(weight_used, 0) AS weight_used,
           COALESCE(weight_scrapped, 0) AS weight_scrapped,
           COALESCE(active, 1) AS active
    FROM raw_material
    ORDER BY id
  `).all().map(row => ({
    ...row,
    diameter: normalizeDiameter(row.diameter),
    material_type: normalizeMaterialType(row.material_type),
  }));
  const usages = db.prepare(`
    SELECT u.id, u.raw_material_id, u.order_id, u.item_id,
           COALESCE(u.weight_used, 0) AS weight_used,
           rm.id AS existing_raw_material_id,
           o.id AS existing_order_id,
           i.id AS existing_item_id, i.order_id AS item_order_id,
           i.produced_qty, i.status AS item_status, i.started_at, i.completed_at
    FROM raw_material_usage u
    LEFT JOIN raw_material rm ON rm.id=u.raw_material_id
    LEFT JOIN orders o ON o.id=u.order_id
    LEFT JOIN items i ON i.id=u.item_id
    ORDER BY u.id
  `).all();
  const reservations = db.prepare(`
    SELECT r.id, r.order_id, r.item_id, r.diameter,
           COALESCE(r.material_type, 'coil') AS material_type,
           COALESCE(r.reserved_kg, 0) AS reserved_kg, r.status,
           o.id AS existing_order_id,
           i.id AS existing_item_id, i.order_id AS item_order_id,
           i.produced_qty, i.status AS item_status, i.started_at, i.completed_at
    FROM inventory_reservations r
    LEFT JOIN orders o ON o.id=r.order_id
    LEFT JOIN items i ON i.id=r.item_id
    ORDER BY r.id
  `).all().map(row => ({
    ...row,
    diameter: normalizeDiameter(row.diameter),
    material_type: normalizeMaterialType(row.material_type),
  }));

  const rawMaterialById = new Map(rawMaterials.map(row => [row.id, row]));
  const usagesByLot = new Map();
  const demands = new Map();
  const stockPositions = new Map();
  const orphans = [];
  const referenceIssues = [];
  const referenceDiagnostics = [];

  function demand(orderId, itemId) {
    const key = demandKey(orderId, itemId);
    if (!demands.has(key)) demands.set(key, {
      orderId: orderId ?? null,
      itemId: itemId ?? null,
      usageCount: 0,
      usageRowsKg: 0,
      exactUsageCount: 0,
      exactUsageRowsKg: 0,
      usageIds: [],
      exactUsageIds: [],
      usageGroups: new Map(),
      reservationCount: 0,
      activeReservationCount: 0,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
      unknownReservationCount: 0,
      unknownReservedKg: 0,
      reservationIds: [],
      exactActiveGroups: new Map(),
      unknownReservations: [],
      supportingProductionEvidence: null,
    });
    return demands.get(key);
  }

  function stock(diameter, materialType) {
    const normalizedDiameter = normalizeDiameter(diameter);
    const normalizedMaterialType = normalizeMaterialType(materialType);
    const key = stockKey(normalizedDiameter, normalizedMaterialType);
    if (!stockPositions.has(key)) stockPositions.set(key, {
      diameter: normalizedDiameter,
      materialType: normalizedMaterialType,
      rawMaterialIds: [],
      receivedKg: 0,
      legacyUsedCounterKg: 0,
      usageRowsKg: 0,
      scrappedCounterKg: 0,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
      unknownReservationCount: 0,
      unknownReservedKg: 0,
      reservationIds: [],
    });
    return stockPositions.get(key);
  }

  function exactOwnership(row) {
    return row.order_id !== null
      && row.item_id !== null
      && row.existing_order_id !== null
      && row.existing_item_id !== null
      && Number(row.item_order_id) === Number(row.order_id);
  }

  function ownershipMismatch(row) {
    return row.order_id !== null
      && row.item_id !== null
      && row.existing_order_id !== null
      && row.existing_item_id !== null
      && Number(row.item_order_id) !== Number(row.order_id);
  }

  for (const row of rawMaterials) {
    const currentStock = stock(row.diameter, row.material_type);
    currentStock.rawMaterialIds.push(row.id);
    currentStock.receivedKg += Number(row.weight_received || 0);
    currentStock.legacyUsedCounterKg += Number(row.weight_used || 0);
    currentStock.scrappedCounterKg += Number(row.weight_scrapped || 0);
  }

  for (const row of usages) {
    if (!usagesByLot.has(row.raw_material_id)) usagesByLot.set(row.raw_material_id, []);
    usagesByLot.get(row.raw_material_id).push(row);
    const currentDemand = demand(row.order_id, row.item_id);
    const weight = Number(row.weight_used || 0);
    const evidence = supportingProductionEvidence(row);
    currentDemand.usageCount += 1;
    currentDemand.usageRowsKg += weight;
    currentDemand.usageIds.push(row.id);
    currentDemand.supportingProductionEvidence ||= evidence;

    const material = rawMaterialById.get(row.raw_material_id);
    if (material) {
      stock(material.diameter, material.material_type).usageRowsKg += weight;
      if (exactOwnership(row)) {
        const groupKey = stockKey(material.diameter, material.material_type);
        if (!currentDemand.usageGroups.has(groupKey)) currentDemand.usageGroups.set(groupKey, {
          diameter: material.diameter,
          materialType: material.material_type,
          usageIds: [],
          usageRowsKg: 0,
        });
        const group = currentDemand.usageGroups.get(groupKey);
        group.usageIds.push(row.id);
        group.usageRowsKg += weight;
      }
    }
    if (exactOwnership(row)) {
      currentDemand.exactUsageCount += 1;
      currentDemand.exactUsageRowsKg += weight;
      currentDemand.exactUsageIds.push(row.id);
    }

    const missing = [];
    if (row.existing_raw_material_id === null) missing.push('raw_material');
    if (row.order_id !== null && row.existing_order_id === null) missing.push('order');
    if (row.item_id !== null && row.existing_item_id === null) missing.push('item');
    if (missing.length) {
      const orphan = {
        type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE,
        sourceKind: 'usage',
        usageId: row.id,
        rawMaterialId: row.raw_material_id ?? null,
        orderId: row.order_id ?? null,
        itemId: row.item_id ?? null,
        missing,
      };
      orphans.push(orphan);
      referenceDiagnostics.push(...classifyRawMaterialIntegrity({
        balance: calculateObservedRawMaterialBalance(emptyObserved()),
        scope: 'reference',
        entity: { rawMaterialId: row.raw_material_id, orderId: row.order_id, itemId: row.item_id },
        usageCount: 0,
        orphanedUsages: [orphan],
      }));
    }
    if (ownershipMismatch(row)) {
      const mismatch = {
        type: RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH,
        sourceKind: 'usage',
        sourceRowId: row.id,
        usageId: row.id,
        referencedOrderId: row.order_id,
        itemId: row.item_id,
        actualItemOrderId: row.item_order_id,
        rawMaterialId: row.raw_material_id ?? null,
        diameter: material?.diameter ?? null,
        materialType: material?.material_type ?? null,
      };
      referenceIssues.push(mismatch);
      referenceDiagnostics.push(...classifyRawMaterialIntegrity({
        balance: calculateObservedRawMaterialBalance(emptyObserved()),
        scope: 'reference',
        entity: { rawMaterialId: row.raw_material_id, orderId: row.order_id, itemId: row.item_id },
        usageCount: 0,
        itemOrderMismatches: [mismatch],
      }));
    }
    if (!exactOwnership(row)) {
      referenceDiagnostics.push(...classifyRawMaterialIntegrity({
        balance: calculateObservedRawMaterialBalance(emptyObserved({ usageRowsKg: weight })),
        scope: 'reference',
        entity: { rawMaterialId: row.raw_material_id, orderId: row.order_id, itemId: row.item_id },
        usageCount: 1,
        usageIds: [row.id],
        supportingProductionEvidence: evidence,
      }));
    }
  }

  for (const row of reservations) {
    const currentDemand = demand(row.order_id, row.item_id);
    const currentStock = stock(row.diameter, row.material_type);
    const weight = Number(row.reserved_kg || 0);
    currentDemand.reservationCount += 1;
    currentDemand.reservationIds.push(row.id);
    currentDemand.supportingProductionEvidence ||= supportingProductionEvidence(row);
    currentStock.reservationIds.push(row.id);

    if (row.status === 'active') {
      currentDemand.activeReservationCount += 1;
      currentDemand.activeReservedKg += weight;
      currentStock.activeReservedKg += weight;
      if (exactOwnership(row)) {
        const groupKey = stockKey(row.diameter, row.material_type);
        if (!currentDemand.exactActiveGroups.has(groupKey)) currentDemand.exactActiveGroups.set(groupKey, {
          diameter: row.diameter,
          materialType: row.material_type,
          rows: [],
        });
        currentDemand.exactActiveGroups.get(groupKey).rows.push({ id: row.id, reservedKg: roundKg(weight) });
      }
    } else if (row.status === 'consumed') {
      currentDemand.consumedReservationKg += weight;
      currentStock.consumedReservationKg += weight;
    } else if (row.status === 'released') {
      currentDemand.releasedReservationKg += weight;
      currentStock.releasedReservationKg += weight;
    } else {
      const unknown = {
        reservationId: row.id,
        rawStatus: row.status ?? null,
        reservedKg: roundKg(weight),
        orderId: row.order_id ?? null,
        itemId: row.item_id ?? null,
        diameter: row.diameter,
        materialType: row.material_type,
      };
      currentDemand.unknownReservationCount += 1;
      currentDemand.unknownReservedKg += weight;
      currentDemand.unknownReservations.push(unknown);
      currentStock.unknownReservationCount += 1;
      currentStock.unknownReservedKg += weight;
    }

    const missing = [];
    if (row.existing_order_id === null) missing.push('order');
    if (row.item_id !== null && row.existing_item_id === null) missing.push('item');
    if (missing.length) {
      const orphan = {
        type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION,
        sourceKind: 'reservation',
        reservationId: row.id,
        orderId: row.order_id ?? null,
        itemId: row.item_id ?? null,
        diameter: row.diameter,
        materialType: row.material_type,
        missing,
      };
      orphans.push(orphan);
      referenceDiagnostics.push(...classifyRawMaterialIntegrity({
        balance: calculateObservedRawMaterialBalance(emptyObserved()),
        scope: 'reference',
        entity: { orderId: row.order_id, itemId: row.item_id, diameter: row.diameter, materialType: row.material_type },
        usageCount: 0,
        orphanedReservations: [orphan],
      }));
    }
    if (ownershipMismatch(row)) {
      const mismatch = {
        type: RAW_MATERIAL_DIAGNOSTIC.ITEM_ORDER_MISMATCH,
        sourceKind: 'reservation',
        sourceRowId: row.id,
        reservationId: row.id,
        referencedOrderId: row.order_id,
        itemId: row.item_id,
        actualItemOrderId: row.item_order_id,
        rawMaterialId: null,
        diameter: row.diameter,
        materialType: row.material_type,
      };
      referenceIssues.push(mismatch);
      referenceDiagnostics.push(...classifyRawMaterialIntegrity({
        balance: calculateObservedRawMaterialBalance(emptyObserved()),
        scope: 'reference',
        entity: { orderId: row.order_id, itemId: row.item_id, diameter: row.diameter, materialType: row.material_type },
        usageCount: 0,
        itemOrderMismatches: [mismatch],
      }));
    }
  }

  const lots = rawMaterials.map(row => {
    const lotUsages = usagesByLot.get(row.id) || [];
    const observedBalance = calculateObservedRawMaterialBalance({
      receivedKg: row.weight_received,
      legacyUsedCounterKg: row.weight_used,
      usageRowsKg: lotUsages.reduce((sum, usage) => sum + Number(usage.weight_used || 0), 0),
      scrappedCounterKg: row.weight_scrapped,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
    });
    return {
      rawMaterialId: row.id,
      diameter: row.diameter,
      materialType: row.material_type,
      active: Boolean(row.active),
      usageIds: lotUsages.map(usage => usage.id),
      observedBalance,
      reservationAllocation: {
        status: 'unavailable',
        reason: 'inventory_reservations_has_no_raw_material_id',
      },
      diagnostics: classifyRawMaterialIntegrity({
        balance: observedBalance,
        scope: 'lot',
        entity: { rawMaterialId: row.id, diameter: row.diameter, materialType: row.material_type },
        usageCount: 0,
      }),
    };
  });

  const positionRows = [...stockPositions.values()].map(row => {
    const observedBalance = calculateObservedRawMaterialBalance(row);
    const diagnostics = classifyRawMaterialIntegrity({
      balance: observedBalance,
      scope: 'bucket',
      entity: { diameter: row.diameter, materialType: row.materialType },
      usageCount: 0,
      ambiguousReservationAllocation: row.reservationIds.length
        ? {
          reservationIds: [...row.reservationIds].sort((left, right) => left - right),
          rawMaterialIds: [...row.rawMaterialIds].sort((left, right) => left - right),
          reservationScope: 'diameter_material_bucket',
        }
        : null,
    });
    return {
      diameter: row.diameter,
      materialType: row.materialType,
      rawMaterialIds: [...row.rawMaterialIds].sort((left, right) => left - right),
      reservationScope: 'diameter_material_bucket',
      unknownReservationCount: row.unknownReservationCount,
      unknownReservedKg: roundKg(row.unknownReservedKg),
      observedBalance,
      diagnostics,
    };
  }).sort((left, right) => Number(left.diameter) - Number(right.diameter)
    || left.materialType.localeCompare(right.materialType, 'en'));

  const demandRows = [...demands.values()].map(row => {
    const exactDemandOverlaps = [];
    const duplicateReservationGroups = [];
    if (row.orderId !== null && row.itemId !== null) {
      for (const [groupKey, reservationGroup] of row.exactActiveGroups.entries()) {
        const usageGroup = row.usageGroups.get(groupKey);
        const reservationRows = [...reservationGroup.rows].sort((left, right) => left.id - right.id);
        if (usageGroup) exactDemandOverlaps.push({
          orderId: row.orderId,
          itemId: row.itemId,
          diameter: reservationGroup.diameter,
          materialType: reservationGroup.materialType,
          usageIds: [...usageGroup.usageIds].sort((left, right) => left - right),
          reservationIds: reservationRows.map(candidate => candidate.id),
          usageRowsKg: roundKg(usageGroup.usageRowsKg),
          activeReservedKg: roundKg(reservationRows.reduce((sum, candidate) => sum + candidate.reservedKg, 0)),
        });
        if (reservationRows.length > 1) duplicateReservationGroups.push({
          orderId: row.orderId,
          itemId: row.itemId,
          diameter: reservationGroup.diameter,
          materialType: reservationGroup.materialType,
          activeRowCount: reservationRows.length,
          totalActiveReservedKg: roundKg(reservationRows.reduce((sum, candidate) => sum + candidate.reservedKg, 0)),
          reservations: reservationRows.map(candidate => ({
            reservationId: candidate.id,
            reservedKg: candidate.reservedKg,
          })),
          reservationIds: reservationRows.map(candidate => candidate.id),
        });
      }
    }
    exactDemandOverlaps.sort((left, right) => Number(left.diameter) - Number(right.diameter)
      || left.materialType.localeCompare(right.materialType, 'en'));
    duplicateReservationGroups.sort((left, right) => Number(left.diameter) - Number(right.diameter)
      || left.materialType.localeCompare(right.materialType, 'en'));

    const diagnosticBalance = calculateObservedRawMaterialBalance(emptyObserved({
      usageRowsKg: row.exactUsageRowsKg,
      activeReservedKg: row.activeReservedKg,
      consumedReservationKg: row.consumedReservationKg,
      releasedReservationKg: row.releasedReservationKg,
    }));
    const diagnostics = classifyRawMaterialIntegrity({
      balance: diagnosticBalance,
      scope: 'demand',
      entity: { orderId: row.orderId, itemId: row.itemId },
      usageCount: row.exactUsageCount,
      usageIds: row.exactUsageIds,
      supportingProductionEvidence: row.supportingProductionEvidence,
      exactDemandOverlaps,
      duplicateReservationGroups,
      unknownReservations: row.unknownReservations,
    });

    return {
      orderId: row.orderId,
      itemId: row.itemId,
      supportingProductionEvidence: row.supportingProductionEvidence,
      usageCount: row.usageCount,
      usageRowsKg: roundKg(row.usageRowsKg),
      reservationCount: row.reservationCount,
      activeReservationCount: row.activeReservationCount,
      activeReservedKg: roundKg(row.activeReservedKg),
      consumedReservationKg: roundKg(row.consumedReservationKg),
      releasedReservationKg: roundKg(row.releasedReservationKg),
      unknownReservationCount: row.unknownReservationCount,
      unknownReservedKg: roundKg(row.unknownReservedKg),
      relationship: row.usageCount && row.reservationCount ? 'usage_and_reservation' : row.usageCount ? 'usage_only' : 'reservation_only',
      usageIds: [...row.usageIds].sort((left, right) => left - right),
      reservationIds: [...row.reservationIds].sort((left, right) => left - right),
      diagnostics,
    };
  }).sort((left, right) => Number(left.orderId || 0) - Number(right.orderId || 0)
    || Number(left.itemId || 0) - Number(right.itemId || 0));

  const diagnostics = deduplicateDiagnostics([
    ...lots.flatMap(row => row.diagnostics),
    ...positionRows.flatMap(row => row.diagnostics),
    ...demandRows.flatMap(row => row.diagnostics),
    ...referenceDiagnostics,
  ]);
  const diagnosticCounts = {};
  for (const row of diagnostics) diagnosticCounts[row.code] = (diagnosticCounts[row.code] || 0) + 1;

  const unknownReservationCount = reservations.filter(row => !RECOGNIZED_RESERVATION_STATUSES.has(row.status)).length;
  const unknownReservedKg = roundKg(reservations
    .filter(row => !RECOGNIZED_RESERVATION_STATUSES.has(row.status))
    .reduce((sum, row) => sum + Number(row.reserved_kg || 0), 0));

  return {
    reportVersion: 1,
    generatedAt,
    summary: {
      rawMaterialCount: rawMaterials.length,
      reservationCount: reservations.length,
      usageCount: usages.length,
      unknownReservationCount,
      unknownReservedKg,
      diagnosticCounts: Object.fromEntries(Object.entries(diagnosticCounts).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    },
    lots,
    stockPositions: positionRows,
    demands: demandRows,
    orphans: orphans.sort(compareIds),
    referenceIssues: referenceIssues.sort(compareIds),
    diagnostics,
  };
}

module.exports = {
  buildRawMaterialReconciliationReport,
};
