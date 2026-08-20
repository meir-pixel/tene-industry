'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { ensureCoreSchema } = require('../../../db/coreSchema');
const { runCoreMigrations } = require('../../../db/startup');
const { seedCoreData } = require('../../../db/seed');
const { ensureAuthSchema } = require('../../../auth-core');
const { buildPortalShapeDraft } = require('../../../services/customerPortalShapeDraft');
const { buildOrderItemUid } = require('../../../services/orderContracts');

const DB_PATH = process.env.E2E_DB_PATH;
const MANIFEST_PATH = process.env.E2E_SEED_MANIFEST;
const PASSWORD = 'Portal123!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, '$2b$04$abcdefghijklmnopqrstuu');
const FUTURE = '2099-12-31T23:59:59.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

const TOKENS = Object.freeze({
  alphaOrderer: 'e2ealphaorderer001',
  alphaApprover: 'e2ealphaapprover01',
  alphaBoth: 'e2ealphabothuser001',
  alphaFinance: 'e2ealphafinance001',
  alphaFieldManager: 'e2ealphafieldmgr01',
  alphaAdmin: 'e2ealphaadminuser01',
  betaOrderer: 'e2ebetaorderer0001',
  betaApprover: 'e2ebetaapprover001',
  expired: 'e2eexpiredtoken0001',
});

if (!DB_PATH) throw new Error('E2E_DB_PATH is required');
if (fs.existsSync(DB_PATH)) throw new Error(`Refusing to seed an existing E2E database: ${DB_PATH}`);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function insertCustomer(data) {
  const result = db.prepare(`
    INSERT INTO customers
      (name,phone,email,address,tax_id,payment_terms,portal_price_list_visibility,
       portal_can_manage_users,portal_can_create_sites,portal_can_set_budgets,portal_can_expose_prices,
       price_tier,discount_pct,portal_token,portal_token_created_at,portal_token_expires_at)
    VALUES
      (@name,@phone,@email,@address,@taxId,@paymentTerms,@visibility,
       @canManageUsers,@canCreateSites,@canSetBudgets,@canExposePrices,
       @priceTier,@discountPct,@legacyToken,'2026-08-01T00:00:00.000Z',@tokenExpiresAt)
  `).run(data);
  return Number(result.lastInsertRowid);
}

function insertSite(customerId, name, address, city) {
  return Number(db.prepare(`
    INSERT INTO customer_sites
      (customer_id,name,address,city,status,manager_name,manager_phone,budget_amount,budget_kg,alert_pct,block_over_budget)
    VALUES (?,?,?,?, 'active','מנהל בדיקות','0500000000',250000,50000,80,0)
  `).run(customerId, name, address, city).lastInsertRowid);
}

function insertPortalUser({ customerId, phone, name, role, token, expiresAt = FUTURE, defaultSiteId, flags = {} }) {
  return Number(db.prepare(`
    INSERT INTO portal_users
      (customer_id,phone,name,email,role,active,token,token_expires_at,password_hash,password_changed_at,
       can_manage_users,can_create_sites,can_assign_site_users,can_create_orders,can_approve_orders,
       can_view_prices,can_view_budget,can_set_budget,can_approve_budget_overrun,can_view_invoices,
       can_view_delivery_notes,can_view_payment_alerts,default_site_id,updated_at)
    VALUES
      (@customerId,@phone,@name,@email,@role,1,@token,@expiresAt,@passwordHash,'2026-08-01T00:00:00.000Z',
       @canManageUsers,@canCreateSites,@canAssignSiteUsers,@canCreateOrders,@canApproveOrders,
       @canViewPrices,@canViewBudget,@canSetBudget,@canApproveBudgetOverrun,@canViewInvoices,
       @canViewDeliveryNotes,@canViewPaymentAlerts,@defaultSiteId,'2026-08-01T00:00:00.000Z')
  `).run({
    customerId,
    phone,
    name,
    email: `${phone}@portal-e2e.invalid`,
    role,
    token,
    expiresAt,
    passwordHash: PASSWORD_HASH,
    canManageUsers: flags.canManageUsers ? 1 : 0,
    canCreateSites: flags.canCreateSites ? 1 : 0,
    canAssignSiteUsers: flags.canAssignSiteUsers ? 1 : 0,
    canCreateOrders: flags.canCreateOrders === false ? 0 : 1,
    canApproveOrders: flags.canApproveOrders ? 1 : 0,
    canViewPrices: flags.canViewPrices ? 1 : 0,
    canViewBudget: flags.canViewBudget ? 1 : 0,
    canSetBudget: flags.canSetBudget ? 1 : 0,
    canApproveBudgetOverrun: flags.canApproveBudgetOverrun ? 1 : 0,
    canViewInvoices: flags.canViewInvoices ? 1 : 0,
    canViewDeliveryNotes: flags.canViewDeliveryNotes === false ? 0 : 1,
    canViewPaymentAlerts: flags.canViewPaymentAlerts ? 1 : 0,
    defaultSiteId,
  }).lastInsertRowid);
}

