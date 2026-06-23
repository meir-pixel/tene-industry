const MATERIAL_TYPES = new Set(['coil', 'straight', 'bent']);
const STOCK_ALLOCATION_POLICIES = new Set(['auto_fifo', 'manual_required', 'disabled']);

function normalizeStockAllocationPolicy(value) {
  const policy = String(value || '').trim();
  return STOCK_ALLOCATION_POLICIES.has(policy) ? policy : 'auto_fifo';
}

function normalizeBendingShapeInput(input = {}) {
  const rawSegments = Array.isArray(input.bending_shape_segments)
    ? input.bending_shape_segments
    : (() => {
        try { return JSON.parse(input.bending_shape_segments || '[]'); }
        catch { return []; }
      })();
  const segments = rawSegments.map(segment => ({
    length_mm: Math.max(0, Number(segment.length_mm) || 0),
    angle_deg: Number(segment.angle_deg) || 180,
  })).filter(segment => segment.length_mm > 0);
  return {
    name: String(input.bending_shape_name || '').trim(),
    segments,
    source: String(input.bending_shape_source || 'manual').trim() || 'manual',
    confidence: input.bending_shape_confidence == null ? null : Number(input.bending_shape_confidence),
  };
}

function bendingShapeColumns(input = {}) {
  const shape = normalizeBendingShapeInput(input);
  return {
    name: shape.name || null,
    segments: shape.segments.length ? JSON.stringify(shape.segments) : null,
    source: shape.source,
    confidence: Number.isFinite(shape.confidence) ? shape.confidence : null,
  };
}

function normalizeReceiptReviewItem(item = {}) {
  const materialType = MATERIAL_TYPES.has(item.material_type) ? item.material_type : 'coil';
  const shape = bendingShapeColumns({
    bending_shape_name: item.bending_shape_name || item.shape_name,
    bending_shape_segments: item.bending_shape_segments || item.segments || [],
    bending_shape_source: item.bending_shape_source || 'supplier_delivery_note',
    bending_shape_confidence: item.bending_shape_confidence ?? item.confidence,
  });
  return {
    material_type: materialType,
    diameter: Number(item.diameter) || null,
    supplier_id: item.supplier_id || null,
    lot_number: item.lot_number || item.heat_number || null,
    certificate_num: item.certificate_num || null,
    grade: item.grade || 'B500B',
    received_date: item.received_date || null,
    weight_received: Number(item.weight_received ?? item.weight_kg ?? item.quantity_kg) || null,
    purchase_price: Number(item.purchase_price || 0) || 0,
    warehouse_loc: item.warehouse_loc || null,
    bending_shape_name: materialType === 'bent' ? shape.name : null,
    bending_shape_segments: materialType === 'bent' ? shape.segments : null,
    bending_shape_source: materialType === 'bent' ? shape.source : null,
    bending_shape_confidence: materialType === 'bent' ? shape.confidence : null,
    notes: item.notes || null,
  };
}

function parseReceiptReviewPayload(parsed = {}) {
  const items = Array.isArray(parsed.items) ? parsed.items.map(normalizeReceiptReviewItem) : [];
  return {
    supplier_name: parsed.supplier_name || null,
    delivery_note_num: parsed.delivery_note_num || parsed.delivery_note_number || null,
    received_date: parsed.received_date || null,
    notes: parsed.notes || null,
    items,
  };
}

function selectedRawMaterialId(input = {}) {
  const raw = input.raw_material_id ?? input.rawMaterialId ?? input.batch_id ?? input.batchId ?? input.inventory_batch_id ?? null;
  if (raw === 'auto' || raw === '') return null;
  if (raw === 'none' || raw === false) return 'none';
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function availableKg(row) {
  return Math.max(0, Number(row.weight_received || 0) - Number(row.weight_used || 0) - Number(row.weight_scrapped || 0));
}

function rawMaterialMatchesItem(row, item) {
  if (!row) return false;
  if (Number(row.diameter) !== Number(item.diameter)) return false;
  if (item.material_type && row.material_type && String(row.material_type) !== String(item.material_type)) return false;
  return true;
}

function candidateRawMaterials(db, item) {
  return db.prepare(`
    SELECT *,
           ROUND(weight_received - weight_used - weight_scrapped, 3) AS weight_available
    FROM raw_material
    WHERE active=1
      AND diameter=?
      AND ROUND(weight_received - weight_used - weight_scrapped, 3) > 0
    ORDER BY date(COALESCE(received_date, created_at)) ASC, id ASC
  `).all(item.diameter);
}

function allocateOrderItemStock(db, {
  orderId,
  itemId,
  item = {},
  requiredWeightKg,
  requestedRawMaterialId = null,
  policy = 'auto_fifo',
}) {
  const normalizedPolicy = normalizeStockAllocationPolicy(policy);
  const requestedId = selectedRawMaterialId({ raw_material_id: requestedRawMaterialId });
  const required = Number(requiredWeightKg || 0);
  if (!Number.isFinite(required) || required <= 0) return { allocated: false, reason: 'no_weight' };
  if (requestedId === 'none' || normalizedPolicy === 'disabled') return { allocated: false, reason: 'disabled' };

  const requestedRows = requestedId
    ? [db.prepare('SELECT * FROM raw_material WHERE id=? AND active=1').get(requestedId)].filter(Boolean)
    : [];
  if (requestedId && !requestedRows.length) {
    throw Object.assign(new Error('selected raw material batch was not found'), { statusCode: 400 });
  }
  if (requestedRows.length && !rawMaterialMatchesItem(requestedRows[0], item)) {
    throw Object.assign(new Error('selected raw material batch does not match item diameter/material'), { statusCode: 400 });
  }

  const rows = requestedRows.length ? requestedRows : candidateRawMaterials(db, item);
  if (!rows.length) {
    if (normalizedPolicy === 'manual_required') {
      throw Object.assign(new Error('no matching raw material batch selected for item'), { statusCode: 400 });
    }
    return { allocated: false, reason: 'no_stock' };
  }

  let remaining = required;
  const allocations = [];
  for (const row of rows) {
    const take = Math.min(remaining, availableKg(row));
    if (take <= 0) continue;
    allocations.push({ raw_material_id: row.id, weight_used: take });
    remaining = Math.max(0, remaining - take);
    if (remaining <= 0.001) break;
  }

  if (remaining > 0.001) {
    if (requestedId || normalizedPolicy === 'manual_required') {
      throw Object.assign(new Error('selected raw material batch does not have enough available stock'), { statusCode: 400 });
    }
    return { allocated: false, reason: 'insufficient_stock' };
  }

  const updateStock = db.prepare('UPDATE raw_material SET weight_used=ROUND(weight_used + ?, 3) WHERE id=?');
  const insertUsage = db.prepare(`
    INSERT INTO raw_material_usage (raw_material_id, order_id, item_id, weight_used, allocation_policy)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const allocation of allocations) {
    updateStock.run(allocation.weight_used, allocation.raw_material_id);
    insertUsage.run(allocation.raw_material_id, orderId, itemId, allocation.weight_used, normalizedPolicy);
  }
  db.prepare('UPDATE items SET batch_id=? WHERE id=?').run(allocations[0].raw_material_id, itemId);

  return { allocated: true, allocations };
}

module.exports = {
  MATERIAL_TYPES,
  STOCK_ALLOCATION_POLICIES,
  allocateOrderItemStock,
  bendingShapeColumns,
  normalizeBendingShapeInput,
  normalizeReceiptReviewItem,
  normalizeStockAllocationPolicy,
  selectedRawMaterialId,
  parseReceiptReviewPayload,
};
