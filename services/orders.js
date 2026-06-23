function validateShapeGeometry(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { valid: false, error: 'חסרים קטעים (segments)' };
  }
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (typeof seg.length_mm !== 'number' || seg.length_mm <= 0) {
      return { valid: false, error: `קטע ${i + 1}: אורך חייב להיות מספר חיובי (קיבלנו: ${seg.length_mm})` };
    }
    if (seg.length_mm > 20000) {
      return { valid: false, error: `קטע ${i + 1}: אורך ${seg.length_mm}mm חורג מ-20,000mm` };
    }
    if (typeof seg.angle_deg !== 'number') {
      return { valid: false, error: `קטע ${i + 1}: זווית חייבת להיות מספר` };
    }
    if (seg.angle_deg < 0 || seg.angle_deg > 180) {
      return { valid: false, error: `קטע ${i + 1}: זווית ${seg.angle_deg}° חייבת להיות בין 0° ל-180°` };
    }
  }
  if (segments.length > 30) {
    return { valid: false, error: `יותר מדי קטעים: ${segments.length} (מקסימום 30)` };
  }
  return { valid: true };
}

const steelModule = require('../modules/steel-rebar');
const { normalizeSpiralParams, spiralCutLengthMm } = require('../modules/steel-rebar/shapes');
const {
  allocateOrderItemStock,
  normalizeStockAllocationPolicy,
  selectedRawMaterialId,
} = require('./inventory');

