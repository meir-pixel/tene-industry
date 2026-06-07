# Tene Industry Recovery Plan

This document is the working plan for turning `tene-industry` from a one-off
IronBend implementation into a modular product that can be configured and sold
to multiple industrial customers.

## Current Recovery Checkpoint

Status as of 2026-06-07:

- Active product API route families have been extracted into module-owned `routes/*.js` files.
- `server.js` intentionally keeps only HTTP/bootstrap glue and `GET /api/health`; core schema, compatibility migrations, and seed data live in `db/startup.js`, finance schema lives in `db/financeSchema.js`, request authentication middleware lives in `middleware/auth.js`, authenticated WebSocket transport lives in `realtime/ws.js`, and scheduled background work lives in `jobs/scheduler.js`.
- JWT-derived authorization is active for guarded routes; `AUTH_BYPASS` is development-only and blocked in production.
- Governance tests protect module boundaries, auth coverage, constants, status contracts, and extracted services.
- Full test baseline at this checkpoint: `npm test` passes with 145/145 tests.

Historical notes below may still describe the original monolith where useful, but new work must follow `docs/BUILD_RULES_HE.md` and the current module map.

## Current Diagnosis

The codebase contains a large amount of useful business work, but it is not yet
organized as a product platform.

The source specification volumes were located in
`C:\Users\meir-tene\Downloads\02_מסמכים`. See:

- `docs/spec-source-index.md`
- `docs/spec-gap-matrix.md`
- `docs/screen-registry.md`
- `docs/api-registry.md`
- `docs/entity-registry.md`
- `docs/event-registry.md`
- `docs/permission-registry.md`
- `docs/role-model-decision.md`
- `docs/registry-reconciliation.md`
- `docs/api-route-permission-map.md`
- `docs/screen-compliance-map.md`
- `docs/agent-assignment-matrix.md`
- `docs/sprint-1-security-plan.md`
- `docs/security-verification-report.md`
- `docs/recovery-backlog.md`
- `docs/agent-task-template.md`

The main symptoms are:

- `server.js` used to own almost every domain; active API route families are now module-owned under `routes/*.js`, database startup is isolated in `db/startup.js`, and `/api/health` intentionally remains in `server.js`.
- Frontend screens are mostly standalone HTML files with their own data loading,
  rendering, escaping, role handling, empty states, and action flows.
- Several screens show similar concepts in different ways, especially orders,
  production queue, machine work, customer status, and admin intake review.
- Authentication and authorization are active for guarded routes through JWT-derived `req.auth`; production must keep `AUTH_BYPASS` disabled.
- Some business flows were started as stubs or partially connected modules.
- The product is currently branded and modeled as a rebar factory system, while
  the intended commercial product needs a reusable core plus industry packages.

## Product Direction

The product should be split into a generic industrial operations platform plus
vertical packages.

Iron/rebar should become the first vertical package, not the entire system.

Target structure:

- Platform core: users, roles, permissions, tenant configuration, navigation,
  settings, audit log, notifications, file/import handling, search.
- Orders module: customers, orders, items, statuses, approvals, documents,
  imports, source channels.
- Production module: queue, machines, workers, shifts, kiosk, machine events,
  production cards, completion flow.
- Inventory module: suppliers, raw material, receiving, batches, reservations,
  forecasts.
- Delivery module: packages, delivery notes, drivers, routes, proof of delivery.
- Finance module: price lists, costs, margins, credit, invoices, ledger.
- Quality module: checks, NCR, CAPA, incidents.
- Portals module: customer portal, supplier portal, driver portal, worker portal.
- Vertical packages: rebar/steel first, later configurable packages for other
  factories or service businesses.

## Non-Negotiable Rules From Now On

1. No new feature work before the screen or endpoint is assigned to a module.
2. No page should invent its own auth, role, navigation, API client, or escaping.
3. No screen should read a different source of truth for the same business state.
4. No module should depend on Hebrew status strings scattered across pages.
5. No endpoint that changes production data should remain unprotected.
6. Every sprint must end with tests or a written reason why a test cannot yet
   exist.
7. Each agent owns a bounded area and must not edit unrelated screens.

## Module Boundaries

### Platform Core

Owns:

- Authentication and authorization.
- Roles and permissions.
- Tenant/customer configuration.
- Shared API client.
- Shared layout shell and navigation.
- Shared UI primitives.
- Shared escaping and formatting helpers.
- Audit log and system settings.

Initial files:

- `auth-core.js`
- `public/auth-client.js`
- `public/nav.js`
- `public/theme.css`
- `routes/auth.js` and `routes/admin.js`

### Orders

Owns:

- Order lifecycle.
- Order import and OCR intake after approval.
- Order detail.
- Order documents and print cards.
- Customer-owned order status.

Initial files:

- `routes/orders.js` and `routes/productionCards.js`
- `public/orders.html`
- `public/index.html`
- `docs/order-import-integration.md`
- `intake.js`

### Production

Owns:

- Approved production queue.
- Machine assignment.
- Machine state.
- Worker and kiosk work execution.
- Production event history.

Initial files:

- `routes/production.js`
- `public/production-queue.html`
- `public/machine.html`
- `public/kiosk.html`
- `public/worker.html`
- `public/worker-visual.html`
- `modbus.js`

### Inventory And Procurement

Owns:

- Suppliers.
- Raw material inventory.
- Receiving.
- Purchase orders.
- Forecasts.

Initial files:

- `routes/inventory.js`
- `public/inventory.html`
- `public/warehouse.html`
- `public/procurement.html`

### Delivery

Owns:

- Packages.
- Delivery notes.
- Drivers.
- Route status.

Initial files:

- `routes/warehouse.js` and `routes/fleet.js`
- `public/driver.html`
- `public/warehouse.html`

### Finance

Owns:

- Price lists.
- Costing.
- Margins.
- Credit and ledger.
- Invoices.

Initial files:

- `routes/finance.js` and catalog pricing routes in `routes/catalog.js`
- `public/finance.html`
- finance parts of `public/reports.html`

### Quality And Maintenance

Owns:

- Quality checks.
- NCR/CAPA.
- Maintenance.
- LOTO.
- Incidents.

Initial files:

- `routes/quality.js`
- `public/quality.html`
- `public/maintenance.html`
- `public/warroom.html`

### Portals

Owns:

- Customer portal.
- Supplier portal.
- Driver portal.
- Worker portal.
- Token/session model for external users.

Initial files:

- `/api/c/*` routes in `routes/portal.js`
- external portal and driver/customer routes in module-owned route files
- `public/customer.html`
- `public/portal.html`
- `public/supplier.html`
- `public/driver.html`

## Critical Findings To Fix First

### P0: Authentication Enforcement Baseline

Protected routes require JWT-derived identity through explicit route middleware and no longer trust spoofable role headers. `AUTH_ENFORCEMENT` is retired as a deployment lever; staging and production must verify anonymous protected requests return 401.

Impact:

- New `/api/*` routes are unsafe unless they declare a guard or explicit public/scoped boundary.
- Frontend role checks remain cosmetic; server middleware is the enforcement point.

Decision:

- Keep `test/route-auth-coverage.test.js` green and expand request-level tests for critical workflows.

### P0: User Management Routes Are Open

The users API is not consistently protected.

Impact:

- A user, PIN, or role could be created or changed without a real admin session.

Decision:

- Protect all user-management endpoints with `requireRole('admin')`.
- Remove or quarantine legacy `/api/users/login` before enforcement.

### P1: Customer Portal Trusts Phone Alone

The customer portal can resolve/create access by phone number and issue a portal
token.

Impact:

- Anyone who knows a phone number can potentially access that customer context.

Decision:

- Portal login must use OTP or a link delivered to a verified channel.

### P1: Screen Rendering Is Not Safe Enough

Many screens use `innerHTML` with data from the database, OCR, imports, or
external messages.

Impact:

- Stored XSS can compromise localStorage tokens and operator sessions.

Decision:

- Introduce a shared escaping/render helper.
- Fix high-risk screens first: admin intake, orders, dashboard, customer portal.

### P1: Dashboard Uses The Wrong Production Queue Source

`dashboard.html` builds production queue state from recent orders and still
includes unapproved orders. `/api/production-queue` already has safer filtering.

Impact:

- Operators/managers may see unapproved orders as production work.

Decision:

- Dashboard must consume `/api/production-queue` or a dashboard endpoint that
  uses the same domain service.

## Agent Ownership Model

Agents should be assigned by module, not by random screen.

### Architecture Agent

Owns:

- Module map.
- Route extraction plan.
- Naming rules.
- Cross-module dependencies.

May edit:

- docs only until Sprint 1 is approved.

### Security Agent

Owns:

- Auth enforcement.
- Roles and permissions.
- Protected endpoint list.
- Token storage and refresh.
- API and WebSocket security.

May edit:

- `server.js`
- `auth-core.js`
- `public/auth-client.js`
- `public/nav.js`
- tests related to auth and authorization
- deployment config after approval

### Orders Agent

Owns:

- `public/orders.html`
- order routes
- order status model
- import/OCR approval flow
- print/delivery documents

May not edit:

- production machine execution screens except through shared contracts.

### Production Agent

Owns:

- `public/production-queue.html`
- `public/machine.html`
- `public/kiosk.html`
- `public/worker*.html`
- production/machine routes
- machine state model

May not edit:

- order creation except through the order module contract.

### Portal Agent

Owns:

