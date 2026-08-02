'use strict';
const recommendations = require('../services/procurementRecommendationV2');
const READ = ['warehouse','office','finance','manager','admin'];
const DRAFT = ['office','manager','admin'];
const DECIDE = ['manager','admin'];
function sendError(res, error) { return res.status(error instanceof recommendations.ProcurementRecommendationError ? 409 : (error.statusCode || 400)).json({ error: error.code || 'procurement_recommendation_failed' }); }
module.exports = function createProcurementRecommendationsRouter({ db, requireAnyRole }) {
  const router = require('express').Router();
  router.get('/procurement/recommendations-v2', requireAnyRole(READ), (_req, res) => res.json(recommendations.listRecommendations(db)));
  router.get('/procurement/recommendations-v2/:id', requireAnyRole(READ), (req, res) => { const row = recommendations.getRecommendation(db, req.params.id); return row ? res.json(row) : res.status(404).json({ error: 'procurement_recommendation_not_found' }); });
  router.post('/procurement/recommendations-v2', requireAnyRole(DRAFT), (req, res) => { try { res.status(201).json(recommendations.createDraft(db, { ...req.body, created_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/recommendations-v2/:id/refresh', requireAnyRole(DRAFT), (req, res) => { try { res.json(recommendations.refreshDraft(db, { ...req.body, recommendation_id: req.params.id, refreshed_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/recommendations-v2/:id/approve', requireAnyRole(DECIDE), (req, res) => { try { res.json(recommendations.approveRecommendation(db, { ...req.body, recommendation_id: req.params.id, decided_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/recommendations-v2/:id/reject', requireAnyRole(DECIDE), (req, res) => { try { res.json(recommendations.rejectRecommendation(db, { ...req.body, recommendation_id: req.params.id, decided_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/recommendations-v2/:id/cancel', requireAnyRole(DECIDE), (req, res) => { try { res.json(recommendations.cancelRecommendation(db, { ...req.body, recommendation_id: req.params.id, decided_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  router.post('/procurement/recommendations-v2/:id/reconcile', requireAnyRole(DECIDE), (req, res) => { try { res.json(recommendations.reconcileRecommendation(db, { ...req.body, recommendation_id: req.params.id, reconciled_by: req.auth?.sub })); } catch (error) { sendError(res, error); } });
  return router;
};
module.exports.manifest = {
  module: 'procurement', label: 'Procurement recommendations V2', title: 'Procurement recommendations V2',
  access: { default: 'hidden', roles: { admin: 'edit', manager: 'edit', office: 'edit', finance: 'read', warehouse: 'read' } },
  consumes: [{ table: 'material_requirements_v2' }, { table: 'allocation_plans_v2' }, { table: 'material_consumption_events_v2' }, { table: 'pending_raw_material_receipts_v2' }],
  produces: [{ table: 'procurement_recommendations_v2' }, { table: 'procurement_recommendation_requirement_links_v2' }, { table: 'procurement_recommendation_events_v2' }],
};
