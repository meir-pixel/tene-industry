'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCoreSchema } = require('../db/coreSchema');
const { ensureFinanceSchema } = require('../db/financeSchema');
const { createPricer } = require('../services/pricer');
const { createSettingsService } = require('../services/settings');
const { buildFullShapeSnapshot } = require('../services/shapeSnapshot');
const { createQuotationNumberAllocator } = require('../services/quotationNumbers');
const { createCustomerQuotationService } = require('../services/customerQuotationV1');
const { renderQuotationPrintPage } = require('../services/quotationPrintPage');

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  ensureCoreSchema(db);
  ensureFinanceSchema(db);
  const settings = createSettingsService(db);
  const bookId = db.prepare(`
    INSERT INTO pricing_price_books (code,name,price_type,status,currency)
    VALUES ('Q-GENERAL','Quotation General','general','active','ILS')
  `).run().lastInsertRowid;
  db.prepare(`
    INSERT INTO pricing_price_items (price_book_id,sku,diameter,description,unit,price_before_vat,currency,active)
    VALUES (?,?,?,?,?,?,?,1)
  `).run(bookId, 'RB-12', 12, 'Rebar 12', 'kg', 5, 'ILS');
  const service = createCustomerQuotationService(db, {
    pricer: createPricer(db),
    generateQuotationNumber: createQuotationNumberAllocator(db),
    getVatRate: () => settings.getVatRate(),
  });
  return { db, service, settings };
}

function shapeSnapshot() {
  return buildFullShapeSnapshot({
    shapeId: 'quotation-line-straight-12',
    shapeType: 'straight_bar',
    family: 'bars',
    displayName: 'Straight bar',
    data: { diameter: 12, lengthMm: 12000 },
    calculated: { totalLengthMm: 12000, weightKg: 10 },
    validation: { valid: true, errors: [], warnings: [] },
  });
}

function draftInput(key = 'quotation-create-1', overrides = {}) {
  return {
    idempotency_key: key,
    prospect: { name: 'Prospect <Safe>', email: 'quote@example.test' },
    currency_code: 'ILS',
    vat_rate: 0.18,
    validity_date: '2026-09-01',
    commercial_notes: 'Commercial terms',
    lines: [{
      item_description: 'Ø12 shaped steel',
      quantity: 2,
      unit: 'pcs',
      shapeSnapshot: shapeSnapshot(),
      pricing_mode: 'automatic',
    }],
    ...overrides,
  };
}

function counts(db) {
  const names = [
    'orders', 'items', 'pallets', 'production_card_weights', 'production_events', 'scan_log',
    'material_requirements_v2', 'allocation_plans_v2', 'allocation_plan_lines_v2',
    'allocation_plan_events_v2', 'inventory_reservations', 'material_consumption_reports_v2',
    'material_consumption_report_lines_v2', 'material_consumption_report_audit_v2',
    'material_consumption_events_v2', 'material_consumption_event_lines_v2',
    'pending_raw_material_receipts_v2', 'pending_raw_material_receipt_lines_v2',
    'pending_raw_material_receipt_events_v2', 'procurement_recommendations_v2',
    'procurement_recommendation_requirement_links_v2', 'procurement_recommendation_events_v2',
    'purchase_orders', 'delivery_notes', 'raw_material', 'raw_material_usage', 'order_billing',
    'order_costs',
  ];
  return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count]));
}

test('canonical VAT accessor defaults once, accepts decimals and rejects malformed configuration', () => {
  const { db, settings } = setup();
  try {
    assert.equal(settings.getVatRate(), 0.18);
    const definition = db.prepare("SELECT default_value,min_value,max_value FROM setting_definitions WHERE key='VAT_RATE'").get();
    assert.deepEqual(definition, { default_value: '0.18', min_value: 0, max_value: 1 });
    const vatColumn = db.prepare("PRAGMA table_info(customer_quotation_revisions)").all().find(column => column.name === 'vat_rate');
    assert.equal(vatColumn.dflt_value, null);

    settings.set('VAT_RATE', '0.25');
    assert.equal(settings.getVatRate(), 0.25);
    for (const invalid of ['18', '-0.01', '1.01', 'not-a-number', '']) {
      settings.set('VAT_RATE', invalid);
      assert.throws(
        () => settings.getVatRate(),
        error => error.code === 'invalid_vat_rate_configuration' && error.statusCode === 500,
        String(invalid)
      );
    }
  } finally { db.close(); }
});