function createOrderFactory(db, { generateOrderNum, industry, settingsService = null }) {
  if (!db) throw new Error('services/orders missing dependency: db');
  if (!generateOrderNum) throw new Error('services/orders missing dependency: generateOrderNum');
  if (!industry) throw new Error('services/orders missing dependency: industry');

  const normalizeSegments = industry.normalizeSegments;
  const normalizeShapeName = industry.normalizeShapeName;
  const assignResource = industry.assignResource;
  if (!normalizeSegments) throw new Error('services/orders missing industry contract: normalizeSegments');
  if (!normalizeShapeName) throw new Error('services/orders missing industry contract: normalizeShapeName');
  if (!assignResource) throw new Error('services/orders missing industry contract: assignResource');
  if (!industry.weightPerUnit) throw new Error('services/orders missing industry contract: weightPerUnit');

  function calcWeightPerUnit(diameter, totalLengthMm) {
    return industry.weightPerUnit({ diameter, total_length_mm: totalLengthMm });
  }

  function createOrderFromPayload(payload) {
    const { customer = {}, order = {}, pallets = [] } = payload || {};
    if (!customer.name?.trim()) throw Object.assign(new Error('customer.name is required'), { statusCode: 400 });
    if (!pallets.length || !pallets.some(pallet => pallet.items?.length)) {
      throw Object.assign(new Error('At least one order item is required'), { statusCode: 400 });
    }

    let customerId;
    const phone = (customer.phone || '').trim();
    const name = (customer.name || '').trim();
    let existing = null;
    if (customer.id) {
      existing = db.prepare('SELECT id,name,phone,email,address,contact_name,contact_phone FROM customers WHERE id=?').get(customer.id);
    }
    if (!existing && phone) {
      existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(phone);
    }
    if (!existing && name) {
      existing = db.prepare("SELECT id FROM customers WHERE name=? AND (phone IS NULL OR phone='') ORDER BY id DESC LIMIT 1").get(name);
    }
    if (existing) {
      customerId = existing.id;
      db.prepare(`
        UPDATE customers
        SET name=COALESCE(?,name),
            phone=COALESCE(?,phone),
            email=COALESCE(?,email),
            address=COALESCE(?,address),
            contact_name=COALESCE(?,contact_name),
            contact_phone=COALESCE(?,contact_phone)
        WHERE id=?
      `).run(
        name || null,
        phone || null,
        customer.email || null,
        customer.address || null,
        customer.contactName || null,
        customer.contactPhone || null,
        customerId
      );
    } else {
      const r = db.prepare('INSERT INTO customers (name,phone,email,address,contact_name,contact_phone) VALUES (?,?,?,?,?,?)')
        .run(name || customer.name, phone || null, customer.email || null, customer.address, customer.contactName, customer.contactPhone);
      customerId = r.lastInsertRowid;
    }

    const orderNum = order.orderNum || generateOrderNum();
    const inventoryPolicy = normalizeStockAllocationPolicy(
      order.inventoryAllocationPolicy || order.stockAllocationPolicy || settingsService?.get('INVENTORY_ALLOCATION_POLICY', 'auto_fifo')
    );
    const wastePct = order.wastePctCharged ?? 3;
    const totalWeight = order.totalWeight ?? 0;
    const billingWeight = totalWeight * (1 + wastePct / 100);

    const orderResult = db.prepare(`
      INSERT INTO orders (order_num,customer_id,channel,delivery_date,delivery_time,delivery_address,priority,driver_notes,general_notes,total_weight,waste_pct_charged,billing_weight,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(orderNum, customerId, order.channel, order.deliveryDate, order.deliveryTime,
      order.deliveryAddress, order.priority, order.driverNotes, order.generalNotes,
      totalWeight, wastePct, billingWeight, order.createdBy || null);

    const orderId = orderResult.lastInsertRowid;

    (pallets || []).forEach((pallet, idx) => {
      const pr = db.prepare('INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight) VALUES (?,?,?,?)')
        .run(orderId, idx + 1, pallet.maxWeight || 500, pallet.totalWeight || 0);

      (pallet.items || []).forEach(item => {
        const spiral = normalizeSpiralParams(item);
        const sides = spiral.isSpiral
          ? []
          : ((item.sides && item.sides.length) ? item.sides : (item.length ? [item.length] : []));
        const totalLengthMm = spiral.isSpiral
          ? (Number(item.length ?? item.total_length_mm) || spiralCutLengthMm(spiral.spiralDiameterMm, spiral.turns))
          : (sides.reduce((s, v) => s + Number(v), 0) || Number(item.length) || 0);
        const angles = item.angles || [];
        const segmentsArr = spiral.isSpiral
          ? []
          : normalizeSegments(
              item.shapeName,
              sides.map((len, i) => ({ length_mm: Number(len), angle_deg: angles[i] ?? 0 }))
            );
        const shapeName = spiral.isSpiral
          ? normalizeShapeName(item.shapeName || item.shape_name || 'spiral', segmentsArr, {
              spiral_diameter_mm: spiral.spiralDiameterMm,
              spiral_turns: spiral.turns,
            })
          : normalizeShapeName(item.shapeName, segmentsArr);
        if (!spiral.isSpiral) {
          const geoCheck = validateShapeGeometry(segmentsArr);
          if (!geoCheck.valid) throw Object.assign(new Error(geoCheck.error), { statusCode: 400 });
        }
        const segments = JSON.stringify(segmentsArr);
        const weightPerUnit = calcWeightPerUnit(item.diameter, totalLengthMm);
        const productionQty = Math.ceil((item.qty || 1) * (1 + wastePct / 100));
        const machine = assignResource(item.diameter);

        const totalWeight = weightPerUnit * (item.qty || 1);
        const itemResult = db.prepare(`INSERT INTO items (pallet_id,shape_id,shape_name,diameter,spiral_diameter_mm,spiral_turns,segments,total_length_mm,quantity,production_qty,weight_per_unit,total_weight,note,struct_element,struct_floor,sheet_num,machine,is_3d)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(pr.lastInsertRowid, item.shapeId, shapeName, item.diameter,
            spiral.isSpiral ? spiral.spiralDiameterMm : null,
            spiral.isSpiral ? spiral.turns : null,
            segments, totalLengthMm, item.qty || 1, productionQty,
            weightPerUnit, totalWeight,
            item.note, item.structElement, item.structFloor, item.sheetNum, machine,
            item.is_3d ? 1 : 0);

        allocateOrderItemStock(db, {
          orderId,
          itemId: itemResult.lastInsertRowid,
          item: {
            diameter: item.diameter,
            material_type: item.material_type || item.materialType || null,
          },
          requiredWeightKg: totalWeight,
          requestedRawMaterialId: selectedRawMaterialId(item),
          policy: inventoryPolicy,
        });
      });
    });

    return { success: true, orderNum, orderId };
  }

  return {
    calcWeightPerUnit,
    createOrderFromPayload,
    createOrderTransaction: db.transaction(createOrderFromPayload),
  };
}

module.exports = {
  validateShapeGeometry,
  autoAssignMachine: steelModule.autoAssignMachine,
  normalizeFactorySegments: steelModule.normalizeFactorySegments,
  normalizeFactoryShapeName: steelModule.normalizeFactoryShapeName,
  createOrderFactory,
};
