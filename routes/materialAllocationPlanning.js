'use strict';

const planning = require('../services/materialAllocationPlanningV2');

const PLANNER_ROLES = ['production_planner', 'manager', 'admin'];
const READ_ROLES = ['production_planner', 'manager', 'admin', 'warehouse'];

function sendError(res, error) {
  const status = error instanceof planning.MaterialAllocationPlanningError ? 409 : (error.statusCode || 400);
  return res.status(status).json({ error: error.code || 'allocation_planning_failed' });
}

function required(name, value) { if (!value) throw new Error(`routes/materialAllocationPlanning missing ${name}`); return value; }

function createMaterialAllocationPlanningRouter(deps) {
  const express = require('express');
  const db = required('db', deps.db);
  const requireAnyRole = required('requireAnyRole', deps.requireAnyRole);
  const router = express.Router();

  router.get('/material-allocation-plans/suggest', requireAnyRole(READ_ROLES), (req, res) => {
    try { res.json(planning.suggestFifoLots(db, { material_requirement_id: req.query.material_requirement_id })); }
    catch (error) { sendError(res, error); }
  });
  router.post('/material-allocation-plans', requireAnyRole(PLANNER_ROLES), (req, res) => {
    try { res.status(201).json(planning.confirmAllocationPlan(db, { ...req.body, planned_by: req.auth?.sub || null })); }
    catch (error) { sendError(res, error); }
  });
  router.get('/material-allocation-plans/:id', requireAnyRole(READ_ROLES), (req, res) => {
    const plan = planning.getAllocationPlan(db, Number(req.params.id));
    return plan ? res.json(plan) : res.status(404).json({ error: 'allocation_plan_not_found' });
  });
  router.post('/material-allocation-plans/:id/release', requireAnyRole(PLANNER_ROLES), (req, res) => {
    try { res.json(planning.releaseAllocationPlan(db, { allocation_plan_id: req.params.id, released_by: req.auth?.sub || null, reason: req.body?.reason })); }
    catch (error) { sendError(res, error); }
  });
  router.post('/material-allocation-plans/reconcile', requireAnyRole(PLANNER_ROLES), (req, res) => {
    try { res.json(planning.reconcileAllocationPlan(db, { ...req.body, reconciled_by: req.auth?.sub || null })); }
    catch (error) { sendError(res, error); }
  });
  return router;
}

module.exports = createMaterialAllocationPlanningRouter;
module.exports.manifest = {
  module: 'inventory', label: 'Material allocation planning V2', title: 'Material allocation planning V2', access: { default: 'hidden', roles: { admin: 'edit', manager: 'edit', production_planner: 'edit', warehouse: 'read' } },
  consumes: [{ table: 'material_requirements_v2' }, { table: 'raw_material' }],
  produces: [{ table: 'allocation_plans_v2' }, { table: 'allocation_plan_lines_v2' }],
};