test('quotation draft persists canonical shape and price snapshots without creating operational rows', () => {
  const { db, service } = setup();
  try {
    const before = counts(db);
    const quote = service.createDraft(draftInput());
    assert.equal(quote.lifecycle_status, 'draft');
    assert.equal(quote.quotation_num, null);
    assert.equal(quote.current_revision.status, 'draft');
    assert.equal(quote.current_revision.lines.length, 1);
    assert.equal(quote.current_revision.lines[0].shape_snapshot.contractVersion, 2);
    assert.equal(quote.current_revision.lines[0].calculated_unit_weight_kg, 10);
    assert.equal(quote.current_revision.lines[0].total_weight_kg, 20);
    assert.equal(quote.current_revision.lines[0].pricing_quantity, 20);
    assert.equal(quote.current_revision.lines[0].unit_price, 5);
    assert.equal(quote.current_revision.subtotal, 100);
    assert.equal(quote.current_revision.vat_total, 18);
    assert.equal(quote.current_revision.grand_total, 118);
    assert.deepEqual(counts(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_quotation_events').get().count, 1);
  } finally { db.close(); }
});

test('draft and issue use the canonical VAT rate while issued revisions and PDFs remain frozen', () => {
  const { db, service, settings } = setup();
  try {
    settings.set('VAT_RATE', '0.20');
    const draft = service.createDraft(draftInput('vat-create', { vat_rate: 0.99 }));
    assert.equal(draft.current_revision.vat_rate, 0.2);
    assert.equal(draft.current_revision.vat_total, 20);
    assert.equal(draft.current_revision.grand_total, 120);

    settings.set('VAT_RATE', '0.25');
    const issued = service.issue({ quotation_id: draft.id, idempotency_key: 'vat-issue', expected_version: 1 });
    assert.equal(issued.current_revision.vat_rate, 0.25);
    assert.equal(issued.current_revision.lines[0].line_vat_amount, 25);
    assert.equal(issued.current_revision.vat_total, 25);
    assert.equal(issued.current_revision.grand_total, 125);
    assert.equal(issued.current_revision.issued_payload.vat_rate, 0.25);
    assert.equal(issued.current_revision.issued_payload.vat_total, 25);

    const issuedHash = issued.current_revision.issued_payload_hash;
    const issuedHtml = renderQuotationPrintPage({ quotation: issued, revision: issued.current_revision });
    assert.match(issuedHtml, /\u05de\u05e2\u05f4\u05de \(25%\)/);
    assert.match(issuedHtml, /25\.00 ILS/);

    settings.set('VAT_RATE', '0.30');
    const historical = service.getRevision(draft.id, 1);
    assert.equal(historical.vat_rate, 0.25);
    assert.equal(historical.vat_total, 25);
    assert.equal(historical.grand_total, 125);
    assert.equal(historical.issued_payload_hash, issuedHash);
    assert.equal(
      renderQuotationPrintPage({ quotation: service.getQuotation(draft.id), revision: historical }),
      issuedHtml
    );

    const next = service.createNewRevision({ quotation_id: draft.id, idempotency_key: 'vat-revision-2' });
    assert.equal(next.current_revision.status, 'draft');
    assert.equal(next.current_revision.vat_rate, 0.3);
    assert.equal(next.current_revision.vat_total, 30);
    assert.equal(next.current_revision.grand_total, 130);
    assert.equal(service.getRevision(draft.id, 1).issued_payload_hash, issuedHash);
    assert.equal(service.getRevision(draft.id, 1).vat_rate, 0.25);
  } finally { db.close(); }
});

test('invalid canonical VAT prevents issue without partial revision, number or audit mutation', () => {
  const { db, service, settings } = setup();
  try {
    const draft = service.createDraft(draftInput('invalid-vat-create'));
    const before = service.getQuotation(draft.id);
    const beforeEvents = db.prepare('SELECT COUNT(*) AS count FROM customer_quotation_events').get().count;
    const beforeNumbers = db.prepare('SELECT COUNT(*) AS count FROM quotation_sequences').get().count;
    settings.set('VAT_RATE', '18');

    assert.throws(
      () => service.issue({ quotation_id: draft.id, idempotency_key: 'invalid-vat-issue', expected_version: 1 }),
      error => error.code === 'invalid_vat_rate_configuration' && error.statusCode === 500
    );
    const after = service.getQuotation(draft.id);
    assert.equal(after.lifecycle_status, 'draft');
    assert.equal(after.quotation_num, null);
    assert.equal(after.current_revision.status, 'draft');
    assert.equal(after.current_revision.payload_hash, before.current_revision.payload_hash);
    assert.deepEqual(after.current_revision.lines, before.current_revision.lines);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_quotation_events').get().count, beforeEvents);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM quotation_sequences').get().count, beforeNumbers);
  } finally { db.close(); }
});

