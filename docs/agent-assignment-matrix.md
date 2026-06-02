# Agent Assignment Matrix

Operational assignment board for restoring `tene-industry` without overlapping work.

This file is the bridge between:

- `docs/module-inventory.md`
- `docs/recovery-backlog.md`
- `docs/api-route-permission-map.md`
- `docs/screen-compliance-map.md`
- `docs/agent-task-template.md`

Rule: every agent gets one module, one narrow objective, and one explicit write scope.

## Agent Types

| Type | Allowed outcome | When to use |
| --- | --- | --- |
| `explorer` | Findings, decisions, split plans, risks, next task IDs | Before touching a mixed module or unclear spec area. |
| `worker` | Code/docs/tests in an explicit write scope | After role, API, and screen ownership are clear. |
| `verifier` | Test results, screenshots, route checks, regression report | In parallel with code work or before release gates. |

## Active Coordination Rules

- Do not give two workers the same file unless one is explicitly waiting for the other to finish.
- `server.js` is a high-conflict file; only one worker may edit it at a time.
- Frontend workers may work in parallel only when their HTML files are disjoint.
- Portal workers may not reuse internal role assumptions without a written portal auth decision.
- No agent may add features while Sprint 1 security is incomplete.
- Every worker must list tests run and remaining risk in the handoff.

## Sprint 1 Agent Board

| Task ID | Agent | Type | Module | Objective | Write scope | Depends on | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `S1-01A` | Role Model Explorer | explorer | Platform Core / Security | Decide final role model from source permission matrix vs current code roles. | None | S0 registries | P0 |
| `S1-01B` | Security Gate Screen Explorer | explorer | Platform Core / UX | Identify exact splits and risks in login/admin/customers/finance/customer portal screens. | None | S0 screen map | P0 |
| `S1-01C` | Auth Client Worker | worker | Platform Core / UX | Unify client auth/fetch behavior and define permission-denied handling without trusting client role. | `public/auth-client.js`, `public/nav.js`, `public/login.html` | S1-01A, S1-01B | P0 |
| `S1-01D` | Admin Shell Explorer/Worker | explorer then worker | Platform Core | Split `admin.html` plan into settings/users/database/audit core and module-owned panels. | Explorer: none. Worker later: `public/admin.html` only | S1-01B, S1-05 | P0 |
| `S1-01E` | Customer Portal Split Explorer | explorer | External Portals | Continue product split after S1-07: `customer.html` is active; `portal.html` is deprecated unless rebuilt on a scoped endpoint. | None | S1-01B, S1-07 | P0 |
| `S1-02` | User Management Worker | worker | Platform Core / Security | Protect `/api/users*` and reconcile `/api/users/login`. | `server.js`, `test/*.test.js` | S1-01A | P0 |
| `S1-03` | Auth Enforcement Worker | worker | Platform Core / Security | Remove spoofable privileged role fallback and make real JWT enforcement testable. | `server.js`, `auth-core.js`, `test/*.test.js`, deployment docs if needed | S1-01A | P0 |
| `S1-04` | Deployment Secret And Enforcement Plan | explorer | Platform Core / DevOps | Add stable JWT deployment secret and document the enforcement gate. | `render.yaml`, `docs/security-rollout.md`, `docs/sprint-1-security-plan.md` | S1-03 | P0 |
| `S1-05` | Platform Core And Finance Guard Worker | worker | Platform Core / Finance / Security | Protect settings, audit, database admin, and finance-sensitive endpoints. | `server.js`, `test/*.test.js` | S1-03, S1-04 | P0 |
| `S1-06` | Order Approval Guard Worker | worker | Orders | Protect order import approval, manual order creation, status, lock/unlock, Priority sync. | `server.js`, `test/*.test.js` | S1-03 | P0 |
| `S1-07` | Customer Portal Auth Explorer | explorer | External Portals | Done: portal-token decision recorded; customer ownership tests added; `portal.html` no longer uses internal order search. | None | S1-01A, S1-01B | P0 |
| `S1-08` | Production Mutation Guard Worker | worker | Production | Protect production queue, item status, shifts, machine stops, scan/machine mutations. | `server.js`, `test/*.test.js` | S1-03 | P0 |
| `S1-09` | Security Verification Agent | verifier | Platform Core / Security | Verify anonymous/wrong-role/admin behavior for all P0 route families. | None, or test report doc only | S1-02..S1-08 | P0 |

## Sprint 2 Agent Board

| Task ID | Agent | Type | Module | Objective | Write scope | Depends on | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `S2-01` | Frontend Safety Worker | worker | Design System | Add shared escape/render helpers and migrate first high-risk screens. | `public/*.js`, selected HTML files | S1 P0 auth guards | P0 |
| `S2-02` | Admin Split Explorer | explorer | Platform Core | Turn `admin.html` into a split plan: core admin vs module-owned panels. | None | S1-01B | P1 |
| `S2-03` | Order Status Worker | worker | Orders | Centralize order status labels/transitions for orders and dashboard. | `server.js`, `public/orders.html`, `public/index.html`, tests | S1 guards | P1 |
| `S2-04` | Production Source Worker | worker | Production / Dashboard | Make dashboard production queue read from `/api/production-queue`. | `public/dashboard.html`, tests/manual check | S1 production guards | P1 |
| `S2-05` | Portal Product Explorer | explorer | External Portals | Decide whether `customer.html` and `portal.html` merge or serve different portal products. | None | S1-07 | P1 |

