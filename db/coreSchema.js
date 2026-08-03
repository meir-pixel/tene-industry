'use strict';

const { ensureFinanceSchema } = require('./financeSchema');

function tableColumns(db, table) {
  return db.pragma(`table_info(${table})`).map(column => column.name);
}

function ensureColumn(db, table, column, definition) {
  if (tableColumns(db, table).includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[DB] Migration: ${table}.${column} added`);
}

function ensureMaterialAllocationPlanningV2Schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS allocation_plans_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_uid TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      material_requirement_id INTEGER NOT NULL,
      requirement_uid TEXT NOT NULL,
      required_kg NUMERIC NOT NULL CHECK (typeof(required_kg) IN ('integer','real') AND required_kg > 0),
      source_revision TEXT,
      spec_diameter NUMERIC,
      spec_material_type TEXT,
      lifecycle_version INTEGER NOT NULL DEFAULT 2 CHECK (lifecycle_version = 2),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','superseded','cancelled')),
      planned_by INTEGER,
      planned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      released_by INTEGER,
      released_at DATETIME,
      release_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_requirement_id) REFERENCES material_requirements_v2(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_allocation_plans_v2_one_active_requirement
      ON allocation_plans_v2(material_requirement_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_allocation_plans_v2_requirement
      ON allocation_plans_v2(material_requirement_id, id);
    CREATE TABLE IF NOT EXISTS allocation_plan_lines_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allocation_plan_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL,
      allocated_kg NUMERIC NOT NULL CHECK (typeof(allocated_kg) IN ('integer','real') AND allocated_kg > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
      allocation_sequence INTEGER NOT NULL,
      released_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (allocation_plan_id) REFERENCES allocation_plans_v2(id),
      FOREIGN KEY (raw_material_id) REFERENCES raw_material(id),
      UNIQUE(allocation_plan_id, raw_material_id)
    );
    CREATE INDEX IF NOT EXISTS idx_allocation_plan_lines_v2_active_lot
      ON allocation_plan_lines_v2(raw_material_id, status);
    CREATE TABLE IF NOT EXISTS allocation_plan_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allocation_plan_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('reconciled', 'released')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      actor_id INTEGER,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (allocation_plan_id) REFERENCES allocation_plans_v2(id)
    );
    CREATE INDEX IF NOT EXISTS idx_allocation_plan_events_v2_plan
      ON allocation_plan_events_v2(allocation_plan_id, id);
  `);
  ensureColumn(db, 'allocation_plans_v2', 'spec_diameter', 'NUMERIC');
  ensureColumn(db, 'allocation_plans_v2', 'spec_material_type', 'TEXT');
}

function ensureMaterialConsumptionV2Schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS material_consumption_reports_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_uid TEXT NOT NULL UNIQUE,
      material_requirement_id INTEGER NOT NULL,
      requirement_uid TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      lifecycle_version INTEGER NOT NULL DEFAULT 2 CHECK (lifecycle_version=2),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cancelled','approved')),
      notes TEXT,
      created_by INTEGER,
      cancelled_by INTEGER,
      cancelled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_requirement_id) REFERENCES material_requirements_v2(id)
    );
    CREATE INDEX IF NOT EXISTS idx_material_consumption_reports_v2_requirement
      ON material_consumption_reports_v2(material_requirement_id, id);
    CREATE TABLE IF NOT EXISTS material_consumption_report_lines_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      allocation_plan_id INTEGER NOT NULL,
      allocation_plan_line_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL,
      consumed_kg NUMERIC NOT NULL CHECK (typeof(consumed_kg) IN ('integer','real') AND consumed_kg>0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES material_consumption_reports_v2(id),
      FOREIGN KEY (allocation_plan_id) REFERENCES allocation_plans_v2(id),
      FOREIGN KEY (allocation_plan_line_id) REFERENCES allocation_plan_lines_v2(id),
      FOREIGN KEY (raw_material_id) REFERENCES raw_material(id),
      UNIQUE(report_id, allocation_plan_line_id)
    );
    CREATE TABLE IF NOT EXISTS material_consumption_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL CHECK (event_type IN ('consumption','reversal')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      report_id INTEGER,
      original_event_id INTEGER,
      material_requirement_id INTEGER NOT NULL,
      requirement_uid TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      lifecycle_version INTEGER NOT NULL DEFAULT 2 CHECK (lifecycle_version=2),
      approved_by INTEGER NOT NULL,
      approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      FOREIGN KEY (report_id) REFERENCES material_consumption_reports_v2(id),
      FOREIGN KEY (original_event_id) REFERENCES material_consumption_events_v2(id),
      FOREIGN KEY (material_requirement_id) REFERENCES material_requirements_v2(id)
    );
    CREATE TABLE IF NOT EXISTS material_consumption_event_lines_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consumption_event_id INTEGER NOT NULL,
      original_event_line_id INTEGER,
      allocation_plan_id INTEGER NOT NULL,
      allocation_plan_line_id INTEGER NOT NULL,
      raw_material_id INTEGER NOT NULL,
      consumed_kg NUMERIC NOT NULL CHECK (typeof(consumed_kg) IN ('integer','real') AND consumed_kg>0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consumption_event_id) REFERENCES material_consumption_events_v2(id),
      FOREIGN KEY (original_event_line_id) REFERENCES material_consumption_event_lines_v2(id),
      FOREIGN KEY (allocation_plan_id) REFERENCES allocation_plans_v2(id),
      FOREIGN KEY (allocation_plan_line_id) REFERENCES allocation_plan_lines_v2(id),
      FOREIGN KEY (raw_material_id) REFERENCES raw_material(id)
    );
    CREATE INDEX IF NOT EXISTS idx_material_consumption_event_lines_v2_allocation
      ON material_consumption_event_lines_v2(allocation_plan_line_id, id);
    CREATE TABLE IF NOT EXISTS material_consumption_report_audit_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created','updated','cancelled','approved')),
      actor_id INTEGER,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES material_consumption_reports_v2(id)
    );
  `);
}

function ensurePendingRawMaterialReceiptV2Schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_raw_material_receipts_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_uid TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','cancelled')),
      source_type TEXT NOT NULL CHECK (source_type IN ('manual','ocr','purchase_order')),
      source_ref TEXT,
      supplier_id INTEGER,
      supplier_name TEXT,
      delivery_note_num TEXT,
      notes TEXT,
      created_by INTEGER,
      decided_by INTEGER,
      decision_notes TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pending_receipts_v2_status ON pending_raw_material_receipts_v2(status, id);
    CREATE TABLE IF NOT EXISTS pending_raw_material_receipt_lines_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      source_line_ref TEXT,
      material_type TEXT NOT NULL CHECK (material_type IN ('coil','straight','bent')),
      diameter NUMERIC NOT NULL,
      lot_number TEXT,
      certificate_num TEXT,
      grade TEXT DEFAULT 'B500B',
      standard_code TEXT,
      nominal_length_mm INTEGER,
      weight_received NUMERIC NOT NULL CHECK (typeof(weight_received) IN ('integer','real') AND weight_received > 0),
      purchase_price NUMERIC DEFAULT 0,
      warehouse_loc TEXT,
      bending_shape_name TEXT,
      bending_shape_segments TEXT,
      bending_shape_source TEXT,
      bending_shape_confidence REAL,
      notes TEXT,
      catalog_item_id INTEGER,
      spec_snapshot_json TEXT,
      spec_exceptions_json TEXT,
      created_raw_material_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES pending_raw_material_receipts_v2(id),
      FOREIGN KEY (created_raw_material_id) REFERENCES raw_material(id),
      UNIQUE(receipt_id, source_line_ref)
    );
    CREATE TABLE IF NOT EXISTS pending_raw_material_receipt_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','approved','rejected','cancelled')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      actor_id INTEGER,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES pending_raw_material_receipts_v2(id)
    );
  `);
  ensureColumn(db, 'pending_raw_material_receipt_lines_v2', 'catalog_item_id', 'INTEGER');
  ensureColumn(db, 'pending_raw_material_receipt_lines_v2', 'spec_snapshot_json', 'TEXT');
  ensureColumn(db, 'pending_raw_material_receipt_lines_v2', 'spec_exceptions_json', 'TEXT');
}