function assignSites(customerId, portalUserId, siteIds, defaultSiteId) {
  const insert = db.prepare(`
    INSERT INTO customer_site_users (customer_id,site_id,portal_user_id,is_default)
    VALUES (?,?,?,?)
  `);
  for (const siteId of siteIds) insert.run(customerId, siteId, portalUserId, siteId === defaultSiteId ? 1 : 0);
}

function seedPriceBook({ code, name, customerId = null, priceType, prices }) {
  const priceBookId = Number(db.prepare(`
    INSERT INTO pricing_price_books
      (code,name,customer_id,customer_name,price_type,currency,status,source_type,source_ref,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,'ILS','active','e2e-seed','PORTAL-R0','Deterministic browser-test price book','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')
  `).run(code, name, customerId, customerId ? name : '', priceType).lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO pricing_price_items
      (price_book_id,sku,diameter,category,description,quantity,unit,price_before_vat,currency,active,sort_order)
    VALUES (?,?,?,'rebar',?,1,'kg',?,'ILS',1,?)
  `);
  Object.entries(prices).forEach(([diameter, price], index) => {
    insert.run(priceBookId, `D${diameter}`, Number(diameter), `ברזל בניין ${diameter} מ״מ`, price, index + 1);
  });
  return priceBookId;
}

function seedOrder({ orderNum, customerId, siteId, status, portalPrice = 187.5, confirmToken = null, createdAt }) {
  const shape = buildPortalShapeDraft({
    shapeId: 's2',
    shapeName: 'קורת בדיקה',
    diameter: 12,
    qty: 50,
    note: 'קיר צפוני קומה 2',
    shapeDraft: {
      family: 'bars',
      shapeType: 'l_bar',
      data: { sides: [1200, 400], angles: [90] },
    },
  });
  const totalWeight = Number(shape.totalWeight.toFixed(3));
  const billingWeight = Number((totalWeight * 1.03).toFixed(3));
  const result = db.prepare(`
    INSERT INTO orders
      (order_num,stable_order_id,customer_id,channel,delivery_date,delivery_time,delivery_address,priority,status,
       total_weight,waste_pct_charged,billing_weight,general_notes,portal_order,portal_price,confirm_token,site_id,created_at)
    VALUES
      (?,?,?,'פורטל לקוח','2026-08-28','09:00','רחוב הבדיקה 12, תל אביב איסוף עצמי','רגיל',?,
       ?,3,?,'PORTAL-R0 deterministic seeded order',1,?,?,?,?)
  `).run(orderNum, orderNum, customerId, status, totalWeight, billingWeight, portalPrice, confirmToken, siteId, createdAt);
  const orderId = Number(result.lastInsertRowid);
  const palletId = Number(db.prepare(`
    INSERT INTO pallets (order_id,pallet_num,max_weight,total_weight,status)
    VALUES (?,1,9999,?,'ממתין')
  `).run(orderId, totalWeight).lastInsertRowid);
  const itemResult = db.prepare(`
    INSERT INTO items
      (pallet_id,order_id,shape_snapshot_json,shape_id,shape_name,diameter,segments,total_length_mm,
       quantity,weight_per_unit,total_weight,struct_element,status,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    palletId,
    orderId,
    shape.shapeSnapshotJson,
    shape.shapeId,
    shape.shapeName,
    shape.diameter,
    shape.segmentsJson,
    shape.totalLengthMm,
    shape.quantity,
    shape.weightPerUnit,
    shape.totalWeight,
    shape.elementName,
    status === 'בייצור' ? 'בייצור' : 'ממתין',
    shape.note
  );
  const itemId = Number(itemResult.lastInsertRowid);
  db.prepare('UPDATE items SET item_uid=? WHERE id=?').run(buildOrderItemUid(orderId, itemId), itemId);
  return { orderId, itemId, orderNum, status };
}

let manifest;
try {
  ensureCoreSchema(db);
  runCoreMigrations(db);
  ensureAuthSchema(db);
  seedCoreData(db);

  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_plan','free')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('WASTE_PCT_DEFAULT','3')").run();

  const alphaId = insertCustomer({
    name: 'אלפא בנייה – לקוח מרובה אתרים', phone: '0501000000', email: 'alpha@example.invalid',
    address: 'דרך הפלדה 1, תל אביב', taxId: '510000001', paymentTerms: 'שוטף + 30', visibility: 'customer',
    canManageUsers: 1, canCreateSites: 1, canSetBudgets: 1, canExposePrices: 1,
    priceTier: 'customer', discountPct: 5, legacyToken: 'e2ealphalegacy0001', tokenExpiresAt: FUTURE,
  });
  const betaId = insertCustomer({
    name: 'בטא תשתיות – לקוח אתר יחיד', phone: '0502000000', email: 'beta@example.invalid',
    address: 'דרך הבטון 2, חיפה', taxId: '510000002', paymentTerms: 'מזומן', visibility: 'none',
    canManageUsers: 0, canCreateSites: 0, canSetBudgets: 0, canExposePrices: 0,
    priceTier: 'list', discountPct: 0, legacyToken: 'e2ebetalegacy00001', tokenExpiresAt: FUTURE,
  });

  const alphaNorth = insertSite(alphaId, 'אלפא – מגדל צפון', 'היצירה 10', 'תל אביב');
  const alphaSouth = insertSite(alphaId, 'אלפא – מגדל דרום', 'היצירה 12', 'תל אביב');
  const betaOnly = insertSite(betaId, 'בטא – אתר יחיד', 'הנמל 4', 'חיפה');

  const users = {
    alphaOrderer: insertPortalUser({ customerId: alphaId, phone: '0501000001', name: 'מזמין אלפא', role: 'orderer', token: TOKENS.alphaOrderer, defaultSiteId: alphaNorth }),
    alphaApprover: insertPortalUser({ customerId: alphaId, phone: '0501000002', name: 'מאשר אלפא', role: 'approver', token: TOKENS.alphaApprover, defaultSiteId: alphaNorth, flags: { canApproveOrders: true, canViewPrices: true } }),
    alphaBoth: insertPortalUser({ customerId: alphaId, phone: '0501000003', name: 'מזמין ומאשר אלפא', role: 'both', token: TOKENS.alphaBoth, defaultSiteId: alphaNorth, flags: { canApproveOrders: true, canViewPrices: true } }),
    alphaFinance: insertPortalUser({ customerId: alphaId, phone: '0501000004', name: 'כספים אלפא', role: 'finance', token: TOKENS.alphaFinance, defaultSiteId: alphaNorth, flags: { canViewPrices: true, canViewBudget: true, canViewInvoices: true, canViewPaymentAlerts: true } }),
    alphaFieldManager: insertPortalUser({ customerId: alphaId, phone: '0501000005', name: 'מנהל שטח אלפא', role: 'field_manager', token: TOKENS.alphaFieldManager, defaultSiteId: alphaSouth }),
    alphaAdmin: insertPortalUser({ customerId: alphaId, phone: '0501000006', name: 'מנהל לקוח אלפא', role: 'customer_admin', token: TOKENS.alphaAdmin, defaultSiteId: alphaNorth, flags: { canManageUsers: true, canCreateSites: true, canAssignSiteUsers: true, canApproveOrders: true, canViewPrices: true, canViewBudget: true, canSetBudget: true, canApproveBudgetOverrun: true, canViewInvoices: true, canViewPaymentAlerts: true } }),
    alphaExpired: insertPortalUser({ customerId: alphaId, phone: '0501000007', name: 'טוקן פג', role: 'orderer', token: TOKENS.expired, expiresAt: PAST, defaultSiteId: alphaNorth }),
    betaOrderer: insertPortalUser({ customerId: betaId, phone: '0502000001', name: 'מזמין בטא', role: 'orderer', token: TOKENS.betaOrderer, defaultSiteId: betaOnly }),
    betaApprover: insertPortalUser({ customerId: betaId, phone: '0502000002', name: 'מאשר בטא', role: 'approver', token: TOKENS.betaApprover, defaultSiteId: betaOnly, flags: { canApproveOrders: true } }),
  };

  assignSites(alphaId, users.alphaOrderer, [alphaNorth], alphaNorth);
  assignSites(alphaId, users.alphaApprover, [alphaNorth, alphaSouth], alphaNorth);
  assignSites(alphaId, users.alphaBoth, [alphaNorth, alphaSouth], alphaNorth);
  assignSites(alphaId, users.alphaFinance, [alphaNorth, alphaSouth], alphaNorth);
  assignSites(alphaId, users.alphaFieldManager, [alphaSouth], alphaSouth);
  assignSites(alphaId, users.alphaAdmin, [alphaNorth, alphaSouth], alphaNorth);
  assignSites(alphaId, users.alphaExpired, [alphaNorth], alphaNorth);
  assignSites(betaId, users.betaOrderer, [betaOnly], betaOnly);
  assignSites(betaId, users.betaApprover, [betaOnly], betaOnly);

  seedPriceBook({ code: 'E2E-GENERAL', name: 'מחירון כללי E2E', priceType: 'general', prices: { 6: 3.2, 8: 3.3, 10: 3.4, 12: 3.5, 14: 3.6, 16: 3.7, 18: 3.8, 20: 3.9, 25: 4.1, 32: 4.3 } });
  seedPriceBook({ code: 'E2E-ALPHA', name: 'מחירון אלפא E2E', customerId: alphaId, priceType: 'customer', prices: { 6: 3.0, 8: 3.1, 10: 3.2, 12: 3.3, 14: 3.4, 16: 3.5, 18: 3.6, 20: 3.7, 25: 3.9, 32: 4.1 } });

  const semanticOrders = [
    ['draft', 'R0-DRAFT-001', 'טיוטה'],
    ['submitted_review', 'R0-REVIEW-001', 'ממתינה לאישור'],
    ['needs_info', 'R0-NEEDS-INFO-001', 'נדרשת השלמה'],
    ['awaiting_customer_approval', 'R0-AWAITING-001', 'ממתינה לאישור לקוח'],
    ['approved', 'R0-APPROVED-001', 'אושרה – ממתין לייצור'],
    ['in_production', 'R0-PRODUCTION-001', 'בייצור'],
    ['ready_for_delivery', 'R0-READY-001', 'הושלם – ממתין לאיסוף'],
    ['delivered', 'R0-DELIVERED-001', 'סופק – אושר'],
    ['cancelled', 'R0-CANCELLED-001', 'בוטלה'],
  ];
  const orders = {};
  semanticOrders.forEach(([semanticStatus, orderNum, status], index) => {
    orders[semanticStatus] = seedOrder({
      orderNum,
      customerId: alphaId,
      siteId: alphaNorth,
      status,
      confirmToken: semanticStatus === 'awaiting_customer_approval' ? 'e2e-awaiting-confirm-token' : null,
      createdAt: `2026-08-${String(10 + index).padStart(2, '0')}T08:00:00.000Z`,
    });
  });
  orders.awaitingUnauthorized = seedOrder({
    orderNum: 'R0-AWAITING-NO-PERM-001', customerId: alphaId, siteId: alphaNorth,
    status: 'ממתינה לאישור לקוח', confirmToken: 'e2e-awaiting-no-permission-token',
    createdAt: '2026-08-19T09:00:00.000Z',
  });
  orders.timeline = {};
  semanticOrders.forEach(([semanticStatus, , status], index) => {
    orders.timeline[semanticStatus] = seedOrder({
      orderNum: `R0-TIMELINE-${semanticStatus.toUpperCase().replaceAll('_', '-')}`,
      customerId: alphaId,
      siteId: alphaSouth,
      status,
      confirmToken: semanticStatus === 'awaiting_customer_approval' ? 'e2e-timeline-awaiting-token' : null,
      createdAt: `2026-08-${String(20 + index).padStart(2, '0')}T08:00:00.000Z`,
    });
  });
  orders.betaPrivate = seedOrder({
    orderNum: 'R0-BETA-PRIVATE-001', customerId: betaId, siteId: betaOnly,
    status: 'בייצור', portalPrice: 999.99, createdAt: '2026-08-19T08:00:00.000Z',
  });

  manifest = {
    schemaVersion: 1,
    seededAt: '2026-08-20T00:00:00.000Z',
    database: 'isolated temporary SQLite database (deleted after the run)',
    password: PASSWORD,
    tokens: TOKENS,
    customers: {
      alpha: { id: alphaId, priceVisible: true, multiSite: true, siteIds: [alphaNorth, alphaSouth] },
      beta: { id: betaId, priceVisible: false, multiSite: false, siteIds: [betaOnly] },
    },
    users,
    orders,
  };
  if (MANIFEST_PATH) {
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  db.close();
}