## Module Ownership Map

| Module | Primary screens | Primary route families | First agent task |
| --- | --- | --- | --- |
| Platform Core | `login.html`, admin core panels, `help.html` | `/api/auth/*`, `/api/users*`, `/api/settings*`, `/api/audit-log`, `/api/admin/database/*` | `S1-01A`, `S1-02`, `S1-03`, `S1-04`, `S1-05` |
| Orders | `orders.html`, `index.html`, customer CRM areas | `/api/orders*`, `/api/order-imports/*`, `/api/intake/*`, `/api/bvbs/*`, `/api/priority/*` | `S1-06`, `S2-03` |
| Production | `production-queue.html`, `machine.html`, `kiosk.html`, `worker-visual.html` | `/api/production-queue`, `/api/machines*`, `/api/items/*`, `/api/shifts*`, `/api/machine-stops*` | `S1-08`, `S2-04` |
| Inventory / Procurement | `inventory.html`, `warehouse.html`, `procurement.html` | `/api/inventory*`, `/api/suppliers*`, `/api/purchase-orders*`, `/api/steel-prices*` | Sprint 3 after P0 guards |
| Delivery | `driver.html`, warehouse delivery areas | `/api/drivers*`, `/api/deliveries*`, `/api/packages*`, `/api/delivery-notes*` | Sprint 3 after portal auth decision |
| Finance | `finance.html`, finance report panels, credit/project panels | `/api/finance/*`, `/api/credit*`, `/api/invoices*`, `/api/orders/:id/costs*`, `/api/orders/:id/margin` | `S1-05` |
| Quality / Maintenance | `quality.html`, `maintenance.html`, `warroom.html` | `/api/quality*`, `/api/incidents*`, `/api/ncr*`, `/api/capa*`, `/api/maintenance*`, `/api/loto*` | Sprint 3 state-machine explorer |
| External Portals | `customer.html`, `portal.html`, `supplier.html`, `driver.html` | `/api/c/*`, supplier/driver scoped APIs | `S1-07`, `S2-05` |
| Dashboard / Reports | `dashboard.html`, `reports.html`, `holdings.html`, `docs.html` | `/api/dashboard`, `/api/reports/*`, `/api/kpi/*`, `/api/search` | `S2-04`, Sprint 3 reporting split |

## Current Running Agent Assignments

These are the first bounded agents started from this board:

| Agent | Task | Status |
| --- | --- | --- |
| Role Model Explorer | `S1-01A` | closed after timeout; decision completed locally in `docs/role-model-decision.md` |
| Security Gate Screen Explorer | `S1-01B` | completed |

## S1-01B Handoff: Security Gate Screens

Security Gate Screen Explorer inspected:

- `public/login.html`
- `public/admin.html`
- `public/customers.html`
- `public/finance.html`
- `public/customer.html`
- `public/portal.html`
- `public/nav.js`
- `public/auth-client.js`

Key findings to preserve in execution:

- `admin.html` must be split into core admin panels: settings, users, database, audit. Machines, drivers, price list, portal links, and intake review belong to module-owned follow-up tasks.
- `customers.html` mixes CRM, order history, portal token creation, and potential pricing/credit exposure. Portal token creation must become a separate permissioned action.
- `finance.html` mixes read-only BI, steel-price write actions, costing, margin, and ledger. The former client-sent `x-user-role: manager` pattern has been removed; future finance UI work must use real JWT sessions.
- `customer.html` is the active customer portal. `portal.html` is deprecated and no longer calls internal `/api/orders?order_num=`.
- `auth-client.js` is now the single fetch/auth wrapper; `nav.js` loads it and must not redefine auth behavior.
- `nav.js` exposes broad navigation links, including admin/finance/driver, without role gating. Server permissions remain the true security boundary.
- API-sourced `innerHTML` is widespread in admin, finance, customer portal, public portal, and customer CRM areas.

Worker sequence recommended from this handoff:

1. `S1-01C` Auth Client Worker: unify fetch/auth behavior in `auth-client.js`, `nav.js`, and `login.html`.
2. `S1-01D` Admin Shell task: keep only settings/users/database/audit in `admin.html` core, after server guards exist.
3. `S1-05` Finance Guard Worker: remove client role spoofing and protect finance routes before UI polish.
4. `S1-01E` Portal product follow-up: keep `customer.html` as the active portal and rebuild or remove `portal.html`.
5. `S2-01` Safe Rendering Worker: add escape/render helpers and migrate high-risk screens one at a time.

## Definition Of Done For Agent Work

An agent task is done only when:

- It names the exact files it inspected or changed.
- Its output links back to a task ID in this matrix.
- It records remaining decisions instead of hiding uncertainty.
- For worker tasks, tests or explicit manual checks are reported.
- For security tasks, anonymous and wrong-role behavior are covered.
