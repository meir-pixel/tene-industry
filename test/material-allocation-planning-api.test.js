'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('allocation API exposes separate read and planner-only writes without touching V1 routes', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'materialAllocationPlanning.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(route, /material-allocation-plans\/suggest/);
  assert.match(route, /requireAnyRole\(PLANNER_ROLES\)/);
  assert.match(route, /production_planner/);
  assert.match(route, /material_requirement_id/);
  assert.match(server, /createMaterialAllocationPlanningRouter/);
  for (const forbidden of ['weight_used', 'raw_material_usage', 'inventory_reservations', 'purchase_orders']) assert.doesNotMatch(route, new RegExp(forbidden));
});
