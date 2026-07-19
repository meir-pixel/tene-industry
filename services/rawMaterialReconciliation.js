'use strict';

const {
  RAW_MATERIAL_DIAGNOSTIC,
  calculateObservedRawMaterialBalance,
  classifyRawMaterialIntegrity,
  compareDiagnostics,
} = require('./rawMaterialBalanceModel');

function roundKg(value) {
  return Number(Number(value || 0).toFixed(3));
}

function keyPart(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

function demandKey(orderId, itemId) {
  return `${keyPart(orderId)}|${keyPart(itemId)}`;
}

function stockKey(diameter, materialType) {
  return `${keyPart(diameter)}|${materialType || 'coil'}`;
}

function compareIds(left, right) {
  return (Number(left.rawMaterialId || 0) - Number(right.rawMaterialId || 0))
    || (Number(left.orderId || 0) - Number(right.orderId || 0))
    || (Number(left.itemId || 0) - Number(right.itemId || 0))
    || String(left.type || '').localeCompare(String(right.type || ''), 'en');
}

function productionEvidence(item) {
  if (!item) return false;
  const status = String(item.status || '').trim().toLowerCase();
  return Number(item.produced_qty || 0) > 0
    || Boolean(item.started_at)
    || Boolean(item.completed_at)
    || ['in_production', 'done', 'completed'].includes(status);
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
  `).all();
  const usages = db.prepare(`
    SELECT u.id, u.raw_material_id, u.order_id, u.item_id,
           COALESCE(u.weight_used, 0) AS weight_used,
           rm.id AS existing_raw_material_id,
           o.id AS existing_order_id,
           i.id AS existing_item_id,
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
           i.id AS existing_item_id,
           i.produced_qty, i.status AS item_status, i.started_at, i.completed_at
    FROM inventory_reservations r
    LEFT JOIN orders o ON o.id=r.order_id
    LEFT JOIN items i ON i.id=r.item_id
    ORDER BY r.id
  `).all();

  const usagesByLot = new Map();
  const demands = new Map();
  const stockPositions = new Map();
  const orphans = [];

  function demand(orderId, itemId) {
    const key = demandKey(orderId, itemId);
    if (!demands.has(key)) demands.set(key, {
      orderId: orderId ?? null,
      itemId: itemId ?? null,
      usageCount: 0,
      usageRowsKg: 0,
      reservationCount: 0,
      activeReservationCount: 0,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
      diameter: null,
      materialType: null,
      productionEvidence: false,
      usageIds: [],
      reservationIds: [],
    });
    return demands.get(key);
  }

  for (const row of rawMaterials) {
    const key = stockKey(row.diameter, row.material_type);
    if (!stockPositions.has(key)) stockPositions.set(key, {
      diameter: row.diameter,
      materialType: row.material_type,
      rawMaterialIds: [],
      receivedKg: 0,
      legacyUsedCounterKg: 0,
      usageRowsKg: 0,
      scrappedCounterKg: 0,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
    });
    const stock = stockPositions.get(key);
    stock.rawMaterialIds.push(row.id);
    stock.receivedKg += Number(row.weight_received || 0);
    stock.legacyUsedCounterKg += Number(row.weight_used || 0);
    stock.scrappedCounterKg += Number(row.weight_scrapped || 0);
  }

  for (const row of usages) {
    if (!usagesByLot.has(row.raw_material_id)) usagesByLot.set(row.raw_material_id, []);
    usagesByLot.get(row.raw_material_id).push(row);
    const currentDemand = demand(row.order_id, row.item_id);
    currentDemand.usageCount += 1;
    currentDemand.usageRowsKg += Number(row.weight_used || 0);
    currentDemand.usageIds.push(row.id);
    currentDemand.productionEvidence ||= productionEvidence({
      produced_qty: row.produced_qty,
      status: row.item_status,
      started_at: row.started_at,
      completed_at: row.completed_at,
    });

    const material = rawMaterials.find(candidate => candidate.id === row.raw_material_id);
    if (material) {
      stockPositions.get(stockKey(material.diameter, material.material_type)).usageRowsKg += Number(row.weight_used || 0);
    }

    const missing = [];
    if (row.existing_raw_material_id === null) missing.push('raw_material');
    if (row.order_id !== null && row.existing_order_id === null) missing.push('order');
    if (row.item_id !== null && row.existing_item_id === null) missing.push('item');
    if (missing.length) orphans.push({
      type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE,
      usageId: row.id,
      rawMaterialId: row.raw_material_id,
      orderId: row.order_id,
      itemId: row.item_id,
      missing,
    });
  }

  for (const row of reservations) {
    const currentDemand = demand(row.order_id, row.item_id);
    currentDemand.reservationCount += 1;
    currentDemand.reservationIds.push(row.id);
    currentDemand.diameter ??= row.diameter;
    currentDemand.materialType ??= row.material_type;
    currentDemand.productionEvidence ||= productionEvidence({
      produced_qty: row.produced_qty,
      status: row.item_status,
      started_at: row.started_at,
      completed_at: row.completed_at,
    });
    const weight = Number(row.reserved_kg || 0);
    if (row.status === 'active') {
      currentDemand.activeReservationCount += 1;
      currentDemand.activeReservedKg += weight;
    } else if (row.status === 'consumed') {
      currentDemand.consumedReservationKg += weight;
    } else if (row.status === 'released') {
      currentDemand.releasedReservationKg += weight;
    }

    const reservationStockKey = stockKey(row.diameter, row.material_type);
    if (!stockPositions.has(reservationStockKey)) stockPositions.set(reservationStockKey, {
      diameter: row.diameter,
      materialType: row.material_type,
      rawMaterialIds: [],
      receivedKg: 0,
      legacyUsedCounterKg: 0,
      usageRowsKg: 0,
      scrappedCounterKg: 0,
      activeReservedKg: 0,
      consumedReservationKg: 0,
      releasedReservationKg: 0,
    });
    const stock = stockPositions.get(reservationStockKey);
    if (stock) {
      if (row.status === 'active') stock.activeReservedKg += weight;
      if (row.status === 'consumed') stock.consumedReservationKg += weight;
      if (row.status === 'released') stock.releasedReservationKg += weight;
    }

    const missing = [];
    if (row.existing_order_id === null) missing.push('order');
    if (row.item_id !== null && row.existing_item_id === null) missing.push('item');
    if (missing.length) orphans.push({
      type: RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION,
      reservationId: row.id,
      orderId: row.order_id,
      itemId: row.item_id,
      missing,
    });
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
    };
  });

  const positionRows = [...stockPositions.values()]
    .map(row => {
      const observedBalance = calculateObservedRawMaterialBalance(row);
      const diagnostics = classifyRawMaterialIntegrity({
        balance: observedBalance,
        scope: 'stock',
        entity: { diameter: row.diameter, materialType: row.materialType },
        usageCount: usages.filter(usage => {
          const material = rawMaterials.find(candidate => candidate.id === usage.raw_material_id);
          return material && material.diameter === row.diameter && material.material_type === row.materialType;
        }).length,
        productionEvidence: usages.some(usage => {
          const material = rawMaterials.find(candidate => candidate.id === usage.raw_material_id);
          return material && material.diameter === row.diameter && material.material_type === row.materialType
            && productionEvidence({ produced_qty: usage.produced_qty, status: usage.item_status, started_at: usage.started_at, completed_at: usage.completed_at });
        }),
        ambiguousReservationAllocation: row.activeReservedKg + row.consumedReservationKg + row.releasedReservationKg > 0
          ? { rawMaterialIds: [...row.rawMaterialIds], reservationScope: 'diameter_material_bucket' }
          : null,
      });
      return {
        diameter: row.diameter,
        materialType: row.materialType,
        rawMaterialIds: [...row.rawMaterialIds],
        reservationScope: 'diameter_material_bucket',
        observedBalance,
        diagnostics,
      };
    })
    .sort((left, right) => Number(left.diameter) - Number(right.diameter)
      || left.materialType.localeCompare(right.materialType, 'en'));

  const demandRows = [...demands.values()].map(row => {
    const observedBalance = calculateObservedRawMaterialBalance({
      receivedKg: 0,
      legacyUsedCounterKg: 0,
      usageRowsKg: row.usageRowsKg,
      scrappedCounterKg: 0,
      activeReservedKg: row.activeReservedKg,
      consumedReservationKg: row.consumedReservationKg,
      releasedReservationKg: row.releasedReservationKg,
    });
    const orphanedUsage = orphans.find(orphan => orphan.type === RAW_MATERIAL_DIAGNOSTIC.ORPHANED_USAGE
      && orphan.orderId === row.orderId && orphan.itemId === row.itemId);
    const orphanedReservation = orphans.find(orphan => orphan.type === RAW_MATERIAL_DIAGNOSTIC.ORPHANED_RESERVATION
      && orphan.orderId === row.orderId && orphan.itemId === row.itemId);
    const diagnostics = classifyRawMaterialIntegrity({
      balance: observedBalance,
      scope: 'demand',
      entity: { orderId: row.orderId, itemId: row.itemId, diameter: row.diameter, materialType: row.materialType },
      usageCount: row.usageCount,
      activeReservationCount: row.activeReservationCount,
      productionEvidence: row.productionEvidence,
      orphanedUsage: orphanedUsage ? { usageIds: [...row.usageIds], missing: orphanedUsage.missing } : null,
      orphanedReservation: orphanedReservation ? { reservationIds: [...row.reservationIds], missing: orphanedReservation.missing } : null,
    });
    return {
      orderId: row.orderId,
      itemId: row.itemId,
      diameter: row.diameter,
      materialType: row.materialType,
      productionEvidence: row.productionEvidence,
      usageCount: row.usageCount,
      usageRowsKg: roundKg(row.usageRowsKg),
      reservationCount: row.reservationCount,
      activeReservationCount: row.activeReservationCount,
      activeReservedKg: roundKg(row.activeReservedKg),
      consumedReservationKg: roundKg(row.consumedReservationKg),
      releasedReservationKg: roundKg(row.releasedReservationKg),
      relationship: row.usageCount && row.reservationCount ? 'usage_and_reservation' : row.usageCount ? 'usage_only' : 'reservation_only',
      usageIds: [...row.usageIds],
      reservationIds: [...row.reservationIds],
      diagnostics,
    };
  }).sort((left, right) => Number(left.orderId || 0) - Number(right.orderId || 0)
    || Number(left.itemId || 0) - Number(right.itemId || 0));

  const diagnostics = [
    ...lots.flatMap(lot => classifyRawMaterialIntegrity({
      balance: lot.observedBalance,
      scope: 'lot',
      entity: { rawMaterialId: lot.rawMaterialId, diameter: lot.diameter, materialType: lot.materialType },
      usageCount: lot.usageIds.length,
      productionEvidence: lot.usageIds.some(id => {
        const usage = usages.find(row => row.id === id);
        return productionEvidence({ produced_qty: usage.produced_qty, status: usage.item_status, started_at: usage.started_at, completed_at: usage.completed_at });
      }),
    })),
    ...positionRows.flatMap(row => row.diagnostics),
    ...demandRows.flatMap(row => row.diagnostics),
  ].sort(compareDiagnostics);

  const diagnosticCounts = {};
  for (const row of diagnostics) diagnosticCounts[row.code] = (diagnosticCounts[row.code] || 0) + 1;

  return {
    reportVersion: 1,
    generatedAt,
    summary: {
      rawMaterialCount: rawMaterials.length,
      reservationCount: reservations.length,
      usageCount: usages.length,
      diagnosticCounts: Object.fromEntries(Object.entries(diagnosticCounts).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    },
    lots,
    stockPositions: positionRows,
    demands: demandRows,
    orphans: orphans.sort(compareIds),
    diagnostics,
  };
}

module.exports = {
  buildRawMaterialReconciliationReport,
};
