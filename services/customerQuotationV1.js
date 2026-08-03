'use strict';

const crypto = require('node:crypto');
const { isShapeDataContractV2, itemShapeMetrics, parseJsonObject } = require('./shapeSnapshot');

class CustomerQuotationError extends Error {
  constructor(code, statusCode = 409) {
    super(code);
    this.name = 'CustomerQuotationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const fail = (code, statusCode) => { throw new CustomerQuotationError(code, statusCode); };
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = value => value === undefined || value === null ? null : String(value).trim() || null;
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};
const stable = value => {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const fingerprint = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const parseJson = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const positive = (value, code) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) fail(code, 400);
  return round(number, 3);
};
const nonNegative = (value, code) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) fail(code, 400);
  return round(number, 3);
};
const validDate = value => {
  const normalized = text(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) fail('invalid_validity_date', 400);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) fail('invalid_validity_date', 400);
  return normalized;
};

function rawActionPayload(action, input = {}, quotationId = null) {
  const omitted = new Set(['created_by', 'createdBy', 'updated_by', 'updatedBy', 'issued_by', 'issuedBy', 'actor_id', 'actorId']);
  const clean = Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key)));
  return { action, quotation_id: quotationId ? Number(quotationId) : null, input: clean };
}

function normalizeCurrency(value) {
  const currency = String(value || 'ILS').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('invalid_currency_code', 400);
  return currency;
}

function normalizeVatRate(value) {
  const raw = value === undefined || value === null || value === '' ? 0.18 : Number(value);
  const rate = raw > 1 && raw <= 100 ? raw / 100 : raw;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) fail('invalid_vat_rate', 400);
  return round(rate, 6);
}

function shapeDiameter(snapshot, line = {}) {
  const data = snapshot?.data || {};
  const generic = snapshot?.machineOutput?.generic || {};
  const value = line.diameter ?? line.diameter_mm ?? data.diameter ?? data.diameterMm ?? data.barDiameterMm ?? generic.diameter ?? generic.diameterMm;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function resolveCustomerSnapshot(db, input = {}) {
  const customerId = Number(input.customer_id ?? input.customerId ?? 0) || null;
  if (customerId) {
    const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
    if (!customer) fail('customer_not_found', 404);
    return {
      customerId,
      displayName: customer.name,
      snapshot: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone || null,
        email: customer.email || null,
        address: customer.address || null,
        tax_id: customer.tax_id || null,
        payment_terms: customer.payment_terms || null,
        contact_name: customer.contact_name || null,
        contact_phone: customer.contact_phone || null,
      },
      priceContext: customer,
    };
  }

  const source = input.customer_snapshot ?? input.customerSnapshot ?? input.prospect ?? input.customer ?? {};
  const name = text(source.name ?? source.display_name ?? input.prospect_display_name ?? input.prospectDisplayName);
  if (!name) fail('customer_or_prospect_required', 400);
  return {
    customerId: null,
    displayName: name,
    snapshot: {
      id: null,
      name,
      phone: text(source.phone),
      email: text(source.email),
      address: text(source.address),
      tax_id: text(source.tax_id ?? source.taxId),
      payment_terms: text(source.payment_terms ?? source.paymentTerms),
      contact_name: text(source.contact_name ?? source.contactName),
      contact_phone: text(source.contact_phone ?? source.contactPhone),
    },
    priceContext: null,
  };
}

function resolveProjectSiteSnapshot(db, input = {}, customerId = null) {
  const projectId = Number(input.project_id ?? input.projectId ?? 0) || null;
  const siteId = Number(input.site_id ?? input.siteId ?? 0) || null;
  let project = parseJson(input.project_snapshot ?? input.projectSnapshot, null);
  let site = parseJson(input.site_snapshot ?? input.siteSnapshot, null);
  if (projectId) {
    const row = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!row || (customerId && Number(row.customer_id) !== Number(customerId))) fail('quotation_project_mismatch', 400);
    project = { id: row.id, name: row.name, project_num: row.project_num || null, status: row.status || null };
  }
  if (siteId) {
    const row = db.prepare('SELECT * FROM customer_sites WHERE id=?').get(siteId);
    if (!row || (customerId && Number(row.customer_id) !== Number(customerId))) fail('quotation_site_mismatch', 400);
    site = { id: row.id, name: row.name, address: row.address || null, city: row.city || null };
  }
  return { projectId, siteId, snapshot: { project: project || null, site: site || null } };
}