function ensureProcurementRecommendationV2Schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS procurement_recommendations_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_uid TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','cancelled')),
      freshness_status TEXT NOT NULL DEFAULT 'current' CHECK (freshness_status IN ('current','stale')),
      catalog_item_id INTEGER,
      spec_snapshot_json TEXT NOT NULL,
      spec_identity_status TEXT NOT NULL CHECK (spec_identity_status IN ('complete','partial','review_required')),
      recommended_kg NUMERIC NOT NULL CHECK (typeof(recommended_kg) IN ('integer','real') AND recommended_kg>0),
      coverage_snapshot_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      created_by INTEGER,
      approved_by INTEGER,
      decision_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id)
    );
    CREATE INDEX IF NOT EXISTS idx_procurement_recommendations_v2_status
      ON procurement_recommendations_v2(status, freshness_status, id);
    CREATE TABLE IF NOT EXISTS procurement_recommendation_requirement_links_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER NOT NULL,
      material_requirement_id INTEGER NOT NULL,
      requirement_uid TEXT NOT NULL,
      requirement_revision_snapshot TEXT,
      required_kg_snapshot NUMERIC NOT NULL,
      recommended_kg NUMERIC NOT NULL CHECK (typeof(recommended_kg) IN ('integer','real') AND recommended_kg>0),
      spec_snapshot_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recommendation_id) REFERENCES procurement_recommendations_v2(id),
      FOREIGN KEY (material_requirement_id) REFERENCES material_requirements_v2(id),
      UNIQUE(recommendation_id, material_requirement_id)
    );
    CREATE INDEX IF NOT EXISTS idx_procurement_recommendation_links_requirement
      ON procurement_recommendation_requirement_links_v2(material_requirement_id, id);
    CREATE TABLE IF NOT EXISTS procurement_recommendation_events_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','refreshed','approved','rejected','cancelled','stale_detected')),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      actor_id INTEGER,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recommendation_id) REFERENCES procurement_recommendations_v2(id)
    );
    CREATE INDEX IF NOT EXISTS idx_procurement_recommendation_events_v2_recommendation
      ON procurement_recommendation_events_v2(recommendation_id, id);
  `);
}

function ensureQuotationFoundationV1Schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quotation_sequences (
      prefix TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_uid TEXT NOT NULL UNIQUE,
      quotation_num TEXT UNIQUE,
      current_revision_number INTEGER NOT NULL DEFAULT 1 CHECK (current_revision_number > 0),
      lifecycle_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_status IN ('draft','issued','accepted','rejected','expired','cancelled')),
      customer_id INTEGER,
      prospect_display_name TEXT,
      project_id INTEGER,
      site_id INTEGER,
      owner_id INTEGER,
      created_by INTEGER,
      create_idempotency_key TEXT NOT NULL UNIQUE,
      create_payload_fingerprint TEXT NOT NULL,
      accepted_at TEXT,
      accepted_by INTEGER,
      rejected_at TEXT,
      rejected_by INTEGER,
      expired_at TEXT,
      expired_by INTEGER,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      cancellation_reason TEXT,
      archived_at TEXT,
      archived_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (site_id) REFERENCES customer_sites(id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_quotations_status
      ON customer_quotations(lifecycle_status, archived_at, id);
    CREATE INDEX IF NOT EXISTS idx_customer_quotations_customer
      ON customer_quotations(customer_id, id);

    CREATE TABLE IF NOT EXISTS customer_quotation_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_uid TEXT NOT NULL UNIQUE,
      quotation_id INTEGER NOT NULL,
      revision_number INTEGER NOT NULL CHECK (revision_number > 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
      customer_snapshot_json TEXT NOT NULL,
      project_site_snapshot_json TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'ILS' CHECK (length(currency_code) = 3),
      vat_rate NUMERIC NOT NULL DEFAULT 0.18
        CHECK (typeof(vat_rate) IN ('integer','real') AND vat_rate >= 0 AND vat_rate <= 1),
      subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(subtotal) IN ('integer','real') AND subtotal >= 0),
      discount_total NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(discount_total) IN ('integer','real') AND discount_total >= 0),
      vat_total NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(vat_total) IN ('integer','real') AND vat_total >= 0),
      grand_total NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(grand_total) IN ('integer','real') AND grand_total >= 0),
      validity_date TEXT,
      commercial_notes TEXT,
      pricing_snapshot_json TEXT NOT NULL DEFAULT '{}',
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      issued_payload_json TEXT,
      issued_payload_hash TEXT,
      issued_at TEXT,
      issued_by INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (quotation_id, revision_number),
      FOREIGN KEY (quotation_id) REFERENCES customer_quotations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_quotation_revisions_quote
      ON customer_quotation_revisions(quotation_id, revision_number);

    CREATE TABLE IF NOT EXISTS customer_quotation_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_id INTEGER NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      item_description TEXT NOT NULL,
      catalog_item_id INTEGER,
      product_master_id INTEGER,
      quantity NUMERIC NOT NULL CHECK (typeof(quantity) IN ('integer','real') AND quantity > 0),
      unit TEXT NOT NULL,
      pricing_quantity NUMERIC NOT NULL CHECK (typeof(pricing_quantity) IN ('integer','real') AND pricing_quantity >= 0),
      pricing_unit TEXT NOT NULL,
      unit_price NUMERIC NOT NULL CHECK (typeof(unit_price) IN ('integer','real') AND unit_price >= 0),
      discount_pct NUMERIC NOT NULL DEFAULT 0
        CHECK (typeof(discount_pct) IN ('integer','real') AND discount_pct >= 0 AND discount_pct <= 100),
      discount_amount NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(discount_amount) IN ('integer','real') AND discount_amount >= 0),
      line_subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(line_subtotal) IN ('integer','real') AND line_subtotal >= 0),
      vat_treatment TEXT NOT NULL DEFAULT 'standard'
        CHECK (vat_treatment IN ('standard','exempt','out_of_scope')),
      line_vat_amount NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(line_vat_amount) IN ('integer','real') AND line_vat_amount >= 0),
      line_total NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(line_total) IN ('integer','real') AND line_total >= 0),
      line_grand_total NUMERIC NOT NULL DEFAULT 0 CHECK (typeof(line_grand_total) IN ('integer','real') AND line_grand_total >= 0),
      calculated_unit_weight_kg NUMERIC,
      total_weight_kg NUMERIC,
      pricing_source TEXT,
      pricing_snapshot_json TEXT NOT NULL DEFAULT '{}',
      shape_snapshot_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (revision_id, sequence),
      FOREIGN KEY (revision_id) REFERENCES customer_quotation_revisions(id),
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id),
      FOREIGN KEY (product_master_id) REFERENCES product_masters(id)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_quotation_lines_revision
      ON customer_quotation_lines(revision_id, sequence);

    CREATE TABLE IF NOT EXISTS customer_quotation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uid TEXT NOT NULL UNIQUE,
      quotation_id INTEGER,
      quotation_uid TEXT NOT NULL,
      quotation_num TEXT,
      revision_id INTEGER,
      revision_number INTEGER,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'draft_created','draft_updated','issued','new_revision_created',
        'accepted','rejected','expired','cancelled','archived','unused_draft_deleted'
      )),
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_fingerprint TEXT NOT NULL,
      actor_id INTEGER,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_customer_quotation_events_quote
      ON customer_quotation_events(quotation_uid, id);

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_events_no_update
    BEFORE UPDATE ON customer_quotation_events
    BEGIN
      SELECT RAISE(ABORT, 'customer_quotation_events_append_only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_events_no_delete
    BEFORE DELETE ON customer_quotation_events
    BEGIN
      SELECT RAISE(ABORT, 'customer_quotation_events_append_only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_issued_revision_no_update
    BEFORE UPDATE ON customer_quotation_revisions
    WHEN OLD.status = 'issued'
    BEGIN
      SELECT RAISE(ABORT, 'issued_quotation_revision_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_issued_revision_no_delete
    BEFORE DELETE ON customer_quotation_revisions
    WHEN OLD.status = 'issued'
    BEGIN
      SELECT RAISE(ABORT, 'issued_quotation_revision_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_issued_line_no_insert
    BEFORE INSERT ON customer_quotation_lines
    WHEN (SELECT status FROM customer_quotation_revisions WHERE id = NEW.revision_id) = 'issued'
    BEGIN
      SELECT RAISE(ABORT, 'issued_quotation_revision_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_issued_line_no_update
    BEFORE UPDATE ON customer_quotation_lines
    WHEN (SELECT status FROM customer_quotation_revisions WHERE id = OLD.revision_id) = 'issued'
    BEGIN
      SELECT RAISE(ABORT, 'issued_quotation_revision_immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_quotation_issued_line_no_delete
    BEFORE DELETE ON customer_quotation_lines
    WHEN (SELECT status FROM customer_quotation_revisions WHERE id = OLD.revision_id) = 'issued'
    BEGIN
      SELECT RAISE(ABORT, 'issued_quotation_revision_immutable');
    END;
  `);
}

