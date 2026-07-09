const MATERIAL_TYPES = new Set(['coil', 'straight', 'bent']);

const DEFAULT_ACTIVE_RESERVATION_STATUSES = [
  'reserved',
  'released_to_production',
  'active',
  'pending',
  'soft_reserved',
  'hard_reserved',
];

const CLOSED_PURCHASE_ORDER_STATUSES = new Set([
  'cancelled',
  'canceled',
  'closed',
  'done',
  'complete',
  'completed',
  'received',
  'arrived',
]);

function normalizeMaterialType(value) {
  const materialType = String(value || '').trim();
  return MATERIAL_TYPES.has(materialType) ? materialType : 'coil';
}

function normalizeDiameter(value) {
  const diameter = Number(value);
  if (!Number.isFinite(diameter) || diameter <= 0) {
    throw Object.assign(new Error('diameter is required for inventory reservation calculation'), { statusCode: 400 });
  }
  return diameter;
}

function roundKg(value) {
  const numeric = Number(value || 0);
  return Number(numeric.toFixed(3));
}

function safeIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw Object.assign(new Error('invalid inventory reservation table name'), { statusCode: 400 });
  }
  return identifier;
}

function tableExists(db, tableName) {
  const safeTableName = safeIdentifier(tableName);
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(safeTableName));
}

function tableColumns(db, tableName) {
  const safeTableName = safeIdentifier(tableName);
  return new Set(db.prepare(`PRAGMA table_info(${safeTableName})`).all().map(column => column.name));
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function calculatePhysicalStockKg(db, { diameter, material_type }) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      COALESCE(weight_received, 0) - COALESCE(weight_used, 0) - COALESCE(weight_scrapped, 0)
    ), 0) AS physicalStockKg
    FROM raw_material
    WHERE active=1
      AND diameter=?
      AND COALESCE(material_type, 'coil')=?
  `).get(diameter, material_type);
  return roundKg(row?.physicalStockKg);
}

function reservationWeightExpression(columns) {
  if (columns.has('reserved_kg')) return 'COALESCE(reserved_kg, 0)';
  if (columns.has('reservedKg')) return 'COALESCE(reservedKg, 0)';
  if (columns.has('quantity_kg')) return 'COALESCE(quantity_kg, 0)';
  if (columns.has('required_kg')) return 'COALESCE(required_kg, 0)';
  return null;
}

function calculateReservedKg(db, {
  diameter,
  material_type,
  reservationTable = 'inventory_reservations',
  activeStatuses = DEFAULT_ACTIVE_RESERVATION_STATUSES,
} = {}) {
  const safeReservationTable = safeIdentifier(reservationTable);
  if (!tableExists(db, safeReservationTable)) return 0;

  const columns = tableColumns(db, safeReservationTable);
  if (!columns.has('diameter')) return 0;

  const weightExpression = reservationWeightExpression(columns);
  if (!weightExpression) return 0;

  const where = ['diameter=?'];
  const params = [diameter];

  if (columns.has('material_type')) {
    where.push("COALESCE(material_type, 'coil')=?");
    params.push(material_type);
  }

  if (columns.has('active')) {
    where.push('COALESCE(active, 1)=1');
  }

  if (columns.has('status') && activeStatuses.length) {
    where.push(`status IN (${placeholders(activeStatuses)})`);
    params.push(...activeStatuses);
  }

  const row = db.prepare(`
    SELECT COALESCE(SUM(${weightExpression}), 0) AS reservedKg
    FROM ${safeReservationTable}
    WHERE ${where.join(' AND ')}
  `).get(...params);

  return roundKg(row?.reservedKg);
}

function isOpenPurchaseOrderStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return !CLOSED_PURCHASE_ORDER_STATUSES.has(normalized);
}

function calculateIncomingKg(db, { diameter, material_type }) {
  const rows = db.prepare(`
    SELECT quantity_ton, received_weight, status, received_at
    FROM purchase_orders
    WHERE diameter=?
      AND COALESCE(material_type, 'coil')=?
      AND received_at IS NULL
  `).all(diameter, material_type);

  const incomingKg = rows.reduce((sum, row) => {
    if (!isOpenPurchaseOrderStatus(row.status)) return sum;
    const orderedKg = Number(row.quantity_ton || 0) * 1000;
    const receivedKg = Number(row.received_weight || 0);
    return sum + Math.max(0, orderedKg - receivedKg);
  }, 0);

  return roundKg(incomingKg);
}

function calculateMaterialStockPosition(db, input = {}) {
  const diameter = normalizeDiameter(input.diameter);
  const material_type = normalizeMaterialType(input.material_type);
  const safetyStockKg = Math.max(0, Number(input.safetyStockKg || 0));

  const physicalStockKg = calculatePhysicalStockKg(db, { diameter, material_type });
  const reservedKg = calculateReservedKg(db, {
    diameter,
    material_type,
    reservationTable: input.reservationTable,
    activeStatuses: input.activeStatuses || DEFAULT_ACTIVE_RESERVATION_STATUSES,
  });
  const availableKg = roundKg(physicalStockKg - reservedKg);
  const shortageKg = roundKg(Math.max(0, -availableKg));
  const incomingKg = calculateIncomingKg(db, { diameter, material_type });
  const recommendedPurchaseKg = roundKg(Math.max(0, shortageKg - incomingKg + safetyStockKg));

  return {
    diameter,
    material_type,
    physicalStockKg,
    reservedKg,
    availableKg,
    shortageKg,
    incomingKg,
    recommendedPurchaseKg,
  };
}

module.exports = {
  DEFAULT_ACTIVE_RESERVATION_STATUSES,
  calculateMaterialStockPosition,
  calculatePhysicalStockKg,
  calculateReservedKg,
  calculateIncomingKg,
  normalizeMaterialType,
};
