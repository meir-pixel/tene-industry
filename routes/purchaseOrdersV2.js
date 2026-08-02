'use strict';

const purchaseOrders = require('../services/purchaseOrderV2');

const READ = ['warehouse', 'office', 'finance', 'manager', 'admin'];
const DRAFT = ['office', 'finance', 'manager', 'admin'];
const APPROVE = ['manager', 'admin'];
function sendError(res, error) { return res.status(error instanceof purchaseOrders.PurchaseOrderV2Error ? 409 : (error.statusCode || 400)).json({ error: error.code || 'purchase_order_v2_failed' }); }

module.exports = function createPurchaseOrdersV2Router({ db, requireAnyRole }) {
  const router = require('express').Router();
  router.get('/procurement/purchase-orders-v2', requireAnyRole(READ), (_req, res) => res.json(purchaseOrders.listPurchaseOrders(db)));
  router.get('/procurement/purchase-orders-v2/:id', requireAnyRole(READ), (req, res) => { const row = purchaseOrders.getPurchaseOrder(db, req.params.id); return row ? res.json(row) : res.status(404).json({ error: 'purchase_order_v2_not_found' }); });
  router.post('/procurement/purchase-orders-v2', requireAnyRole(DRAFT), (req, res) => { try { res.status(201).json(purchaseOrders.createDraft(db, { ...req.body, created_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.patch('/procurement/purchase-orders-v2/:id', requireAnyRole(DRAFT), (req, res) => { try { res.json(purchaseOrders.updateDraft(db, { ...req.body, purchase_order_id: req.params.id, updated_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/purchase-orders-v2/:id/approve', requireAnyRole(APPROVE), (req, res) => { try { res.json(purchaseOrders.approvePurchaseOrder(db, { ...req.body, purchase_order_id: req.params.id, approved_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/purchase-orders-v2/:id/issue', requireAnyRole(APPROVE), (req, res) => { try { res.json(purchaseOrders.issuePurchaseOrder(db, { ...req.body, purchase_order_id: req.params.id, issued_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/purchase-orders-v2/:id/cancel', requireAnyRole(APPROVE), (req, res) => { try { res.json(purchaseOrders.cancelPurchaseOrder(db, { ...req.body, purchase_order_id: req.params.id, cancelled_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  return router;
};

module.exports.manifest = {
  module: 'procurement', label: 'Purchase Orders V2', title: 'Purchase Orders V2',
  access: { default: 'hidden', roles: { admin: 'edit', manager: 'edit', finance: 'edit', office: 'edit', warehouse: 'read' } },
  consumes: [{ table: 'suppliers' }, { table: 'catalog_items' }, { table: 'procurement_recommendations_v2' }],
  produces: [{ table: 'purchase_orders_v2' }, { table: 'purchase_order_lines_v2' }, { table: 'purchase_order_events_v2' }],
};