function ensureMaterialRequirementV2Schema(db) {
  ensureColumn(
    db,
    'orders',
    'inventory_lifecycle_version',
    'INTEGER NOT NULL DEFAULT 1 CHECK (inventory_lifecycle_version IN (1, 2))'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS material_requirements_v2 (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      requirement_uid   TEXT NOT NULL UNIQUE,
      order_id          INTEGER NOT NULL,
      item_id           INTEGER NOT NULL,
      lifecycle_version INTEGER NOT NULL DEFAULT 2 CHECK (lifecycle_version = 2),
      diameter          NUMERIC NOT NULL CHECK (typeof(diameter) IN ('integer', 'real') AND diameter > 0),
      material_type     TEXT NOT NULL CHECK (material_type IN ('coil', 'straight')),
      required_kg       NUMERIC NOT NULL CHECK (typeof(required_kg) IN ('integer', 'real') AND required_kg > 0),
      need_by_date      TEXT,
      need_by_source    TEXT NOT NULL CHECK (need_by_source IN ('manual_override', 'planned_production', 'order_delivery_date', 'unknown')),
      priority_snapshot TEXT,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'superseded')),
      source            TEXT NOT NULL CHECK (source IN ('order_item', 'manual', 'import')),
      source_revision   TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_material_requirements_v2_current_item
      ON material_requirements_v2(order_id, item_id)
      WHERE status = 'open';

    CREATE INDEX IF NOT EXISTS idx_material_requirements_v2_order
      ON material_requirements_v2(order_id, id);
  `);
}

function intakeSourceIdentityDuplicates(db) {
  return db.prepare(`
    SELECT source_system, external_id, COUNT(*) AS count
    FROM intake_log
    WHERE source_system IS NOT NULL AND source_system <> ''
      AND external_id IS NOT NULL AND external_id <> ''
    GROUP BY source_system, external_id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 5
  `).all();
}

function warnSkippedIntakeSourceIdentityIndex(reason, duplicates = []) {
  const sample = duplicates
    .map(row => `${row.source_system}/${row.external_id} (${row.count})`)
    .join(', ');
  console.warn(
    '[DB] Migration warning: intake_log source identity unique index was not created: ' +
    reason +
    (sample ? `. Duplicate sample: ${sample}` : '')
  );
}

function ensureIntakeSourceIdentityIndex(db) {
  ensureColumn(db, 'intake_log', 'source_system', 'TEXT');
  ensureColumn(db, 'intake_log', 'external_id', 'TEXT');
  const duplicates = intakeSourceIdentityDuplicates(db);
  if (duplicates.length) {
    warnSkippedIntakeSourceIdentityIndex('existing duplicate source_system/external_id values must be reviewed first', duplicates);
    return;
  }
  const sql = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_log_source_identity
      ON intake_log(source_system, external_id)
      WHERE source_system IS NOT NULL AND external_id IS NOT NULL;
  `;
  try {
    db.exec(sql);
  } catch (error) {
    const currentDuplicates = intakeSourceIdentityDuplicates(db);
    if (/UNIQUE constraint failed|constraint failed/i.test(String(error.message || '')) && currentDuplicates.length) {
      warnSkippedIntakeSourceIdentityIndex(error.message, currentDuplicates);
      return;
    }
    throw error;
  }
}
function ensureCoreSchema(db) {
  // ── SCHEMA ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      tax_id TEXT,
      payment_terms TEXT,
      portal_price_list_visibility TEXT DEFAULT 'none',
      portal_can_manage_users INTEGER DEFAULT 0,
      portal_can_create_sites INTEGER DEFAULT 0,
      portal_can_set_budgets INTEGER DEFAULT 0,
      portal_can_expose_prices INTEGER DEFAULT 0,
      contact_name TEXT,
      contact_phone TEXT,
      priority_id TEXT,
      notes TEXT,
      portal_profile_locked_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_portal_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS customer_guarantee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      portal_user_id INTEGER,
      original_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      data_url TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'uploaded_pending_review',
      notes TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS customer_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      status TEXT DEFAULT 'active',
      manager_name TEXT,
      manager_phone TEXT,
      budget_amount REAL DEFAULT 0,
      budget_kg REAL DEFAULT 0,
      alert_pct REAL DEFAULT 80,
      block_over_budget INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS portal_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('orderer','approver','both','finance','field_manager','customer_admin')),
      active INTEGER NOT NULL DEFAULT 1,
      token TEXT,
      token_expires_at TEXT,
      password_hash TEXT,
      password_changed_at TEXT,
      can_manage_users INTEGER DEFAULT 0,
      can_create_sites INTEGER DEFAULT 0,
      can_assign_site_users INTEGER DEFAULT 0,
      can_create_orders INTEGER DEFAULT 1,
      can_approve_orders INTEGER DEFAULT 0,
      can_view_prices INTEGER DEFAULT 0,
      can_view_budget INTEGER DEFAULT 0,
      can_set_budget INTEGER DEFAULT 0,
      can_approve_budget_overrun INTEGER DEFAULT 0,
      can_view_invoices INTEGER DEFAULT 0,
      can_view_delivery_notes INTEGER DEFAULT 1,
      can_view_payment_alerts INTEGER DEFAULT 0,
      default_site_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (default_site_id) REFERENCES customer_sites(id)
    );

    CREATE TABLE IF NOT EXISTS customer_site_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      site_id INTEGER NOT NULL,
      portal_user_id INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(site_id, portal_user_id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (site_id) REFERENCES customer_sites(id),
      FOREIGN KEY (portal_user_id) REFERENCES portal_users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_portal_permission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      actor_portal_user_id INTEGER,
      target_portal_user_id INTEGER,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (actor_portal_user_id) REFERENCES portal_users(id),
      FOREIGN KEY (target_portal_user_id) REFERENCES portal_users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_profile_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      portal_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      current_json TEXT,
      requested_json TEXT NOT NULL,
      notes TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (portal_user_id) REFERENCES portal_users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_num TEXT UNIQUE NOT NULL,
      stable_order_id TEXT,
      customer_id INTEGER,
      channel TEXT DEFAULT 'טלפון',
      delivery_date TEXT,
      delivery_time TEXT,
      delivery_address TEXT,
      priority TEXT DEFAULT 'רגיל',
      status TEXT DEFAULT 'ממתינה לאישור',
      total_weight REAL DEFAULT 0,
      waste_pct_charged REAL DEFAULT 3,
      billing_weight REAL DEFAULT 0,
      driver_notes TEXT,
      general_notes TEXT,
      priority_order_id TEXT,
      inventory_lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (inventory_lifecycle_version IN (1, 2)),
      created_by INTEGER,
      approved_by INTEGER,
      approved_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_sequences (
      prefix TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      pallet_num INTEGER,
      max_weight REAL DEFAULT 500,
      total_weight REAL DEFAULT 0,
      status TEXT DEFAULT 'ממתין',
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pallet_id INTEGER,
      order_id INTEGER,
      item_uid TEXT,
      shape_snapshot_json TEXT,
      shape_id TEXT,
      shape_name TEXT,
      diameter REAL,
      spiral_diameter_mm REAL,
      spiral_turns REAL,
      segments JSON,
      total_length_mm REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      production_qty INTEGER DEFAULT 0,
      weight_per_unit REAL DEFAULT 0,
      total_weight REAL DEFAULT 0,
      struct_element TEXT,
      struct_floor TEXT,
      sheet_num TEXT,
      machine TEXT,
      status TEXT DEFAULT 'ממתין',
      started_at DATETIME,
      completed_at DATETIME,
      worker_id INTEGER,
      produced_qty INTEGER DEFAULT 0,
      actual_waste INTEGER DEFAULT 0,
      actual_weight_kg REAL,
      weight_deviation_pct REAL,
      review_status TEXT,
      review_notes TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      note TEXT,
      FOREIGN KEY (pallet_id) REFERENCES pallets(id)
    );

    CREATE TABLE IF NOT EXISTS production_card_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      card_index INTEGER NOT NULL,
      card_total INTEGER NOT NULL DEFAULT 1,
      card_qty INTEGER DEFAULT 0,
      target_weight_kg REAL DEFAULT 0,
      actual_weight_kg REAL NOT NULL,
      weight_deviation_pct REAL,
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(item_id, card_index, card_total),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    CREATE TABLE IF NOT EXISTS machines (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      label TEXT,
      port TEXT,
      slave_id INTEGER DEFAULT 1,
      min_diameter REAL DEFAULT 8,
      max_diameter REAL DEFAULT 12,
      single_min_diameter REAL DEFAULT 8,
      single_max_diameter REAL DEFAULT 32,
      double_min_diameter REAL DEFAULT 8,
      double_max_diameter REAL DEFAULT 16,
      status TEXT DEFAULT 'לא מחובר',
      current_order_num TEXT,
      current_item_id INTEGER,
      counter INTEGER DEFAULT 0,
      last_seen DATETIME
    );

    CREATE TABLE IF NOT EXISTS shapes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bends INTEGER DEFAULT 0,
      sides_default JSON,
      angles_default JSON,
      emoji TEXT DEFAULT '⬡',
      description TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'ייצור',
      language TEXT DEFAULT 'he',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id INTEGER,
      worker_id INTEGER,
      item_id INTEGER,
      order_num TEXT,
      action TEXT,
      counter_at_scan INTEGER DEFAULT 0,
      waste_calculated INTEGER DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      active INTEGER DEFAULT 1,
      current_lat REAL,
      current_lng REAL,
      last_location_update DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_desc TEXT,
      license_plate TEXT UNIQUE,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_year INTEGER,
      test_expiry TEXT,
      insurance_expiry TEXT,
      next_service_date TEXT,
      next_service_km INTEGER,
      odometer_km INTEGER DEFAULT 0,
      vehicle_status TEXT DEFAULT 'active',
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vehicle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER,
      vehicle_id INTEGER,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      odometer_km INTEGER,
      amount REAL DEFAULT 0,
      vendor TEXT,
      reference TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      document_type TEXT NOT NULL,
      title TEXT,
      file_name TEXT,
      mime_type TEXT,
      data_url TEXT,
      expiry_date TEXT,
      notes TEXT,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      driver_id INTEGER,
      scheduled_date TEXT,
      status TEXT DEFAULT 'ממתין',
      departed_at DATETIME,
      delivered_at DATETIME,
      signature_data TEXT,
      photo_url TEXT,
      notes TEXT,
      problem_type TEXT,
      problem_notes TEXT,
      delivery_lat REAL,
      delivery_lng REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      level TEXT DEFAULT 'warning',
      message TEXT,
      order_id INTEGER,
      machine_id INTEGER,
      resolved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intake_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      source_system TEXT,
      external_id TEXT,
      raw_content TEXT,
      parsed_data JSON,
      original_filename TEXT,
      original_mime TEXT,
      original_data_url TEXT,
      order_id INTEGER,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intake_training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      document_type TEXT DEFAULT 'general',
      problem_text TEXT NOT NULL,
      correction_text TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS external_shape_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_system TEXT NOT NULL,
      external_code TEXT NOT NULL,
      label TEXT,
      shape_type TEXT NOT NULL,
      internal_shape_code TEXT NOT NULL,
      parameter_mapping TEXT DEFAULT '{}',
      confidence TEXT DEFAULT 'learned',
      created_by TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_system, external_code)
    );

    CREATE TABLE IF NOT EXISTS inventory_receipt_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT DEFAULT 'supplier_delivery_note',
      original_filename TEXT,
      original_mime TEXT,
      original_data_url TEXT,
      supplier_id INTEGER,
      supplier_name TEXT,
      delivery_note_num TEXT,
      parsed_data JSON,
      status TEXT DEFAULT 'pending_review',
      raw_material_ids TEXT,
      reviewed_by INTEGER,
      review_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS companies (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      ownership_pct REAL DEFAULT 100,
      erp_type TEXT DEFAULT 'none',
      color TEXT DEFAULT '#e07b39',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── RAW MATERIAL INVENTORY ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS suppliers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      phone       TEXT,
      contact     TEXT,
      email       TEXT,
      address     TEXT,
      payment_terms TEXT,
      notes       TEXT,
      active      INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS raw_material (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      material_type   TEXT DEFAULT 'coil',  -- 'coil' | 'straight' | 'bent'
      diameter        INTEGER NOT NULL,
      catalog_item_id INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'approved' CHECK (verification_status IN ('approved','pending_verification','rejected')),
      supplier_id     INTEGER,
      lot_number      TEXT,
      certificate_num TEXT,
      grade           TEXT DEFAULT 'B500B', -- steel grade
      standard_code   TEXT,
      nominal_length_mm INTEGER,
      spec_exception  INTEGER NOT NULL DEFAULT 0,
      received_date   TEXT,
      weight_received REAL DEFAULT 0,       -- kg received
      weight_used     REAL DEFAULT 0,       -- kg consumed so far
      weight_scrapped REAL DEFAULT 0,       -- kg scrapped/waste
      purchase_price  REAL DEFAULT 0,       -- ₪/ton
      warehouse_loc   TEXT,                 -- e.g. "מדף A3"
      bending_shape_name TEXT,
      bending_shape_segments TEXT,
      bending_shape_source TEXT,
      bending_shape_confidence REAL,
      notes           TEXT,
      active          INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id)
    );

    CREATE TABLE IF NOT EXISTS product_masters (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      master_code     TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT '',
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS catalog_items (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      sku                   TEXT NOT NULL UNIQUE,
      product_master_id     INTEGER REFERENCES product_masters(id),
      item_kind             TEXT NOT NULL CHECK (item_kind IN ('raw_material','finished_product')),
      name                  TEXT NOT NULL,
      category              TEXT NOT NULL DEFAULT '',
      supply_form           TEXT CHECK (supply_form IN ('coil','straight','bent')),
      diameter_key          TEXT,
      steel_grade           TEXT,
      standard_code         TEXT,
      nominal_length_mm     INTEGER,
      nominal_kg_per_meter  NUMERIC,
      nominal_unit_weight_kg NUMERIC,
      active                INTEGER NOT NULL DEFAULT 1,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS diameter_catalog (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      diameter_key     TEXT NOT NULL UNIQUE,
      diameter_display TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('active','inactive','pending_approval','rejected')),
      source           TEXT NOT NULL DEFAULT 'manual',
      created_by       INTEGER,
      approved_by      INTEGER,
      approved_at      DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS raw_material_usage (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_material_id INTEGER,
      order_id        INTEGER,
      item_id         INTEGER,
      weight_used     REAL DEFAULT 0,
      allocation_policy TEXT,
      used_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (raw_material_id) REFERENCES raw_material(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_reservations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id        INTEGER NOT NULL,
      item_id         INTEGER,
      diameter        NUMERIC,
      material_type   TEXT,
      reserved_kg     NUMERIC DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'consumed')),
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    -- ── AUDIT LOG ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,  -- 'order' | 'item' | 'customer' | 'delivery' etc.
      entity_id   INTEGER,
      entity_ref  TEXT,           -- e.g. order_num
      action      TEXT NOT NULL,  -- 'status_change' | 'create' | 'update' | 'delete'
      field_name  TEXT,           -- which field changed
      old_value   TEXT,
      new_value   TEXT,
      user_id     INTEGER,
      user_name   TEXT,
      notes       TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── USERS / ROLES ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role        TEXT DEFAULT 'operator',  -- 'admin' | 'manager' | 'operator' | 'driver' | 'quality'
      pin         TEXT,                     -- 4-digit PIN for tablet login
      phone       TEXT,
      active      INTEGER DEFAULT 1,
      last_login  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── QUALITY CONTROL ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS quality_checks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id       INTEGER,
      order_id      INTEGER,
      order_num     TEXT,
      inspector_id  INTEGER,
      check_type    TEXT DEFAULT 'length',  -- 'length' | 'angle' | 'visual' | 'full'
      sample_qty    INTEGER DEFAULT 1,
      pass_qty      INTEGER DEFAULT 0,
      fail_qty      INTEGER DEFAULT 0,
      deviation_mm  REAL DEFAULT 0,
      deviation_deg REAL DEFAULT 0,
      result        TEXT DEFAULT 'pass',    -- 'pass' | 'fail' | 'conditional'
      action_taken  TEXT,                   -- 'accepted' | 'rejected' | 'rework'
      photo_url     TEXT,
      notes         TEXT,
      checked_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id)
    );

    -- ── MAINTENANCE ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id    INTEGER,
      log_type      TEXT DEFAULT 'breakdown',  -- 'breakdown' | 'preventive' | 'repair' | 'inspection'
      description   TEXT,
      reported_by   INTEGER,
      assigned_to   INTEGER,
      status        TEXT DEFAULT 'פתוחה',  -- 'פתוחה' | 'בטיפול' | 'סגורה'
      priority      TEXT DEFAULT 'רגיל',   -- 'דחוף' | 'גבוה' | 'רגיל' | 'נמוך'
      downtime_min  INTEGER DEFAULT 0,      -- minutes machine was down
      root_cause    TEXT,
      fix_notes     TEXT,
      parts_used    TEXT,
      cost          REAL DEFAULT 0,
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at   DATETIME,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── PROJECTS & SITES ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER,
      name          TEXT NOT NULL,
      project_num   TEXT,           -- internal project number
      status        TEXT DEFAULT 'פעיל',   -- 'פעיל' | 'הושלם' | 'עצור' | 'ביטול'
      start_date    TEXT,
      end_date      TEXT,
      total_budget  REAL DEFAULT 0,
      contact_name  TEXT,
      contact_phone TEXT,
      notes         TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER,
      customer_id   INTEGER,
      name          TEXT NOT NULL,
      address       TEXT,
      lat           REAL,
      lng           REAL,
      contact_name  TEXT,
      contact_phone TEXT,
      access_notes  TEXT,
      active        INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── CREDIT ACCOUNTS ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS credit_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER UNIQUE,
      credit_limit  REAL DEFAULT 0,         -- ₪ max outstanding
      current_debt  REAL DEFAULT 0,         -- ₪ current open balance
      payment_terms INTEGER DEFAULT 30,     -- days (net 30, net 60 etc)
      blocked       INTEGER DEFAULT 0,      -- 1 = blocked from new orders
      block_reason  TEXT,
      last_payment  TEXT,
      notes         TEXT,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id   INTEGER,
      order_id      INTEGER,
      type          TEXT,   -- 'charge' | 'payment' | 'credit_note'
      amount        REAL DEFAULT 0,
      description   TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── SHIFTS & OPERATORS ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS shifts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_type    TEXT DEFAULT 'morning',  -- 'morning'|'afternoon'|'night'
      date          TEXT NOT NULL,           -- YYYY-MM-DD
      operator_id   INTEGER,                 -- users.id
      machine_id    INTEGER,
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at      DATETIME,
      total_pieces  INTEGER DEFAULT 0,
      total_weight  REAL DEFAULT 0,
      notes         TEXT,
      FOREIGN KEY (operator_id) REFERENCES users(id),
      FOREIGN KEY (machine_id)  REFERENCES machines(id)
    );

    CREATE TABLE IF NOT EXISTS downtime_reasons (
      code  TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      color TEXT DEFAULT '#888'
    );

    CREATE TABLE IF NOT EXISTS machine_stops (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id    INTEGER,
      shift_id      INTEGER,
      reason_code   TEXT,   -- FK to downtime_reasons.code
      started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at      DATETIME,
      duration_min  INTEGER DEFAULT 0,
      notes         TEXT,
      reported_by   INTEGER,
      FOREIGN KEY (machine_id) REFERENCES machines(id),
      FOREIGN KEY (shift_id)   REFERENCES shifts(id)
    );

    -- ── STEEL PRICE HISTORY ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS steel_price_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      diameter      INTEGER NOT NULL,
      price_per_ton REAL NOT NULL,      -- ₪ per ton (purchase price)
      supplier_id   INTEGER,
      effective_date TEXT NOT NULL,     -- YYYY-MM-DD
      notes         TEXT,
      created_by    INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    -- ── PACKAGES (physical bundles with QR) ────────────────────────
    CREATE TABLE IF NOT EXISTS packages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      package_code  TEXT UNIQUE,        -- human-readable PKG-YYYYMMDD-NNN
      qr_data       TEXT,               -- JSON or URL for QR scan
      order_id      INTEGER,
      order_num     TEXT,
      item_ids      JSON,               -- array of item IDs in package
      quantity      INTEGER DEFAULT 0,
      weight        REAL DEFAULT 0,
      diameter      REAL,
      zone          TEXT,               -- warehouse zone e.g. "A3"
      status        TEXT DEFAULT 'packed', -- 'packed'|'staged'|'shipped'
      packed_by     INTEGER,
      packed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      shipped_at    DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- ── INVOICES (Israeli standard, כרך ט) ───────────────────────
    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_num      TEXT UNIQUE,      -- חשבונית מס' (sequential)
      invoice_type     TEXT DEFAULT 'tax_invoice', -- 'tax_invoice'|'receipt'|'credit_note'|'proforma'
      order_id         INTEGER,
      order_num        TEXT,
      customer_id      INTEGER,
      customer_name    TEXT,
      customer_vat_id  TEXT,             -- ח.פ / ע.מ
      issue_date       TEXT,             -- YYYY-MM-DD
      due_date         TEXT,
      items_json       JSON,             -- line items snapshot
      subtotal         REAL DEFAULT 0,   -- סכום לפני מע"מ
      vat_rate         REAL DEFAULT 0.18,-- 18%
      vat_amount       REAL DEFAULT 0,
      total            REAL DEFAULT 0,   -- סה"כ כולל מע"מ
      paid_amount      REAL DEFAULT 0,
      status           TEXT DEFAULT 'פתוחה', -- 'פתוחה'|'שולמה'|'חלקית'|'ביטול'
      payment_method   TEXT,             -- 'העברה'|'שיק'|'מזומן'|'אשראי'
      payment_ref      TEXT,
      notes            TEXT,
      created_by       INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- ── DELIVERY NOTES ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS delivery_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      note_num      TEXT UNIQUE,        -- DN-YYYYMMDD-NNN
      order_id      INTEGER,
      order_num     TEXT,
      delivery_id   INTEGER,
      customer_id   INTEGER,
      packages_json JSON,               -- snapshot of packages
      items_json    JSON,               -- snapshot of items
      total_weight  REAL DEFAULT 0,
      driver_id     INTEGER,
      signed_by     TEXT,
      signature_data TEXT,
      issued_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at  DATETIME,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS export_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      destination   TEXT DEFAULT 'generic',
      entity_type   TEXT,
      entity_id     INTEGER,
      export_format TEXT,
      payload_json  TEXT,
      status        TEXT,
      external_ref  TEXT,
      error_message TEXT,
      exported_by   INTEGER,
      exported_at   DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── PRODUCTION EVENTS ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS production_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type    TEXT NOT NULL,  -- 'MachineStarted'|'MachineStopped'|'ItemComplete'|'ScrapExceeded'|'QualityFailed'|'InventoryLow'
      machine_id    INTEGER,
      item_id       INTEGER,
      order_num     TEXT,
      operator_id   INTEGER,
      shift_id      INTEGER,
      payload       JSON,           -- extra data specific to event type
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── MACHINE STATE LOG ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS machine_state_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id  INTEGER NOT NULL,
      from_state  TEXT,
      to_state    TEXT NOT NULL,
      reason      TEXT,
      operator_id INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── INCIDENTS / WAR ROOM ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS incidents (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      title            TEXT NOT NULL,
      machine_id       INTEGER,
      severity         TEXT DEFAULT 'בינוני',
      description      TEXT,
      assigned_to      TEXT,
      status           TEXT DEFAULT 'פתוח',
      financial_impact REAL DEFAULT 0,
      timeline         JSON DEFAULT '[]',
      opened_by        TEXT,
      resolved_at      DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── NCR – Non-Conformance Reports ─────────────────────────────
    CREATE TABLE IF NOT EXISTS ncr (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ncr_num           TEXT UNIQUE,
      order_id          INTEGER,
      order_num         TEXT,
      machine_id        INTEGER,
      description       TEXT NOT NULL,
      severity          TEXT DEFAULT 'בינוני',
      root_cause        TEXT,
      disposition       TEXT,
      quantity_affected INTEGER DEFAULT 0,
      diameter          REAL,
      assigned_to       TEXT,
      status            TEXT DEFAULT 'פתוח',
      closed_by         TEXT,
      closed_at         DATETIME,
      notes             TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── CAPA – Corrective & Preventive Actions ─────────────────────
    CREATE TABLE IF NOT EXISTS capa (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      capa_num            TEXT UNIQUE,
      ncr_id              INTEGER,
      title               TEXT NOT NULL,
      type                TEXT DEFAULT 'מתקן',
      problem_description TEXT,
      root_cause          TEXT,
      actions             JSON DEFAULT '[]',
      owner               TEXT,
      due_date            TEXT,
      verification_method TEXT,
      status              TEXT DEFAULT 'פתוח',
      completion_pct      INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ncr_id) REFERENCES ncr(id)
    );

    -- ── LOTO – Lockout / Tagout ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS loto (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id       INTEGER NOT NULL,
      locked_by        TEXT NOT NULL,
      reason           TEXT,
      reason_detail    TEXT,
      safety_notes     TEXT,
      status           TEXT DEFAULT 'פעיל',
      released_by      TEXT,
      release_confirmed INTEGER DEFAULT 0,
      release_notes    TEXT,
      released_at      DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (machine_id) REFERENCES machines(id)
    );

    -- ── PREVENTIVE MAINTENANCE SCHEDULE ───────────────────────────
    CREATE TABLE IF NOT EXISTS pm_schedule (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      machine_id  INTEGER NOT NULL,
      pm_type     TEXT NOT NULL,
      frequency   TEXT DEFAULT 'חודשי',
      last_done   TEXT,
      next_due    TEXT,
      instructions TEXT,
      active      INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── PURCHASE ORDERS ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      po_num          TEXT UNIQUE,
      supplier_id     INTEGER,
      diameter        INTEGER,
      material_type   TEXT DEFAULT 'coil',
      quantity_ton    REAL,
      price_per_ton   REAL,
      total_amount    REAL,
      expected_date   TEXT,
      status          TEXT DEFAULT 'טיוטה',
      notes           TEXT,
      received_weight REAL,
      heat_number     TEXT,
      certificate_num TEXT,
      received_at     DATETIME,
      created_by      TEXT,
      approved_by     TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
  `);

  ensureIntakeSourceIdentityIndex(db);

  ensureMaterialRequirementV2Schema(db);
  ensureMaterialAllocationPlanningV2Schema(db);
  ensureMaterialConsumptionV2Schema(db);
  ensurePendingRawMaterialReceiptV2Schema(db);
  ensureProcurementRecommendationV2Schema(db);
  ensureQuotationFoundationV1Schema(db);

  // price_category: how this item is billed in the price book
  // 'straight_standard' = bar at 6m/12m (material only)
  // 'straight_cut'      = straight bar cut to custom length (material + cutting)
  // 'bent'              = has bends (material + cutting + bending)
  // 'per_unit'          = stirrups, chairs, birds — charged per piece
  ensureColumn(db, 'items', 'price_category', "TEXT DEFAULT 'auto'");

  ensureFinanceSchema(db);
}

module.exports = {
  ensureCoreSchema,
  ensureMaterialRequirementV2Schema,
  ensureMaterialAllocationPlanningV2Schema,
  ensureMaterialConsumptionV2Schema,
  ensurePendingRawMaterialReceiptV2Schema,
  ensureProcurementRecommendationV2Schema,
  ensureQuotationFoundationV1Schema,
};