function normalizeShapeSnapshot(value) {
  if (value === undefined || value === null || value === '') return null;
  const snapshot = parseJsonObject(value);
  if (!snapshot || !isShapeDataContractV2(snapshot)) fail('invalid_shape_snapshot', 400);
  return snapshot;
}

function resolveCatalogReferences(db, line = {}) {
  const catalogItemId = Number(line.catalog_item_id ?? line.catalogItemId ?? 0) || null;
  const requestedProductMasterId = Number(line.product_master_id ?? line.productMasterId ?? 0) || null;
  if (!catalogItemId) {
    if (requestedProductMasterId) {
      const master = db.prepare('SELECT id FROM product_masters WHERE id=?').get(requestedProductMasterId);
      if (!master) fail('product_master_not_found', 404);
    }
    return { catalogItemId: null, productMasterId: requestedProductMasterId, catalog: null };
  }
  const catalog = db.prepare('SELECT * FROM catalog_items WHERE id=?').get(catalogItemId);
  if (!catalog) fail('catalog_item_not_found', 404);
  const productMasterId = requestedProductMasterId || Number(catalog.product_master_id || 0) || null;
  if (requestedProductMasterId && Number(catalog.product_master_id || 0) !== requestedProductMasterId) {
    fail('catalog_product_reference_mismatch', 400);
  }
  return { catalogItemId, productMasterId, catalog };
}