test('create, update and issue are idempotent and reject conflicting payloads', () => {
  const { db, service } = setup();
  try {
    const input = draftInput('same-create');
    const first = service.createDraft(input);
    assert.equal(service.createDraft(input).id, first.id);
    assert.throws(() => service.createDraft({ ...input, commercial_notes: 'different' }), /idempotency_key_conflict/);

    const update = { quotation_id: first.id, idempotency_key: 'update-1', expected_version: 1, commercial_notes: 'Updated' };
    const updated = service.updateDraft(update);
    assert.equal(updated.current_revision.version, 2);
    assert.equal(service.updateDraft(update).current_revision.version, 2);
    assert.throws(() => service.updateDraft({ ...update, commercial_notes: 'Conflict' }), /idempotency_key_conflict/);
    assert.throws(() => service.updateDraft({ ...update, idempotency_key: 'stale', expected_version: 1 }), /quotation_revision_conflict/);

    const issueInput = { quotation_id: first.id, idempotency_key: 'issue-1', expected_version: 2, issued_by: 7 };
    const issued = service.issue(issueInput);
    assert.match(issued.quotation_num, /^QT-\d{4}-0001$/);
    assert.equal(issued.lifecycle_status, 'issued');
    assert.equal(issued.current_revision.status, 'issued');
    assert.equal(issued.current_revision.payload_hash, issued.current_revision.issued_payload_hash);
    assert.deepEqual(issued.current_revision.payload, issued.current_revision.issued_payload);
    assert.equal(service.issue(issueInput).quotation_num, issued.quotation_num);
    assert.throws(() => service.issue({ ...issueInput, expected_version: 99 }), /idempotency_key_conflict/);
  } finally { db.close(); }
});

test('issued revision and lines are immutable while editing creates a new draft revision', () => {
  const { db, service } = setup();
  try {
    const draft = service.createDraft(draftInput());
    const issued = service.issue({ quotation_id: draft.id, idempotency_key: 'issue', expected_version: 1 });
    const issuedHash = issued.current_revision.issued_payload_hash;
    const issuedRevisionId = issued.current_revision.id;
    assert.throws(() => db.prepare('UPDATE customer_quotation_revisions SET commercial_notes=? WHERE id=?').run('tamper', issuedRevisionId), /issued_quotation_revision_immutable/);
    assert.throws(() => db.prepare('UPDATE customer_quotation_lines SET unit_price=0 WHERE revision_id=?').run(issuedRevisionId), /issued_quotation_revision_immutable/);
    assert.throws(() => service.updateDraft({ quotation_id: draft.id, idempotency_key: 'bad-edit', expected_version: 1 }), /draft_quotation_required/);

    const next = service.createNewRevision({ quotation_id: draft.id, idempotency_key: 'revision-2', created_by: 8 });
    assert.equal(next.lifecycle_status, 'draft');
    assert.equal(next.current_revision.revision_number, 2);
    assert.equal(next.current_revision.status, 'draft');
    assert.equal(next.current_revision.lines.length, 1);
    const edited = service.updateDraft({ quotation_id: draft.id, idempotency_key: 'edit-r2', expected_version: 1, commercial_notes: 'Revision 2' });
    assert.equal(edited.current_revision.version, 2);
    const original = service.getRevision(draft.id, 1);
    assert.equal(original.status, 'issued');
    assert.equal(original.issued_payload_hash, issuedHash);
    assert.equal(original.commercial_notes, 'Commercial terms');
  } finally { db.close(); }
});

