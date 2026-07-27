'use strict';

const consumption = require('../services/materialConsumptionV2');

const DRAFT_ROLES = ['production', 'production_planner', 'manager', 'admin'];
const APPROVAL_ROLES = ['production_planner', 'manager', 'admin'];
const REVERSAL_ROLES = ['manager', 'admin'];
const READ_ROLES = ['production', 'production_planner', 'manager', 'admin', 'warehouse'];

function sendError(res, error) {
  return res.status(error instanceof consumption.MaterialConsumptionError ? 409 : (error.statusCode || 400)).json({ error: error.code || 'material_consumption_failed' });
}

module.exports = function createMaterialConsumptionRouter({ db, requireAnyRole }) {
  const express = require('express'); const router = express.Router();
  router.post('/material-consumption-reports', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try { res.status(201).json(consumption.createConsumptionReport(db, { ...req.body, created_by: req.auth?.sub })); } catch (error) { sendError(res, error); }
  });
  router.get('/material-consumption-reports/:id', requireAnyRole(READ_ROLES), (req, res) => {
    const report = consumption.getConsumptionReport(db, req.params.id); return report ? res.json(report) : res.status(404).json({ error: 'consumption_report_not_found' });
  });
  router.get('/material-consumption-events', requireAnyRole(READ_ROLES), (req, res) => {
    try { res.json(consumption.listConsumptionEvents(db, req.query)); } catch (error) { sendError(res, error); }
  });
  router.patch('/material-consumption-reports/:id', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try { res.json(consumption.updateConsumptionReport(db, { ...req.body, report_id: req.params.id, updated_by: req.auth?.sub })); } catch (error) { sendError(res, error); }
  });
  router.post('/material-consumption-reports/:id/cancel', requireAnyRole(DRAFT_ROLES), (req, res) => {
    try { res.json(consumption.cancelConsumptionReport(db, { ...req.body, report_id: req.params.id, cancelled_by: req.auth?.sub })); } catch (error) { sendError(res, error); }
  });
  router.post('/material-consumption-reports/:id/approve', requireAnyRole(APPROVAL_ROLES), (req, res) => {
    try { res.json(consumption.approveConsumptionReport(db, { ...req.body, report_id: req.params.id, approved_by: req.auth?.sub })); } catch (error) { sendError(res, error); }
  });
  router.post('/material-consumption-events/:id/reverse', requireAnyRole(REVERSAL_ROLES), (req, res) => {
    try { res.json(consumption.reverseConsumptionEvent(db, { ...req.body, original_event_id: req.params.id, reversed_by: req.auth?.sub })); } catch (error) { sendError(res, error); }
  });
  return router;
};

module.exports.manifest = {
  module: 'inventory', label: 'Confirmed material consumption V2', title: 'Confirmed material consumption V2',
  access: { default: 'hidden', roles: { admin: 'edit', manager: 'edit', production_planner: 'edit', production: 'edit', warehouse: 'read' } },
  consumes: [{ table: 'material_requirements_v2' }, { table: 'allocation_plan_lines_v2' }, { table: 'raw_material' }],
  produces: [{ table: 'material_consumption_reports_v2' }, { table: 'material_consumption_events_v2' }],
};