- `public/customer.html`
- `public/portal.html`
- `public/supplier.html`
- `public/driver.html`
- external-user auth flows

May not edit:

- internal admin screens.

### Design System Agent

Owns:

- `public/theme.css`
- `public/nav.js`
- shared components/helpers
- responsive shell

May not edit:

- business logic.

## Sprint Plan

### Sprint 0: Freeze, Map, And Stabilize

Goal:

- Stop adding uncontrolled work.
- Create a source-of-truth map.
- Identify what is real, partial, stub, duplicate, or unsafe.
- Reconcile the codebase against the Drive specification volumes.

Deliverables:

- This document.
- Endpoint inventory / `docs/api-registry.md`.
- Screen inventory / `docs/screen-registry.md`.
- Module ownership table.
- P0/P1 backlog.
- Specification source index.
- Specification gap matrix.
- Entity, event, and permission registries.
- Recovery backlog.
- Agent task template.

Exit gate:

- Every screen and API route has an owner module.
- P0 security tasks are sequenced.
- Every current requirement source is either indexed or explicitly deferred.
- Every agent task names exactly one registry-backed module and file scope.

### Sprint 1: Security And Access Foundation

Goal:

- Make the system safe enough to continue product work.

Deliverables:

- Stable `JWT_SECRET` configured in deployment.
- PIN migration verified.
- Anonymous protected-route checks return 401 in staging, then production.
- `x-user-role` fallback removed.
- User/admin/settings/finance/database endpoints protected.
- Dedicated pages either load the shared auth client or are intentionally public.
- Authorization tests for critical endpoints.

Exit gate:

- No protected data endpoint can be called anonymously.
- Role escalation via headers is impossible.

### Sprint 2: Shared Shell And Module Contracts

Goal:

- Stop each page from inventing its own app behavior.

Deliverables:

- Shared API client.
- Shared escaping helpers.
- Shared empty/loading/error states.
- Shared status constants.
- Shared layout/navigation contract.
- Module route map.

Exit gate:

- Orders, dashboard, production queue, admin, and portals use the shared client
  and status model.

### Sprint 3: Orders And Production Truth

Goal:

- Make order state and production state consistent.

Deliverables:

- One order status state machine.
- One production queue service.
- Dashboard queue reads the same source as production queue.
- Unapproved orders cannot enter production views.
- Tests for status transitions and queue filtering.

Exit gate:

- A pending/unapproved order never appears as production work in any screen.

### Sprint 4: Screen Rebuild By Module

Goal:

- Rebuild screens as coherent workflows, not separate pages stitched together.

Order:

1. Dashboard.
2. Orders.
3. Production queue and machine/kiosk.
4. Inventory/warehouse.
5. Customer portal.
6. Supplier/driver/worker portals.
7. Finance.
8. Quality and maintenance.

Exit gate:

- Each screen has a clear owner, a single purpose, consistent UI, protected API
  calls, and happy/empty/error states.

### Sprint 5: Productization

Goal:

- Make the product sellable beyond the current rebar customer.

Deliverables:

- Tenant/company settings.
- Branding configuration.
- Feature flags by module.
- Vertical package configuration.
- Demo data and onboarding flow.
- Deployment checklist per customer.

Exit gate:

- A new customer can be configured without editing core code for branding,
  enabled modules, basic roles, and terminology.

## Definition Of Done For Any Screen

A screen is not done until:

- It belongs to one module.
- It uses shared auth/API behavior.
- It does not render unescaped user/import/OCR data.
- It has loading, empty, error, and success states.
- It handles mobile and desktop.
- It does not duplicate another screen's source of truth.
- Its write actions are protected server-side.
- Its critical flow has at least one test or documented manual verification.

## Immediate Backlog

1. Keep module docs and route ownership maps synchronized with `routes/*.js`.
2. Clean historical sprint/backlog docs that still describe the old monolith as current state.
3. Build compare-and-approve UX for OCR/email/WhatsApp intake: original document beside parsed output.
4. Continue screen-level design normalization for intake, shape review, inventory receiving, order approval, fleet, and delivery admin.
5. Add pricing importer/pricer services as a future sprint without changing the canonical `price_list` table.
6. Define vendor control / remote support APIs with customer-approved support sessions and audit logging.
7. Decide final device/station auth policy for kiosk, worker, and driver deployments.
8. Continue hardening module services where business logic still lives in route files.

## Open Inputs Needed From Product Owner

To compare implementation against the original specification, we need the
current authoritative characterization documents:

- The original product specification.
- The screen list or user flow map.
- Any screenshots or design references that define the intended UI.
- The intended customer types beyond rebar.
- Which modules are required for the first sellable release.

Until those are attached, recovery can continue from code evidence, but the
gap analysis against the original scope will remain incomplete.