test('lifecycle events are append-only and transitions retain issued history', () => {
  const { db, service } = setup();
  try {
    const draft = service.createDraft(draftInput());
    service.issue({ quotation_id: draft.id, idempotency_key: 'issue', expected_version: 1 });
    const accepted = service.accept({ quotation_id: draft.id, idempotency_key: 'accept', actor_id: 9 });
    assert.equal(accepted.lifecycle_status, 'accepted');
    const cancelled = service.cancel({ quotation_id: draft.id, idempotency_key: 'cancel', actor_id: 9, reason: 'Customer cancelled' });
    assert.equal(cancelled.lifecycle_status, 'cancelled');
    const archived = service.archive({ quotation_id: draft.id, idempotency_key: 'archive', actor_id: 9 });
    assert.ok(archived.archived_at);
    assert.deepEqual(archived.events.map(event => event.event_type), ['draft_created', 'issued', 'accepted', 'cancelled', 'archived']);
    assert.throws(() => db.prepare('UPDATE customer_quotation_events SET event_type=? WHERE id=?').run('issued', archived.events[0].id));
    assert.equal(service.getRevision(draft.id, 1).status, 'issued');
  } finally { db.close(); }
});

test('unused draft deletion retains a deletion audit event and creates no order', () => {
  const { db, service } = setup();
  try {
    const draft = service.createDraft(draftInput());
    const result = service.deleteUnusedDraft({ quotation_id: draft.id, idempotency_key: 'delete-draft', actor_id: 3 });
    assert.deepEqual(result, { deleted: true, quotation_id: draft.id, quotation_uid: draft.quotation_uid });
    assert.equal(service.getQuotation(draft.id), null);
    const event = db.prepare("SELECT * FROM customer_quotation_events WHERE event_type='unused_draft_deleted'").get();
    assert.equal(event.quotation_uid, draft.quotation_uid);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
    assert.deepEqual(service.deleteUnusedDraft({ quotation_id: draft.id, idempotency_key: 'delete-draft', actor_id: 3 }), result);
  } finally { db.close(); }
});

test('invalid shape snapshots and mismatched weight snapshots fail closed', () => {
  const { db, service } = setup();
  try {
    assert.throws(() => service.createDraft(draftInput('invalid-shape', {
      lines: [{ description: 'bad', quantity: 1, unit_price: 1, pricing_quantity: 1, pricing_unit: 'pcs', shapeSnapshot: { family: 'bars' } }],
    })), /invalid_shape_snapshot/);
    assert.throws(() => service.createDraft(draftInput('weight-mismatch', {
      lines: [{ ...draftInput().lines[0], calculated_unit_weight_kg: 99 }],
    })), /line_unit_weight_snapshot_mismatch/);
  } finally { db.close(); }
});

test('draft preview is marked and issued print renders immutable commercial revision', () => {
  const { db, service } = setup();
  try {
    const draft = service.createDraft(draftInput());
    const draftHtml = renderQuotationPrintPage({ quotation: draft, revision: draft.current_revision });
    assert.match(draftHtml, /data-revision-status="draft"/);
    assert.match(draftHtml, /טיוטה — לא נשלח ללקוח/);
    assert.doesNotMatch(draftHtml, /Issued payload SHA-256/);
    const quote = service.issue({ quotation_id: draft.id, idempotency_key: 'issue', expected_version: 1 });
    const html = renderQuotationPrintPage({ quotation: quote, revision: quote.current_revision });
    assert.match(html, /data-document-kind="customer-quotation"/);
    assert.match(html, new RegExp(quote.quotation_num));
    assert.match(html, new RegExp(quote.current_revision.issued_payload_hash));
    assert.match(html, /הדפס \/ שמור PDF/);
    assert.doesNotMatch(html, /Prospect <Safe>/);
    assert.match(html, /Prospect &lt;Safe&gt;/);
  } finally { db.close(); }
});

