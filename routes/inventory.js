const router = require('express').Router();

const {
  MATERIAL_TYPES,
  bendingShapeColumns,
  normalizeReceiptReviewItem,
  parseReceiptReviewPayload,
} = require('../services/inventory');
const { normalizeDiameter } = require('../services/materialCatalog');

function required(name, value) {
  if (!value) throw new Error(`routes/inventory missing dependency: ${name}`);
  return value;
}

module.exports = function createInventoryRouter(deps) {
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const wsBroadcast = required('wsBroadcast', deps.wsBroadcast);
  const auditLog = required('auditLog', deps.auditLog);
  const listPage = required('listPage', deps.listPage);

  function canApproveCatalog(req) {
    return ['manager', 'admin', 'procurement'].includes(req.auth?.role);
  }

  function resolveDiameterCatalog(value, req, { approveNew, reactivate } = {}) {
    const diameter = normalizeDiameter(value);
    if (!diameter) {
      throw Object.assign(new Error('invalid_diameter'), { statusCode: 400 });
    }
    const existing = db.prepare('SELECT * FROM diameter_catalog WHERE diameter_key=?').get(diameter.key);
    if (!existing) {
      const status = canApproveCatalog(req) && approveNew !== false ? 'active' : 'pending_approval';
      db.prepare(`
        INSERT INTO diameter_catalog (diameter_key,diameter_display,status,source,created_by,approved_by,approved_at)
        VALUES (?,?,?,?,?,?,CASE WHEN ?='active' THEN CURRENT_TIMESTAMP ELSE NULL END)
      `).run(diameter.key, diameter.display, status, 'manual', req.auth?.sub || null,
        status === 'active' ? req.auth?.sub || null : null, status);
      return { ...diameter, status, catalogAction: 'created' };
    }
    if (existing.status !== 'active' && canApproveCatalog(req) && reactivate) {
      db.prepare(`UPDATE diameter_catalog
        SET status='active', approved_by=?, approved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(req.auth?.sub || null, existing.id);
      return { ...diameter, status: 'active', catalogAction: 'reactivated' };
    }
    return { ...diameter, status: existing.status, catalogAction: null };
  }

  function resolveCatalogItem(input, materialType, diameter) {
    const catalogItemId = Number(input.catalog_item_id ?? input.catalogItemId);
    if (!Number.isSafeInteger(catalogItemId) || catalogItemId <= 0) {
      return { catalogItem: null, specException: false };
    }
    const catalogItem = db.prepare(`SELECT * FROM catalog_items
      WHERE id=? AND item_kind='raw_material' AND active=1`).get(catalogItemId);
    if (!catalogItem) throw Object.assign(new Error('catalog_item_not_found'), { statusCode: 400 });
    const comparisons = [
      ['diameter_key', diameter.key],
      ['supply_form', materialType],
      ['steel_grade', input.grade || 'B500B'],
      ['standard_code', input.standard_code || input.standardCode || null],
      ['nominal_length_mm', input.nominal_length_mm ?? input.nominalLengthMm ?? null],
    ];
    const specException = comparisons.some(([field, actual]) => {
      if (catalogItem[field] === null || catalogItem[field] === undefined || actual === null || actual === '') return false;
      return String(catalogItem[field]) !== String(actual);
    });
    return { catalogItem, specException };
  }



  router.get('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const { diameter, supplier_id } = req.query;
    const page = listPage(req.query, { limit: 200, max: 1000 });
    let sql = "SELECT r.*,s.name as supplier_name,ROUND(r.weight_received-r.weight_used-r.weight_scrapped,2) as weight_available FROM raw_material r LEFT JOIN suppliers s ON r.supplier_id=s.id WHERE r.active=1 AND COALESCE(r.verification_status,'approved')='approved'";
    const params = [];
    if (diameter) { sql += ' AND r.diameter=?'; params.push(diameter); }
    if (supplier_id) { sql += ' AND r.supplier_id=?'; params.push(supplier_id); }
    sql += ' ORDER BY r.received_date DESC, r.id DESC LIMIT ? OFFSET ?';
    params.push(page.limit, page.offset);
    res.json(db.prepare(sql).all(...params));
  });

  router.get('/inventory/summary', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    res.json(db.prepare("SELECT diameter,SUM(weight_received) as total_received,SUM(weight_used) as total_used,SUM(weight_scrapped) as total_scrapped,ROUND(SUM(weight_received-weight_used-weight_scrapped),2) as available,COUNT(*) as batches FROM raw_material WHERE active=1 AND COALESCE(verification_status,'approved')='approved' GROUP BY diameter ORDER BY diameter").all());
  });

  router.get('/inventory/diameter-catalog', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (_req, res) => {
    res.json(db.prepare(`SELECT id,diameter_key,diameter_display,status
      FROM diameter_catalog WHERE status IN ('active','inactive','pending_approval')
      ORDER BY CAST(diameter_key AS NUMERIC), diameter_key`).all());
  });

  router.get('/inventory/catalog-items', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (_req, res) => {
    res.json(db.prepare(`SELECT id,sku,name,category,supply_form,diameter_key,steel_grade,standard_code,nominal_length_mm,
      nominal_kg_per_meter,nominal_unit_weight_kg
      FROM catalog_items WHERE item_kind='raw_material' AND active=1 ORDER BY sku`).all());
  });

  router.get('/inventory/pending-verification', requireAnyRole(['manager', 'admin']), (_req, res) => {
    res.json(db.prepare(`SELECT r.*, d.status AS diameter_catalog_status
      FROM raw_material r
      LEFT JOIN diameter_catalog d ON d.diameter_key=CAST(r.diameter AS TEXT)
      WHERE r.active=1 AND r.verification_status='pending_verification'
      ORDER BY r.created_at ASC, r.id ASC`).all());
  });

  router.post('/inventory/:id/approve-verification', requireAnyRole(['manager', 'admin']), (req, res) => {
    const lot = db.prepare('SELECT * FROM raw_material WHERE id=?').get(req.params.id);
    if (!lot) return res.status(404).json({ error: 'raw_material_not_found' });
    const diameter = normalizeDiameter(lot.diameter);
    if (!diameter) return res.status(400).json({ error: 'invalid_diameter' });
    const tx = db.transaction(() => {
      db.prepare(`UPDATE diameter_catalog SET status='active', approved_by=?, approved_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE diameter_key=? AND status<>'active'`).run(req.auth?.sub || null, diameter.key);
      db.prepare("UPDATE raw_material SET verification_status='approved' WHERE id=?").run(lot.id);
    });
    tx();
    auditLog('raw_material', lot.id, lot.lot_number || String(lot.id), 'approve_verification', 'verification_status',
      lot.verification_status, 'approved', null, req.auth?.sub || null, req.auth?.display_name || null);
    res.json({ success: true });
  });

  router.post('/inventory/product-masters', requireAnyRole(['manager', 'admin']), (req, res) => {
    const code = String(req.body?.master_code ?? req.body?.masterCode ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!code || !name) return res.status(400).json({ error: 'master_code_and_name_required' });
    try {
      const result = db.prepare('INSERT INTO product_masters (master_code,name,category) VALUES (?,?,?)')
        .run(code, name, String(req.body?.category ?? '').trim());
      res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
      res.status(409).json({ error: 'product_master_code_exists' });
    }
  });

  router.post('/inventory/catalog-items', requireAnyRole(['manager', 'admin']), (req, res) => {
    const body = req.body || {};
    const sku = String(body.sku ?? '').trim();
    const name = String(body.name ?? '').trim();
    const itemKind = body.item_kind ?? body.itemKind;
    if (!sku || !name || !['raw_material', 'finished_product'].includes(itemKind)) {
      return res.status(400).json({ error: 'invalid_catalog_item' });
    }
    const diameter = body.diameter === undefined || body.diameter === null || body.diameter === '' ? null : normalizeDiameter(body.diameter);
    if (body.diameter !== undefined && !diameter) return res.status(400).json({ error: 'invalid_diameter' });
    const supplyForm = body.supply_form ?? body.supplyForm ?? null;
    if (supplyForm !== null && !MATERIAL_TYPES.has(supplyForm)) return res.status(400).json({ error: 'invalid_supply_form' });
    const productMasterId = Number(body.product_master_id ?? body.productMasterId) || null;
    if (productMasterId && !db.prepare('SELECT 1 FROM product_masters WHERE id=? AND active=1').get(productMasterId)) {
      return res.status(400).json({ error: 'product_master_not_found' });
    }
    try {
      const result = db.prepare(`INSERT INTO catalog_items
        (sku,product_master_id,item_kind,name,category,supply_form,diameter_key,steel_grade,standard_code,nominal_length_mm,nominal_kg_per_meter,nominal_unit_weight_kg)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        sku, productMasterId, itemKind, name, String(body.category ?? '').trim(),
        supplyForm, diameter?.key || null, body.steel_grade ?? body.steelGrade ?? null, body.standard_code ?? body.standardCode ?? null,
        Number(body.nominal_length_mm ?? body.nominalLengthMm) || null, Number(body.nominal_kg_per_meter ?? body.nominalKgPerMeter) || null,
        Number(body.nominal_unit_weight_kg ?? body.nominalUnitWeightKg) || null
      );
      res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
      res.status(409).json({ error: 'catalog_sku_exists' });
    }
  });

  router.get('/inventory/receipt-reviews', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const status = req.query.status || 'pending_review';
    const rows = db.prepare(`
      SELECT rr.*, s.name AS supplier_master_name
      FROM inventory_receipt_reviews rr
      LEFT JOIN suppliers s ON s.id=rr.supplier_id
      WHERE rr.status=?
      ORDER BY rr.created_at DESC, rr.id DESC
      LIMIT 100
    `).all(status);
    res.json(rows);
  });

  router.post('/inventory/receipt-reviews/:id/approve', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    if (review.status !== 'pending_review') return res.status(409).json({ error: 'review is not pending', status: review.status });
    const parsed = parseReceiptReviewPayload(JSON.parse(review.parsed_data || '{}'));
    const ids = [];
    const insert = db.prepare(`
      INSERT INTO raw_material
        (material_type,diameter,supplier_id,lot_number,certificate_num,grade,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const tx = db.transaction(() => {
      for (const rawItem of parsed.items) {
        const item = normalizeReceiptReviewItem({ ...rawItem, supplier_id: rawItem.supplier_id || review.supplier_id });
        if (!item.diameter || !item.weight_received) throw new Error('diameter and weight are required for every approved receipt row');
        if (item.material_type === 'bent' && (!item.bending_shape_name || !item.bending_shape_segments)) {
          throw new Error('bending shape is required for bent material receipt rows');
        }
        const diameter = resolveDiameterCatalog(item.diameter, req);
        const result = insert.run(item.material_type, diameter.numeric, item.supplier_id, item.lot_number, item.certificate_num, item.grade,
          item.received_date || parsed.received_date || new Date().toISOString().slice(0, 10), item.weight_received, item.purchase_price,
          item.warehouse_loc, item.bending_shape_name, item.bending_shape_segments, item.bending_shape_source, item.bending_shape_confidence,
          item.notes || parsed.notes || null);
        ids.push(result.lastInsertRowid);
      }
      db.prepare(`
        UPDATE inventory_receipt_reviews
        SET status='approved', raw_material_ids=?, reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(JSON.stringify(ids), req.auth?.sub || null, req.body?.notes || null, review.id);
    });
    try {
      tx();
      auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'approve', 'status', 'pending_review', 'approved', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
      wsBroadcast('inventory_receipt_review_approved', { id: review.id, raw_material_ids: ids });
      res.json({ success: true, raw_material_ids: ids });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/inventory/receipt-reviews/:id/reject', requireAnyRole(['manager', 'admin']), (req, res) => {
    const review = db.prepare('SELECT * FROM inventory_receipt_reviews WHERE id=?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'not found' });
    db.prepare(`
      UPDATE inventory_receipt_reviews
      SET status='rejected', reviewed_by=?, review_notes=?, reviewed_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(req.auth?.sub || null, req.body?.notes || null, req.params.id);
    auditLog('inventory_receipt_review', review.id, review.delivery_note_num, 'reject', 'status', review.status, 'rejected', req.body?.notes || null, req.auth?.sub || null, req.auth?.display_name || null);
    wsBroadcast('inventory_receipt_review_rejected', { id: review.id });
    res.json({ success: true });
  });

  router.post('/inventory', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    if (!f.diameter || !f.weight_received) return res.status(400).json({ error: 'קוטר ומשקל חובה' });
    const materialType = MATERIAL_TYPES.has(f.material_type) ? f.material_type : 'coil';
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    try {
      const diameter = resolveDiameterCatalog(f.diameter_input ?? f.diameter, req, {
        approveNew: f.approve_new_diameter,
        reactivate: f.reactivate_diameter,
      });
      const { catalogItem, specException } = resolveCatalogItem(f, materialType, diameter);
      const verificationStatus = diameter.status === 'active' && !specException ? 'approved' : 'pending_verification';
      const r = db.prepare(`INSERT INTO raw_material
        (material_type,diameter,catalog_item_id,verification_status,supplier_id,lot_number,certificate_num,grade,standard_code,nominal_length_mm,spec_exception,received_date,weight_received,purchase_price,warehouse_loc,bending_shape_name,bending_shape_segments,bending_shape_source,bending_shape_confidence,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(materialType, diameter.numeric, catalogItem?.id || null, verificationStatus, f.supplier_id || null,
          f.lot_number || null, f.certificate_num || null, f.grade || 'B500B', f.standard_code ?? f.standardCode ?? null,
          Number(f.nominal_length_mm ?? f.nominalLengthMm) || null, specException ? 1 : 0,
          f.received_date || new Date().toISOString().split('T')[0], f.weight_received, f.purchase_price || 0,
          f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null);
      res.json({ id: r.lastInsertRowid, diameter: diameter.display, verification_status: verificationStatus,
        catalog_action: diameter.catalogAction, spec_exception: specException });
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message || 'inventory_receipt_failed' });
    }
  });

  router.patch('/inventory/:id', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const f = req.body;
    const materialType = f.material_type && MATERIAL_TYPES.has(f.material_type) ? f.material_type : null;
    const shape = bendingShapeColumns(f);
    if (materialType === 'bent' && (!shape.name || !shape.segments)) {
      return res.status(400).json({ error: 'צורת כיפוף חובה עבור חומר מסוג כיפוף' });
    }
    db.prepare(`UPDATE raw_material SET
      material_type=COALESCE(?,material_type),
      diameter=COALESCE(?,diameter),
      supplier_id=COALESCE(?,supplier_id),
      lot_number=COALESCE(?,lot_number),
      certificate_num=COALESCE(?,certificate_num),
      grade=COALESCE(?,grade),
      received_date=COALESCE(?,received_date),
      weight_received=COALESCE(?,weight_received),
      weight_used=COALESCE(?,weight_used),
      weight_scrapped=COALESCE(?,weight_scrapped),
      purchase_price=COALESCE(?,purchase_price),
      warehouse_loc=COALESCE(?,warehouse_loc),
      bending_shape_name=?,
      bending_shape_segments=?,
      bending_shape_source=?,
      bending_shape_confidence=?,
      notes=COALESCE(?,notes),
      active=COALESCE(?,active)
      WHERE id=?`)
      .run(materialType, f.diameter ?? null, f.supplier_id || null, f.lot_number || null, f.certificate_num || null, f.grade || null, f.received_date || null, f.weight_received ?? null, f.weight_used ?? null, f.weight_scrapped ?? null, f.purchase_price ?? null, f.warehouse_loc || null, shape.name, shape.segments, shape.source, shape.confidence, f.notes || null, f.active ?? null, req.params.id);
    res.json({ success: true });
  });

  router.get('/inventory/forecast', requireAnyRole(['warehouse', 'office', 'manager', 'admin']), (req, res) => {
    const consumption = db.prepare(`
      SELECT i.diameter,
             COALESCE(SUM(i.total_weight),0) / 30 as avg_daily_kg
      FROM items i
      JOIN pallets p ON i.pallet_id=p.id
      JOIN orders o ON p.order_id=o.id
      WHERE DATE(o.created_at) >= DATE('now','-30 days')
      AND i.status='הושלם'
      GROUP BY i.diameter
    `).all();

    const stock = db.prepare(`
      SELECT diameter,
             COALESCE(SUM(weight_received-weight_used-weight_scrapped),0) as on_hand_kg
      FROM raw_material WHERE active=1 AND COALESCE(verification_status,'approved')='approved'
      GROUP BY diameter
    `).all();

    const stockMap = {};
    for (const s of stock) stockMap[s.diameter] = s.on_hand_kg;

    const forecast = consumption.map(row => {
      const on_hand = stockMap[row.diameter] || 0;
      const days_left = row.avg_daily_kg > 0 ? Math.floor(on_hand / row.avg_daily_kg) : 999;
      return {
        diameter: row.diameter,
        on_hand_kg: Math.round(on_hand),
        avg_daily_kg: Math.round(row.avg_daily_kg),
        days_left,
        alert: days_left <= 3 ? 'critical' : days_left <= 7 ? 'warning' : 'ok',
      };
    });

    for (const [diam, kg] of Object.entries(stockMap)) {
      if (!forecast.find(f => f.diameter == diam)) {
        forecast.push({ diameter: Number(diam), on_hand_kg: Math.round(kg), avg_daily_kg: 0, days_left: 999, alert: 'ok' });
      }
    }
    forecast.sort((a, b) => a.days_left - b.days_left);
    res.json(forecast);
  });



  return router;
};

module.exports.manifest = {
  id: 'inventory',
  label: 'מלאי',
  screens: [
    { id: 'inventory', path: '/inventory.html', label: 'מלאי', icon: '🗄️', group: 'תפעול' },
  ],
  access: {
    default: 'hidden',
    roles: { admin: 'edit', manager: 'edit', office: 'read', production: 'read', warehouse: 'edit' },
  },
  consumes: [{ table: 'raw_materials' }, { table: 'inventory_receipt_reviews' }],
  produces: [
    { event: 'inventory_receipt_review_approved' },
    { event: 'inventory_receipt_review_rejected' },
  ],
};