function normalizeQuotationLine(db, line, index, context) {
  const quantity = positive(line.quantity ?? line.qty ?? 1, 'invalid_quotation_line_quantity');
  const unit = text(line.unit) || 'pcs';
  const snapshot = normalizeShapeSnapshot(line.shape_snapshot_json ?? line.shapeSnapshot ?? null);
  const refs = resolveCatalogReferences(db, line);
  const description = text(line.item_description ?? line.itemDescription ?? line.description ?? refs.catalog?.name ?? snapshot?.displayName);
  if (!description) fail('quotation_line_description_required', 400);

  const metrics = snapshot ? itemShapeMetrics({ shapeSnapshot: snapshot, quantity }) : {};
  const suppliedUnitWeight = line.calculated_unit_weight_kg ?? line.calculatedUnitWeightKg;
  const suppliedTotalWeight = line.total_weight_kg ?? line.totalWeightKg;
  if (metrics.unitWeightKg !== null && metrics.unitWeightKg !== undefined && suppliedUnitWeight !== undefined && suppliedUnitWeight !== null && Math.abs(Number(suppliedUnitWeight) - Number(metrics.unitWeightKg)) > 0.001) {
    fail('line_unit_weight_snapshot_mismatch', 400);
  }
  if (metrics.totalWeightKg !== null && metrics.totalWeightKg !== undefined && suppliedTotalWeight !== undefined && suppliedTotalWeight !== null && Math.abs(Number(suppliedTotalWeight) - Number(metrics.totalWeightKg)) > 0.001) {
    fail('line_total_weight_snapshot_mismatch', 400);
  }
  const unitWeightKg = metrics.unitWeightKg ?? (suppliedUnitWeight === undefined || suppliedUnitWeight === null ? null : nonNegative(suppliedUnitWeight, 'invalid_line_unit_weight'));
  const totalWeightKg = metrics.totalWeightKg ?? (suppliedTotalWeight === undefined || suppliedTotalWeight === null ? (unitWeightKg === null ? null : round(unitWeightKg * quantity, 3)) : nonNegative(suppliedTotalWeight, 'invalid_line_total_weight'));

  const pricingMode = text(line.pricing_mode ?? line.pricingMode) || (line.unit_price === undefined && line.unitPrice === undefined ? 'automatic' : 'manual');
  const diameter = shapeDiameter(snapshot, line);
  let unitPrice;
  let pricingUnit;
  let pricingQuantity;
  let pricingSource;
  let pricingSnapshot;
  if (pricingMode === 'automatic') {
    if (!context.pricer || !diameter || !(totalWeightKg > 0)) fail('automatic_pricing_requires_weighted_shape', 400);
    const customer = context.priceContext;
    const resolved = context.pricer.resolveDiameterPrice(diameter, {
      tier: customer?.price_tier === 'customer' ? 'customer' : 'general',
      customerId: customer?.id || null,
      discountPct: customer?.discount_pct || 0,
    });
    if (resolved.requiresPriceListUpdate || resolved.pricePerKg === null) fail('price_list_requires_update', 409);
    unitPrice = nonNegative(resolved.pricePerKg, 'invalid_unit_price');
    pricingUnit = 'kg';
    pricingQuantity = round(totalWeightKg, 3);
    pricingSource = resolved.pricingSource;
    pricingSnapshot = {
      mode: 'automatic',
      diameter,
      price_book_id: resolved.priceBookId || null,
      price_book_code: resolved.priceBookCode || null,
      pricing_source: resolved.pricingSource || null,
      pricing_label: resolved.pricingLabel || null,
      base_price: resolved.basePrice ?? null,
      customer_discount_pct: resolved.discountPct ?? 0,
      resolved_unit_price: unitPrice,
    };
  } else if (pricingMode === 'manual') {
    unitPrice = nonNegative(line.unit_price ?? line.unitPrice, 'invalid_unit_price');
    pricingUnit = text(line.pricing_unit ?? line.pricingUnit) || (totalWeightKg !== null ? 'kg' : unit);
    pricingQuantity = line.pricing_quantity ?? line.pricingQuantity;
    if (pricingQuantity === undefined || pricingQuantity === null) pricingQuantity = pricingUnit === 'kg' ? totalWeightKg : quantity;
    pricingQuantity = nonNegative(pricingQuantity, 'invalid_pricing_quantity');
    if (pricingUnit === 'kg') {
      if (!(totalWeightKg >= 0)) fail('line_weight_required_for_kg_pricing', 400);
      if (Math.abs(Number(pricingQuantity) - Number(totalWeightKg)) > 0.001) fail('line_pricing_quantity_weight_mismatch', 400);
    }
    pricingSource = text(line.pricing_source ?? line.pricingSource) || 'manual';
    pricingSnapshot = {
      mode: 'manual',
      pricing_source: pricingSource,
      ...(parseJson(line.pricing_snapshot_json ?? line.pricingSnapshot, {}) || {}),
    };
  } else {
    fail('invalid_pricing_mode', 400);
  }

  const discountPct = nonNegative(line.discount_pct ?? line.discountPct ?? 0, 'invalid_line_discount');
  if (discountPct > 100) fail('invalid_line_discount', 400);
  const lineSubtotal = round(pricingQuantity * unitPrice);
  const discountAmount = round(lineSubtotal * discountPct / 100);
  const lineTotal = round(lineSubtotal - discountAmount);
  const vatTreatment = text(line.vat_treatment ?? line.vatTreatment) || 'standard';
  if (!['standard', 'exempt', 'out_of_scope'].includes(vatTreatment)) fail('invalid_vat_treatment', 400);
  const lineVatAmount = vatTreatment === 'standard' ? round(lineTotal * context.vatRate) : 0;
  const lineGrandTotal = round(lineTotal + lineVatAmount);

  return {
    sequence: index + 1,
    item_description: description,
    catalog_item_id: refs.catalogItemId,
    product_master_id: refs.productMasterId,
    quantity,
    unit,
    pricing_quantity: pricingQuantity,
    pricing_unit: pricingUnit,
    unit_price: unitPrice,
    discount_pct: discountPct,
    discount_amount: discountAmount,
    line_subtotal: lineSubtotal,
    vat_treatment: vatTreatment,
    line_vat_amount: lineVatAmount,
    line_total: lineTotal,
    line_grand_total: lineGrandTotal,
    calculated_unit_weight_kg: unitWeightKg === null ? null : round(unitWeightKg, 3),
    total_weight_kg: totalWeightKg === null ? null : round(totalWeightKg, 3),
    pricing_source: pricingSource,
    pricing_snapshot_json: stable(pricingSnapshot),
    shape_snapshot_json: snapshot ? stable(snapshot) : null,
  };
}