test('quotation lifecycle remains isolated from all operational tables', () => {
  const { db, service } = setup();
  try {
    const before = counts(db);
    const created = service.createDraft(draftInput('isolation-create'));
    const updated = service.updateDraft({
      quotation_id: created.id,
      idempotency_key: 'isolation-update',
      expected_version: 1,
      commercial_notes: 'Pricing refresh',
    });
    renderQuotationPrintPage({ quotation: updated, revision: updated.current_revision });
    service.issue({ quotation_id: created.id, idempotency_key: 'isolation-issue-1', expected_version: 2 });
    const revision = service.createNewRevision({ quotation_id: created.id, idempotency_key: 'isolation-revision-2' });
    service.issue({ quotation_id: created.id, idempotency_key: 'isolation-issue-2', expected_version: revision.current_revision.version });
    service.cancel({ quotation_id: created.id, idempotency_key: 'isolation-cancel', reason: 'Test closure' });
    service.archive({ quotation_id: created.id, idempotency_key: 'isolation-archive' });
    assert.deepEqual(counts(db), before);
  } finally { db.close(); }
});

test('existing customer, project and site are copied into an immutable issued snapshot', () => {
  const { db, service } = setup();
  try {
    const customerId = db.prepare('INSERT INTO customers (name,phone,email,address) VALUES (?,?,?,?)')
      .run('Snapshot Customer', '050-1', 'before@example.test', 'Old address').lastInsertRowid;
    const projectId = db.prepare('INSERT INTO projects (customer_id,name,project_num) VALUES (?,?,?)')
      .run(customerId, 'Snapshot Project', 'P-1').lastInsertRowid;
    const siteId = db.prepare('INSERT INTO customer_sites (customer_id,name,address,city) VALUES (?,?,?,?)')
      .run(customerId, 'Snapshot Site', 'Site address', 'City').lastInsertRowid;
    const draft = service.createDraft(draftInput('snapshot-create', {
      prospect: undefined,
      customer_id: customerId,
      project_id: projectId,
      site_id: siteId,
    }));
    const issued = service.issue({ quotation_id: draft.id, idempotency_key: 'snapshot-issue', expected_version: 1 });
    db.prepare('UPDATE customers SET name=?,address=? WHERE id=?').run('Changed Customer', 'New address', customerId);
    db.prepare('UPDATE projects SET name=? WHERE id=?').run('Changed Project', projectId);
    db.prepare('UPDATE customer_sites SET name=? WHERE id=?').run('Changed Site', siteId);
    const revision = service.getRevision(issued.id, 1);
    assert.equal(revision.customer_snapshot.name, 'Snapshot Customer');
    assert.equal(revision.customer_snapshot.address, 'Old address');
    assert.equal(revision.project_site_snapshot.project.name, 'Snapshot Project');
    assert.equal(revision.project_site_snapshot.site.name, 'Snapshot Site');
    assert.equal(revision.issued_payload_hash, issued.current_revision.issued_payload_hash);
  } finally { db.close(); }
});

test('rejected and expired terminal states use explicit append-only lifecycle events', () => {
  const { db, service } = setup();
  try {
    for (const action of ['reject', 'expire']) {
      const status = action === 'expire' ? 'expired' : 'rejected';
      const draft = service.createDraft(draftInput(`create-${action}`));
      service.issue({ quotation_id: draft.id, idempotency_key: `issue-${action}`, expected_version: 1 });
      const input = { quotation_id: draft.id, idempotency_key: action, actor_id: 4 };
      if (action === 'reject') input.reason = 'Customer declined';
      const result = service[action](input);
      assert.equal(result.lifecycle_status, status);
      assert.equal(result.events.at(-1).event_type, status);
      assert.equal(result.current_revision.status, 'issued');
    }
  } finally { db.close(); }
});