function buildDraftContent(db, input, context) {
  const customer = resolveCustomerSnapshot(db, input);
  const projectSite = resolveProjectSiteSnapshot(db, input, customer.customerId);
  const currencyCode = normalizeCurrency(input.currency_code ?? input.currencyCode);
  const vatRate = normalizeVatRate(input.vat_rate ?? input.vatRate);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines.map((line, index) => normalizeQuotationLine(db, line || {}, index, { ...context, vatRate, priceContext: customer.priceContext }));
  const subtotal = round(lines.reduce((sum, line) => sum + line.line_subtotal, 0));
  const discountTotal = round(lines.reduce((sum, line) => sum + line.discount_amount, 0));
  const vatTotal = round(lines.reduce((sum, line) => sum + line.line_vat_amount, 0));
  const grandTotal = round(lines.reduce((sum, line) => sum + line.line_grand_total, 0));
  const pricingSnapshot = {
    currency_code: currencyCode,
    vat_rate: vatRate,
    lines: lines.map(line => ({
      sequence: line.sequence,
      pricing_source: line.pricing_source,
      pricing_quantity: line.pricing_quantity,
      pricing_unit: line.pricing_unit,
      unit_price: line.unit_price,
      snapshot: parseJson(line.pricing_snapshot_json, {}),
    })),
    metadata: parseJson(input.pricing_snapshot_metadata ?? input.pricingSnapshotMetadata, {}) || {},
  };
  const content = {
    customer_snapshot: customer.snapshot,
    project_site_snapshot: projectSite.snapshot,
    currency_code: currencyCode,
    vat_rate: vatRate,
    subtotal,
    discount_total: discountTotal,
    vat_total: vatTotal,
    grand_total: grandTotal,
    validity_date: validDate(input.validity_date ?? input.validityDate),
    commercial_notes: text(input.commercial_notes ?? input.commercialNotes),
    pricing_snapshot: pricingSnapshot,
    lines: lines.map(line => ({
      ...line,
      pricing_snapshot_json: parseJson(line.pricing_snapshot_json, {}),
      shape_snapshot_json: parseJson(line.shape_snapshot_json, null),
    })),
  };
  return {
    customerId: customer.customerId,
    displayName: customer.displayName,
    projectId: projectSite.projectId,
    siteId: projectSite.siteId,
    lines,
    content,
    payloadJson: stable(content),
    payloadHash: fingerprint(content),
  };
}

function insertLines(db, revisionId, lines) {
  const insert = db.prepare(`
    INSERT INTO customer_quotation_lines (
      revision_id,sequence,item_description,catalog_item_id,product_master_id,quantity,unit,
      pricing_quantity,pricing_unit,unit_price,discount_pct,discount_amount,line_subtotal,
      vat_treatment,line_vat_amount,line_total,line_grand_total,calculated_unit_weight_kg,
      total_weight_kg,pricing_source,pricing_snapshot_json,shape_snapshot_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const line of lines) {
    insert.run(
      revisionId, line.sequence, line.item_description, line.catalog_item_id, line.product_master_id,
      line.quantity, line.unit, line.pricing_quantity, line.pricing_unit, line.unit_price,
      line.discount_pct, line.discount_amount, line.line_subtotal, line.vat_treatment,
      line.line_vat_amount, line.line_total, line.line_grand_total, line.calculated_unit_weight_kg,
      line.total_weight_kg, line.pricing_source, line.pricing_snapshot_json, line.shape_snapshot_json
    );
  }
}

function revisionValues(content, payloadJson, payloadHash) {
  return [
    stable(content.customer_snapshot), stable(content.project_site_snapshot), content.currency_code,
    content.vat_rate, content.subtotal, content.discount_total, content.vat_total, content.grand_total,
    content.validity_date, content.commercial_notes, stable(content.pricing_snapshot), payloadJson, payloadHash,
  ];
}

function mapLine(row) {
  return {
    ...row,
    pricing_snapshot: parseJson(row.pricing_snapshot_json, {}),
    shape_snapshot: parseJson(row.shape_snapshot_json, null),
  };
}

function getRevision(db, quotationId, revisionNumber = null) {
  const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(Number(quotationId));
  if (!quote) return null;
  const number = revisionNumber === null || revisionNumber === undefined ? quote.current_revision_number : Number(revisionNumber);
  const revision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE quotation_id=? AND revision_number=?').get(quote.id, number);
  if (!revision) return null;
  const lines = db.prepare('SELECT * FROM customer_quotation_lines WHERE revision_id=? ORDER BY sequence').all(revision.id).map(mapLine);
  return {
    ...revision,
    customer_snapshot: parseJson(revision.customer_snapshot_json, {}),
    project_site_snapshot: parseJson(revision.project_site_snapshot_json, {}),
    pricing_snapshot: parseJson(revision.pricing_snapshot_json, {}),
    payload: parseJson(revision.payload_json, {}),
    issued_payload: parseJson(revision.issued_payload_json, null),
    lines,
  };
}

function getQuotation(db, id) {
  const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(Number(id));
  if (!quote) return null;
  const revisions = db.prepare(`
    SELECT id,revision_uid,revision_number,version,status,currency_code,subtotal,discount_total,
           vat_total,grand_total,validity_date,payload_hash,issued_payload_hash,issued_at,issued_by,created_at,updated_at
    FROM customer_quotation_revisions WHERE quotation_id=? ORDER BY revision_number
  `).all(quote.id);
  const events = db.prepare('SELECT * FROM customer_quotation_events WHERE quotation_uid=? ORDER BY id').all(quote.quotation_uid)
    .map(row => ({ ...row, details: parseJson(row.details_json, {}) }));
  return { ...quote, current_revision: getRevision(db, quote.id), revisions, events };
}

function listQuotations(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.status) { where.push('lifecycle_status=?'); params.push(String(filters.status)); }
  if (filters.customer_id ?? filters.customerId) { where.push('customer_id=?'); params.push(Number(filters.customer_id ?? filters.customerId)); }
  if (!filters.include_archived && !filters.includeArchived) where.push('archived_at IS NULL');
  const sql = `SELECT id FROM customer_quotations${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`;
  return db.prepare(sql).all(...params).map(row => getQuotation(db, row.id));
}

function eventReplay(db, key, actionPayload) {
  const row = db.prepare('SELECT * FROM customer_quotation_events WHERE idempotency_key=?').get(key);
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint(actionPayload)) fail('idempotency_key_conflict');
  return getQuotation(db, row.quotation_id) || parseJson(row.details_json, {}).result || { deleted: true, quotation_uid: row.quotation_uid };
}

function writeEvent(db, quote, revision, type, key, actionPayload, actorId, details) {
  db.prepare(`
    INSERT INTO customer_quotation_events (
      event_uid,quotation_id,quotation_uid,quotation_num,revision_id,revision_number,event_type,
      idempotency_key,payload_fingerprint,actor_id,details_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    crypto.randomUUID(), quote?.id ?? null, quote.quotation_uid, quote.quotation_num || null,
    revision?.id ?? null, revision?.revision_number ?? quote.current_revision_number ?? null,
    type, key, fingerprint(actionPayload), actorId ?? null, stable(details || {})
  );
}

function auditSnapshot(db, quote) {
  const revision = getRevision(db, quote.id);
  return {
    quotation_uid: quote.quotation_uid,
    quotation_num: quote.quotation_num || null,
    lifecycle_status: quote.lifecycle_status,
    current_revision_number: quote.current_revision_number,
    revision: revision ? {
      revision_uid: revision.revision_uid,
      revision_number: revision.revision_number,
      version: revision.version,
      status: revision.status,
      payload_hash: revision.payload_hash,
      issued_payload_hash: revision.issued_payload_hash || null,
      payload: revision.payload,
    } : null,
  };
}

function inputFromRevision(quote, revision) {
  return {
    customer_id: quote.customer_id,
    customer_snapshot: revision.customer_snapshot,
    prospect_display_name: quote.prospect_display_name,
    project_id: quote.project_id,
    site_id: quote.site_id,
    project_snapshot: revision.project_site_snapshot?.project,
    site_snapshot: revision.project_site_snapshot?.site,
    currency_code: revision.currency_code,
    vat_rate: revision.vat_rate,
    validity_date: revision.validity_date,
    commercial_notes: revision.commercial_notes,
    pricing_snapshot_metadata: revision.pricing_snapshot?.metadata || {},
    lines: revision.lines.map(line => ({
      item_description: line.item_description,
      catalog_item_id: line.catalog_item_id,
      product_master_id: line.product_master_id,
      quantity: line.quantity,
      unit: line.unit,
      pricing_quantity: line.pricing_quantity,
      pricing_unit: line.pricing_unit,
      unit_price: line.unit_price,
      pricing_mode: 'manual',
      pricing_source: line.pricing_source,
      pricing_snapshot: line.pricing_snapshot,
      discount_pct: line.discount_pct,
      vat_treatment: line.vat_treatment,
      calculated_unit_weight_kg: line.calculated_unit_weight_kg,
      total_weight_kg: line.total_weight_kg,
      shapeSnapshot: line.shape_snapshot,
    })),
  };
}

function createCustomerQuotationService(db, { pricer = null, generateQuotationNumber } = {}) {
  if (!db) throw new Error('services/customerQuotationV1 missing dependency: db');
  if (!generateQuotationNumber) throw new Error('services/customerQuotationV1 missing dependency: generateQuotationNumber');

  function createDraft(input = {}) {
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('create', input);
    const tx = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM customer_quotations WHERE create_idempotency_key=?').get(key);
      if (existing) {
        if (existing.create_payload_fingerprint !== fingerprint(actionPayload)) fail('idempotency_key_conflict');
        return getQuotation(db, existing.id);
      }
      const built = buildDraftContent(db, input, { pricer });
      const quoteResult = db.prepare(`
        INSERT INTO customer_quotations (
          quotation_uid,current_revision_number,lifecycle_status,customer_id,prospect_display_name,
          project_id,site_id,owner_id,created_by,create_idempotency_key,create_payload_fingerprint
        ) VALUES (?,1,'draft',?,?,?,?,?,?,?,?)
      `).run(
        crypto.randomUUID(), built.customerId, built.displayName, built.projectId, built.siteId,
        input.owner_id ?? input.ownerId ?? input.created_by ?? input.createdBy ?? null,
        input.created_by ?? input.createdBy ?? null, key, fingerprint(actionPayload)
      );
      const quotationId = quoteResult.lastInsertRowid;
      const revisionResult = db.prepare(`
        INSERT INTO customer_quotation_revisions (
          revision_uid,quotation_id,revision_number,version,status,customer_snapshot_json,
          project_site_snapshot_json,currency_code,vat_rate,subtotal,discount_total,vat_total,
          grand_total,validity_date,commercial_notes,pricing_snapshot_json,payload_json,payload_hash,created_by
        ) VALUES (?,?,1,1,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        crypto.randomUUID(), quotationId, ...revisionValues(built.content, built.payloadJson, built.payloadHash),
        input.created_by ?? input.createdBy ?? null
      );
      insertLines(db, revisionResult.lastInsertRowid, built.lines);
      const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const revision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE id=?').get(revisionResult.lastInsertRowid);
      writeEvent(db, quote, revision, 'draft_created', key, actionPayload, input.created_by ?? input.createdBy, { after: auditSnapshot(db, quote) });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  function updateDraft(input = {}) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('update_draft', input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare("SELECT * FROM customer_quotations WHERE id=? AND lifecycle_status='draft' AND archived_at IS NULL").get(quotationId);
      if (!quote) fail('draft_quotation_required');
      const revision = getRevision(db, quotationId);
      if (!revision || revision.status !== 'draft') fail('draft_revision_required');
      const expectedVersion = Number(input.expected_version ?? input.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(revision.version)) fail('quotation_revision_conflict');
      const before = auditSnapshot(db, quote);
      const base = inputFromRevision(quote, revision);
      const merged = { ...base, ...input, lines: hasOwn(input, 'lines') ? input.lines : base.lines };
      const built = buildDraftContent(db, merged, { pricer });
      db.prepare(`
        UPDATE customer_quotations SET customer_id=?,prospect_display_name=?,project_id=?,site_id=?,
          owner_id=COALESCE(?,owner_id),updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(built.customerId, built.displayName, built.projectId, built.siteId, input.owner_id ?? input.ownerId ?? null, quotationId);
      db.prepare(`
        UPDATE customer_quotation_revisions SET version=version+1,customer_snapshot_json=?,
          project_site_snapshot_json=?,currency_code=?,vat_rate=?,subtotal=?,discount_total=?,vat_total=?,
          grand_total=?,validity_date=?,commercial_notes=?,pricing_snapshot_json=?,payload_json=?,payload_hash=?,
          updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'
      `).run(...revisionValues(built.content, built.payloadJson, built.payloadHash), revision.id);
      db.prepare('DELETE FROM customer_quotation_lines WHERE revision_id=?').run(revision.id);
      insertLines(db, revision.id, built.lines);
      const updatedQuote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const updatedRevision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE id=?').get(revision.id);
      writeEvent(db, updatedQuote, updatedRevision, 'draft_updated', key, actionPayload, input.updated_by ?? input.updatedBy, { before, after: auditSnapshot(db, updatedQuote) });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  function issue(input = {}) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('issue', input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare("SELECT * FROM customer_quotations WHERE id=? AND lifecycle_status='draft' AND archived_at IS NULL").get(quotationId);
      if (!quote) fail('draft_quotation_required');
      const revision = getRevision(db, quotationId);
      if (!revision || revision.status !== 'draft') fail('draft_revision_required');
      const expectedVersion = Number(input.expected_version ?? input.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(revision.version)) fail('quotation_revision_conflict');
      if (!revision.lines.length) fail('quotation_lines_required', 400);
      if (!text(revision.customer_snapshot?.name)) fail('customer_or_prospect_required', 400);
      const quotationNum = quote.quotation_num || generateQuotationNumber();
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE customer_quotation_revisions SET status='issued',issued_payload_json=payload_json,
          issued_payload_hash=payload_hash,issued_at=?,issued_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'
      `).run(now, input.issued_by ?? input.issuedBy ?? null, revision.id);
      db.prepare(`
        UPDATE customer_quotations SET quotation_num=?,lifecycle_status='issued',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(quotationNum, quotationId);
      const issuedQuote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const issuedRevision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE id=?').get(revision.id);
      writeEvent(db, issuedQuote, issuedRevision, 'issued', key, actionPayload, input.issued_by ?? input.issuedBy, { after: auditSnapshot(db, issuedQuote) });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  function createNewRevision(input = {}) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('new_revision', input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=? AND archived_at IS NULL').get(quotationId);
      if (!quote) fail('quotation_not_found', 404);
      if (!['issued', 'accepted', 'rejected', 'expired'].includes(quote.lifecycle_status)) fail('issued_revision_required');
      const source = getRevision(db, quotationId);
      if (!source || source.status !== 'issued') fail('issued_revision_required');
      const nextNumber = Number(quote.current_revision_number) + 1;
      const revisionResult = db.prepare(`
        INSERT INTO customer_quotation_revisions (
          revision_uid,quotation_id,revision_number,version,status,customer_snapshot_json,
          project_site_snapshot_json,currency_code,vat_rate,subtotal,discount_total,vat_total,
          grand_total,validity_date,commercial_notes,pricing_snapshot_json,payload_json,payload_hash,created_by
        ) SELECT ?,quotation_id,?,1,'draft',customer_snapshot_json,project_site_snapshot_json,currency_code,
          vat_rate,subtotal,discount_total,vat_total,grand_total,validity_date,commercial_notes,
          pricing_snapshot_json,payload_json,payload_hash,? FROM customer_quotation_revisions WHERE id=?
      `).run(crypto.randomUUID(), nextNumber, input.created_by ?? input.createdBy ?? null, source.id);
      db.prepare(`
        INSERT INTO customer_quotation_lines (
          revision_id,sequence,item_description,catalog_item_id,product_master_id,quantity,unit,
          pricing_quantity,pricing_unit,unit_price,discount_pct,discount_amount,line_subtotal,
          vat_treatment,line_vat_amount,line_total,line_grand_total,calculated_unit_weight_kg,
          total_weight_kg,pricing_source,pricing_snapshot_json,shape_snapshot_json
        ) SELECT ?,sequence,item_description,catalog_item_id,product_master_id,quantity,unit,
          pricing_quantity,pricing_unit,unit_price,discount_pct,discount_amount,line_subtotal,
          vat_treatment,line_vat_amount,line_total,line_grand_total,calculated_unit_weight_kg,
          total_weight_kg,pricing_source,pricing_snapshot_json,shape_snapshot_json
        FROM customer_quotation_lines WHERE revision_id=? ORDER BY sequence
      `).run(revisionResult.lastInsertRowid, source.id);
      db.prepare(`
        UPDATE customer_quotations SET current_revision_number=?,lifecycle_status='draft',
          accepted_at=NULL,accepted_by=NULL,rejected_at=NULL,rejected_by=NULL,expired_at=NULL,expired_by=NULL,
          cancelled_at=NULL,cancelled_by=NULL,cancellation_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(nextNumber, quotationId);
      const updated = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const revision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE id=?').get(revisionResult.lastInsertRowid);
      writeEvent(db, updated, revision, 'new_revision_created', key, actionPayload, input.created_by ?? input.createdBy, {
        source_revision_number: source.revision_number,
        source_payload_hash: source.issued_payload_hash,
        after: auditSnapshot(db, updated),
      });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  const transitions = {
    accepted: new Set(['issued']),
    rejected: new Set(['issued']),
    expired: new Set(['issued']),
    cancelled: new Set(['draft', 'issued', 'accepted']),
  };

  function transition(input, next) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload(next, input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=? AND archived_at IS NULL').get(quotationId);
      if (!quote) fail('quotation_not_found', 404);
      if (!transitions[next]?.has(quote.lifecycle_status)) fail('invalid_quotation_transition');
      const reason = text(input.reason);
      if (['rejected', 'cancelled'].includes(next) && !reason) fail('quotation_transition_reason_required', 400);
      const now = new Date().toISOString();
      const actor = input.actor_id ?? input.actorId ?? null;
      if (next === 'accepted') db.prepare("UPDATE customer_quotations SET lifecycle_status='accepted',accepted_at=?,accepted_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, actor, quotationId);
      if (next === 'rejected') db.prepare("UPDATE customer_quotations SET lifecycle_status='rejected',rejected_at=?,rejected_by=?,cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, actor, reason, quotationId);
      if (next === 'expired') db.prepare("UPDATE customer_quotations SET lifecycle_status='expired',expired_at=?,expired_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, actor, quotationId);
      if (next === 'cancelled') db.prepare("UPDATE customer_quotations SET lifecycle_status='cancelled',cancelled_at=?,cancelled_by=?,cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(now, actor, reason, quotationId);
      const updated = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const revision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE quotation_id=? AND revision_number=?').get(quotationId, updated.current_revision_number);
      writeEvent(db, updated, revision, next, key, actionPayload, actor, { reason, after: auditSnapshot(db, updated) });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  function archive(input = {}) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('archive', input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      if (!quote) fail('quotation_not_found', 404);
      if (quote.archived_at) fail('quotation_already_archived');
      if (!['accepted', 'rejected', 'expired', 'cancelled'].includes(quote.lifecycle_status)) fail('terminal_quotation_required');
      db.prepare('UPDATE customer_quotations SET archived_at=?,archived_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(new Date().toISOString(), input.actor_id ?? input.actorId ?? null, quotationId);
      const updated = db.prepare('SELECT * FROM customer_quotations WHERE id=?').get(quotationId);
      const revision = db.prepare('SELECT * FROM customer_quotation_revisions WHERE quotation_id=? AND revision_number=?').get(quotationId, updated.current_revision_number);
      writeEvent(db, updated, revision, 'archived', key, actionPayload, input.actor_id ?? input.actorId, { after: auditSnapshot(db, updated) });
      return getQuotation(db, quotationId);
    });
    return tx.immediate();
  }

  function deleteUnusedDraft(input = {}) {
    const quotationId = Number(input.quotation_id ?? input.quotationId);
    const key = text(input.idempotency_key ?? input.idempotencyKey);
    if (!quotationId || !key) fail('idempotency_key_required', 400);
    const actionPayload = rawActionPayload('delete_unused_draft', input, quotationId);
    const tx = db.transaction(() => {
      const replay = eventReplay(db, key, actionPayload);
      if (replay) return replay;
      const quote = db.prepare("SELECT * FROM customer_quotations WHERE id=? AND lifecycle_status='draft' AND quotation_num IS NULL").get(quotationId);
      if (!quote) fail('unused_draft_required');
      const revisions = db.prepare('SELECT * FROM customer_quotation_revisions WHERE quotation_id=? ORDER BY revision_number').all(quotationId);
      if (revisions.length !== 1 || revisions[0].status !== 'draft') fail('unused_draft_required');
      const result = { deleted: true, quotation_id: quotationId, quotation_uid: quote.quotation_uid };
      writeEvent(db, quote, revisions[0], 'unused_draft_deleted', key, actionPayload, input.actor_id ?? input.actorId, { before: auditSnapshot(db, quote), result });
      db.prepare('DELETE FROM customer_quotation_lines WHERE revision_id=?').run(revisions[0].id);
      db.prepare('DELETE FROM customer_quotation_revisions WHERE id=?').run(revisions[0].id);
      db.prepare('DELETE FROM customer_quotations WHERE id=?').run(quotationId);
      return result;
    });
    return tx.immediate();
  }

  return {
    createDraft,
    updateDraft,
    issue,
    createNewRevision,
    accept: input => transition(input, 'accepted'),
    reject: input => transition(input, 'rejected'),
    expire: input => transition(input, 'expired'),
    cancel: input => transition(input, 'cancelled'),
    archive,
    deleteUnusedDraft,
    getQuotation: id => getQuotation(db, id),
    getRevision: (id, number) => getRevision(db, id, number),
    listQuotations: filters => listQuotations(db, filters),
  };
}

module.exports = {
  CustomerQuotationError,
  createCustomerQuotationService,
  stable,
  fingerprint,
};
