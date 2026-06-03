# Recovery Backlog

This is the execution backlog for the `tene-industry` recovery effort. It turns
the specification volumes, registries, and gap matrix into controlled work.

Rule: no task is ready unless it names one module owner, one file scope, source
documents, acceptance checks, and the agent type that may work on it.

## Current Recovery Checkpoint

Status as of 2026-06-03:

- Active API route families are module-owned under `routes/*.js`.
- `server.js` intentionally keeps only `/api/health` plus infrastructure/runtime wiring.
- JWT auth and route-coverage governance are active.
- Full test baseline: `npm test` passes with 136/136 tests.
- New routes require owner-module assignment, explicit auth/scoped boundary, and `test/module-governance.test.js` updates.


## Work States

- `candidate`: identified but not ready.
- `ready`: scoped and can be assigned.
- `in_progress`: currently owned by an agent/person.
- `blocked`: needs product-owner decision or missing source.
- `done`: completed and verified.

## Sprint 0: Source Of Truth And Work Control

Goal:

- Stop uncontrolled work.
- Establish the registries required by Volume 10.
- Prepare Sprint 1 security without guessing roles or route ownership.

### S0-01: Index Specification Sources

- Status: `done`
- Owner module: Platform Core / Architecture
- Files:
  - `docs/spec-source-index.md`
- Source:
  - local files under `C:\Users\meir-tene\Downloads\02_מסמכים`
- Acceptance:
  - Known volumes listed.
  - Missing volumes listed.
  - Duplicate Volume ו׳ copies cleaned up and documented.

### S0-02: Create Module Inventory

- Status: `done`
- Owner module: Architecture
- Files:
  - `docs/module-inventory.md`
- Source:
  - `server.js`
  - `public/*.html`
  - Volume 10
- Acceptance:
  - Major screens and route families have module owners.

### S0-03: Create Core Registries

- Status: `done`
- Owner module: Architecture
- Files:
  - `docs/screen-registry.md`
  - `docs/api-registry.md`
  - `docs/entity-registry.md`
  - `docs/event-registry.md`
  - `docs/permission-registry.md`
- Source:
  - Volume 10
  - current codebase
- Acceptance:
  - Each registry exists and distinguishes current implementation from target
    direction where known.

### S0-04: Reconcile Registries With Original DOCX Sources

- Status: `done`
- Owner module: Architecture
- Files:
  - `docs/registry-reconciliation.md`
  - `docs/api-registry.md`
  - `docs/entity-registry.md`
  - `docs/permission-registry.md`
- Source:
  - `IronBend_API_Registry.docx`
  - `IronBend_Entity_Registry.docx`
  - `IronBend_Permission_Matrix.docx`
- Acceptance:
  - Original API count/groups captured.
  - Original entity count/list captured.
  - Original role matrix captured.
  - Mismatches vs current code recorded.

### S0-05: Generate Route-By-Route Permission Table

- Status: `done`
- Owner module: Platform Core / Security
- Agent type: Explorer first, then Worker after approval
- Files:
  - `docs/api-route-permission-map.md`
  - no code edits in first pass
- Source:
  - `server.js`
  - `docs/api-registry.md`
  - `IronBend_API_Registry.docx`
  - `IronBend_Permission_Matrix.docx`
- Acceptance:
  - Route families have target role policies and module owners.
  - Historical scan count was recorded for the original monolith: 190 Express routes, 170 direct role-protected routes.
  - Current active API routes are enforced through module-owned route files and `test/route-auth-coverage.test.js`.

### S0-06: Create Screen Compliance Table

- Status: `done`
- Owner module: Design System / Architecture
- Agent type: Explorer
- Files:
  - `docs/screen-compliance-map.md`
- Source:
  - `public/*.html`
  - `docs/screen-registry.md`
  - Volume ח׳ UI/UX
- Acceptance:
  - Every screen has purpose, owner, auth mode, nav/auth-client status, risky
    rendering status, mobile status, and rebuild priority.
  - Current scan count is recorded: 28 HTML screens in `public/`.

### S0-07: Architecture Diagram Extraction

- Status: `done`
- Owner module: Architecture
- Agent type: Explorer
- Files:
  - `docs/architecture-diagram-notes.md`
- Source:
  - `IronBend_Architecture_Diagram.docx`
- Acceptance:
  - Architecture diagram contents are captured by visual or tolerant extraction.
  - Any conflicts with current module map are recorded.
  - Extracted notes are recorded in `docs/architecture-diagram-notes.md`.

## Sprint 1: Security And Permission Foundation

Goal:

- Make the product safe enough for real work and future customer sales.
- Align the role model with the source Permission Matrix.

### S1-01: Target Role Model Decision

- Status: `done`
- Owner module: Platform Core / Security
- Agent type: Explorer
- Files:
  - `docs/permission-registry.md`
  - `docs/role-model-decision.md`
  - `docs/sprint-1-security-plan.md`
- Source:
  - `IronBend_Permission_Matrix.docx`
  - `docs/registry-reconciliation.md`
  - `server.js`
- Acceptance:
  - `office`, `sales`, `viewer`, and `kiosk` are added to the target role model.
  - `finance` remains a separate internal role.
  - `operator` is deprecated and mapped to `kiosk` or `production`.
  - `customer` and `supplier` are external identities only.
  - Decision is recorded in `docs/role-model-decision.md`.

### S1-02: Protect User Management

- Status: `done`
- Owner module: Platform Core / Security
- Agent type: Worker
- Write scope:
  - `server.js`
  - `test/*.test.js`
- Source:
  - `docs/api-registry.md`
  - `docs/permission-registry.md`
- Acceptance:
  - `/api/users`, `/api/users/:id`, and user creation/update require admin.
  - Tests cover anonymous/spoofed header, wrong role, and admin.
  - Legacy `/api/users/login` returns 410 and points callers to `/api/auth/login`.

### S1-01C: Unify Client Auth Contract

- Status: `done`
- Owner module: Platform Core / UX
- Agent type: Worker
- Write scope:
  - `public/auth-client.js`
  - `public/nav.js`
  - `public/login.html`
- Source:
  - `docs/agent-assignment-matrix.md`
  - `docs/sprint-1-security-plan.md`
  - `public/auth-client.js`
  - `public/nav.js`
  - `public/login.html`
  - Acceptance:
    - One client-side fetch/auth wrapper is the source of truth.
    - Client-stored role is treated as display/navigation state only.
    - Permission-denied behavior is consistent.
    - No internal route security depends on client-side role checks.
    - `test/client-auth-contract.test.js` prevents duplicate fetch wrappers and
      spoofable browser role headers from returning.

### S1-01D: Admin Shell Split Plan

- Status: `done`
- Owner module: Platform Core
- Agent type: Explorer first, Worker after server guards
- Write scope:
  - Explorer: none
  - Worker later: `public/admin.html`
- Source:
  - `docs/screen-compliance-map.md`
  - `docs/agent-assignment-matrix.md`
  - `public/admin.html`
- Acceptance:
  - `admin.html` core ownership is limited to settings, users, database, and audit.
  - Machines, drivers, price list, portal links, and intake review have follow-up module tasks.
  - No UI split is shipped before the matching server route guards exist.
  - Split decision and phased migration plan are recorded in
    `docs/admin-shell-split-plan.md`.

### S1-03: Remove Spoofable Privileged Role Fallback

- Status: `done`
- Owner module: Platform Core / Security
- Agent type: Worker
- Write scope:
  - `server.js`
  - `public/auth-client.js`
  - `public/nav.js`
  - tests
- Source:
  - `docs/security-rollout.md`
  - `docs/permission-registry.md`
- Acceptance:
  - Privileged routes do not trust `x-user-role`.
  - Verified JWT identity is used for role checks.
  - Tests prove spoofed header access fails.
  - Remaining work: staging plan exists for pages not yet auth-compatible.

### S1-04: Deployment Secret And Enforcement Plan

- Status: `done`
- Owner module: Platform Core / DevOps
- Agent type: Explorer
- Files:
  - `docs/sprint-1-security-plan.md`
  - `render.yaml` only after approval
- Source:
  - `render.yaml`
  - `docs/security-rollout.md`
  - `docs/data-safety.md`
- Acceptance:
  - Stable `JWT_SECRET` requirement documented and added to `render.yaml` with `generateValue: true`.
  - Retired `AUTH_ENFORCEMENT` as a misleading deployment lever; route guards
    now enforce JWT directly and `test/route-auth-coverage.test.js` prevents
    unguarded active `/api/*` routes.
  - Rollback plan references database backup and PIN migration.

### S1-05: Protect Settings, Audit, Database Admin, Finance

- Status: `done`
- Owner module: Platform Core / Finance / Security
- Agent type: Worker
- Write scope:
  - `server.js`
  - tests
- Source:
  - `docs/api-registry.md`
  - `docs/permission-registry.md`
- Acceptance:
  - Settings/admin DB endpoints require admin.
  - Audit log requires manager/admin.
  - Finance-sensitive endpoints require finance/manager/admin per decided role
    model.
  - `requireAnyRole()` exists for non-hierarchical role sets such as
    finance/manager/admin.
  - Tests cover `requireAnyRole()` allowed and denied behavior.

### S1-06: Protect Order Approval And ERP Commitments

- Status: `done`
- Owner module: Orders / Security
- Agent type: Worker
- Write scope:
  - `server.js`
  - tests
- Source:
  - `docs/api-route-permission-map.md`
  - `docs/permission-registry.md`
  - `docs/sprint-1-security-plan.md`
- Acceptance:
  - Order import approval requires office/manager/admin.
  - Manual internal order creation requires office/manager/admin.
  - Generic internal order creation requires office/manager/admin.
  - Intake approval/rejection requires office/manager/admin.
  - Order status changes require office/production/manager/admin.
  - Order lock/unlock requires manager/admin.
  - Priority sync requires manager/admin.
  - Route guard count updated to 37 protected routes in `docs/api-route-permission-map.md`.

### S1-07: Customer Portal Auth Decision

- Status: `done`
- Owner module: External Portals / Security
- Agent type: Explorer
- Files:
  - `docs/customer-portal-auth-decision.md`
- Source:
  - `public/customer.html`
  - `public/portal.html`
  - `server.js`
  - `docs/screen-compliance-map.md`
  - Acceptance:
    - Decide whether customer access is OTP, magic link, signed portal token, or customer account login.
    - Decide whether `customer.html` and `portal.html` merge.
    - Define ownership checks for `/api/c/*`.
    - `customer.html` is the active customer portal; `portal.html` is
      deprecated until rebuilt on a scoped public endpoint.
    - `test/security-routes.test.js` verifies customer A vs customer B
      ownership for order detail and portal approval.
    - `/api/c/auth` issues an OTP instead of a portal token; `/api/c/auth/verify`
      returns the token only after successful one-time-code verification.
    - Staff can rotate or revoke customer portal links; revoked/expired links
      are rejected by customer-scoped endpoints.

### S1-08: Protect Production Mutations

- Status: `done`
- Owner module: Production / Security
- Agent type: Worker
- Write scope:
  - `server.js`
  - tests
- Source:
  - `docs/api-route-permission-map.md`
  - `docs/permission-registry.md`
  - `docs/sprint-1-security-plan.md`
- Acceptance:
  - Item status and machine mutations require production/kiosk/manager/admin as appropriate.
  - Machine configuration/delete actions require manager/admin.
  - Shift and machine-stop mutations require production/manager/admin.
  - Route guard count updated to 54 protected routes in `docs/api-route-permission-map.md`.

### S1-09: Security Verification

- Status: `done`
- Owner module: Platform Core / Security
- Agent type: Verifier
- Files:
  - `docs/security-verification-report.md`
- Source:
  - `server.js`
  - `test/*.test.js`
  - `docs/api-route-permission-map.md`
- Acceptance:
  - Anonymous and wrong-role behavior is verified for all P0 families protected in Sprint 1.
  - Remaining unprotected P0 families are explicitly listed.
  - Static verification report exists in `docs/security-verification-report.md`.
  - Request-level integration tests exist for representative protected P0 route
    families using a temporary SQLite database.
  - Audit log, admin database, customer base read/write, customer pricing/token,
    order reads/documents, order import preview, customer portal ownership,
    finance, order mutation, and production item-status routes have HTTP
    anonymous/wrong-role/allowed-role coverage.
  - Intake parse/log/file/BVBS routes have HTTP anonymous/wrong-role/allowed-role
    coverage; training writes are restricted to manager/admin.
  - Dashboard/KPI/report/search/export/alert routes have HTTP anonymous,
    wrong-role where applicable, and allowed-role coverage.
  - `/api/health` remains public but no longer returns order counts.
  - Production read routes, logistics, inventory, package, and delivery-note
    routes have HTTP anonymous/wrong-role/allowed-role coverage.
  - Quality, maintenance, incident, NCR, CAPA, LOTO, and PM schedule routes
    have HTTP anonymous/wrong-role/allowed-role coverage.
  - Catalog, companies/holdings, projects/sites, price-list/steel-prices,
    purchase-order, Priority status, and AI prediction routes have HTTP
    anonymous/wrong-role/allowed-role coverage.
  - Cost snapshot reads are protected by finance/manager/admin and covered by
    the finance route test.
  - Auth logout session semantics and WhatsApp webhook verify/signature
    behavior have request-level coverage.
  - Request-level coverage and static client contract tests now cover the
    Sprint 1 security foundation. Browser smoke tests remain as Sprint 2
    runtime verification, not a blocker for closing Sprint 1 security work.

## Sprint 2: Shared Runtime Contracts

Goal:

- Stop pages from inventing their own shell, auth, rendering, and status logic.

### S2-01: Shared Frontend Safety Helpers

- Status: `done`
- Owner module: Design System
- Agent type: Worker
- Write scope:
  - new shared helper file under `public/`
  - high-risk screens only in first patch
- Source:
  - Volume ח׳
  - `docs/screen-registry.md`
- Acceptance:
  - Shared escaping helper exists.
  - Admin intake, customer CRM, orders list, and dashboard high-risk rendering
    load the shared helper.
  - Client contract tests prevent those high-risk screens from dropping the
    shared helper.
  - `npm test` passes with 46 tests.

### S2-02: Shared Status Constants

- Status: `done`
- Owner module: Orders / Production
- Agent type: Worker
- Write scope:
  - server-side constants
  - relevant tests
- Source:
  - Volume א׳
  - Volume ד׳
  - `docs/event-registry.md`
- Acceptance:
  - Order and production item statuses are defined in the shared server-side
    `status-contracts.js` module.
  - Tests cover allowed transitions and invalid transitions.
  - Initial order status contract exists in `status-contracts.js` and server
    route validation delegates to it.
  - `npm test` passes with 49 tests.

## Sprint 3: Orders And Production Truth

Goal:

- Make approved production work a single source of truth.

### S3-01: Dashboard Uses Production Queue Source

- Status: `done`
- Owner module: Production / Dashboard
- Agent type: Worker
- Write scope:
  - `public/dashboard.html`
  - possibly `/api/dashboard` or production queue route
  - tests if route changes
- Source:
  - `docs/api-registry.md`
  - `docs/screen-registry.md`
- Acceptance:
  - Dashboard no longer derives production queue from recent orders.
  - Pending/unapproved orders do not appear as production work.
  - Client contract test guards the dashboard against reverting to
    `dashData.recentOrders` as the queue source.
  - `npm test` passes with 50 tests.

## Sprint 4: Admin Shell Decomposition

Goal:

- Stop `admin.html` from acting as the owner of unrelated modules.
- Move mixed admin tabs into module-owned work with clear route contracts.

### S4-01: Move Customer Portal Link Admin To CRM

- Status: `done`
- Owner module: CRM / External Portals
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - `public/customers.html`
  - `test/client-auth-contract.test.js`
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/customer-portal-auth-decision.md`
- Acceptance:
  - CRM remains the owner of customer portal link copy/rotate/revoke.
  - `admin.html` no longer contains customer portal link search/management UI.
  - Tests keep CRM rotate/revoke wiring in place.
  - `npm test` passes with 52 tests.
  - Headless Edge smoke passes for login, admin, dashboard, customers, and
    orders.

### S4-02: Move Price List Admin Out Of Platform Admin

- Status: `done`
- Owner module: Finance / Pricing
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - `public/finance.html` or a new pricing screen
  - route contract tests if API use changes
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/api-route-permission-map.md`
- Acceptance:
  - Price list management is owned by Finance/Pricing.
  - Platform admin has no pricing mutation UI.
  - Finance/manager/admin permission contract remains enforced.
  - `npm test` passes with 52 tests.
  - Headless Edge smoke includes the finance screen.

### S4-03: Move Driver Admin To Delivery Module

- Status: `done`
- Owner module: Delivery / Logistics
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - `public/driver.html` or a new delivery-admin screen
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/screen-compliance-map.md`
- Acceptance:
  - Driver CRUD is not owned by Platform Core admin.
  - Driver module has a clear internal admin surface separate from driver portal.
  - Navigation exposes the internal delivery admin screen separately from the
    driver PWA.
  - `npm test` passes with 53 tests.
  - Headless Edge smoke includes the delivery admin screen.

### S4-04: Move OCR Intake Training To Intake Module

- Status: `done`
- Owner module: Intake / AI
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - a new or existing intake review screen
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/api-route-permission-map.md`
- Acceptance:
  - OCR training and pending intake review are not mixed into Platform Core admin.
  - Intake review remains office/manager/admin protected.
  - Navigation exposes the intake screen separately from platform admin.
  - `npm test` passes with 54 tests.
  - Headless Edge smoke includes the intake screen.

### S4-05: Move Machine And Workstation Setup To Production Setup

- Status: `done`
- Owner module: Production / Maintenance
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - `public/machine.html`, `public/production-queue.html`, or a new setup screen
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/screen-compliance-map.md`
- Acceptance:
  - Machine/workstation setup is not owned by Platform Core admin.
  - Production and maintenance ownership boundaries are explicit.
  - Navigation exposes a dedicated production setup screen.
- `npm test` passes with 55 tests.
- Headless Edge smoke includes the production setup screen.

### S4-06: Clean Platform Admin Cross-Module Shortcuts

- Status: `done`
- Owner module: Platform Core / Navigation
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - `test/client-auth-contract.test.js`
- Source:
  - `docs/admin-shell-split-plan.md`
  - `docs/screen-compliance-map.md`
- Acceptance:
  - Platform admin quick links target module admin surfaces instead of field
    operator/PWA pages.
  - Dead Admin CSS for machine/workstation management is removed.
  - Contract test prevents quick links from regressing to direct machine,
    kiosk, or driver field screens.
  - `npm test` passes with 57 tests.

## Sprint 5: Core Operations State And Screen Ownership

Goal:

- Make orders and production run from one lifecycle contract instead of
  duplicated page-specific status logic.
- Keep order entry, order management, production queue, machine, kiosk, and
  worker screens module-owned and sellable.

### S5-01: Audit Order And Production Status Usage

- Status: `done`
- Owner module: Orders / Production
- Agent type: Explorer
- Write scope:
  - docs only unless a defect is proven
- Source:
  - `status-contracts.js`
  - `docs/screen-compliance-map.md`
  - `docs/module-inventory.md`
  - `public/orders.html`
  - `public/index.html`
  - `public/production-queue.html`
  - `public/machine.html`
  - `public/kiosk.html`
  - `server.js`
- Acceptance:
  - Every status string or transition in Orders/Production screens is mapped to
    `status-contracts.js` or marked as a gap.
  - Duplicated status labels/transitions are listed with file and line evidence.
  - Follow-up implementation tasks have disjoint write scopes.
- Output:
  - `docs/s5-status-usage-audit.md`

### S5-02: Make Orders Screen Follow Shared Status Contract

- Status: `done`
- Owner module: Orders
- Agent type: Worker
- Write scope:
  - `public/orders.html`
  - focused status contract tests
- Source:
  - output of S5-01
  - `docs/s5-status-usage-audit.md`
  - `status-contracts.js`
  - `docs/api-route-permission-map.md`
- Acceptance:
  - Order status labels/actions come from the shared contract or a local adapter
    that is tested against it.
  - Unsafe order table/detail rendering is reduced or routed through
    `IronBendSafe`.
  - No production-only mutation is introduced in `orders.html`.
  - `npm test` passes.
- Progress:
  - Added `public/status-contracts-client.js` as the browser-side order/item
    status adapter.
  - `public/orders.html` now renders status filters, row/card transition
    buttons, and detail transition buttons from the shared transition contract.
  - API-sourced order detail fields in `public/orders.html` now use escaping
    helpers before `innerHTML` rendering.
  - `npm test` passes with 59 tests.
  - Headless Edge smoke includes `orders.html`.

### S5-03: Make Order Creation A Pure Order Entry Screen

- Status: `done`
- Owner module: Orders / Intake boundary
- Agent type: Worker
- Write scope:
  - `public/index.html`
  - tests if contracts change
- Source:
  - output of S5-01
  - `docs/s5-status-usage-audit.md`
  - `docs/screen-compliance-map.md`
  - `docs/api-route-permission-map.md`
- Acceptance:
  - Manual order entry remains in `index.html`.
  - Intake/OCR review/training remains in `intake.html`.
  - Order creation has clear loading, validation, empty/error, and permission
    failure states.
  - `npm test` passes.
- Progress:
  - Success copy in `public/index.html` now says the order is waiting for
    approval before production instead of claiming it was sent to the production
    queue.
  - Contract test prevents the old misleading production-queue message from
    returning.

### S5-04: Align Production Queue, Machine, Kiosk, And Worker Flows

- Status: `done`
- Owner module: Production
- Agent type: Worker
- Write scope:
  - `public/production-queue.html`
  - `public/machine.html`
  - `public/kiosk.html`
  - `public/worker.html`
  - `public/worker-visual.html`
  - focused tests if contracts change
- Source:
  - output of S5-01
  - `docs/s5-status-usage-audit.md`
  - `status-contracts.js`
  - `docs/module-inventory.md`
  - `docs/permission-registry.md`
- Acceptance:
  - Production screens share item/order status language.
  - Kiosk/worker flows have an explicit auth mode and do not assume internal
    admin navigation.
  - Machine assignment/completion actions are permission-backed.
  - `npm test` passes and Edge smoke covers the affected screens where feasible.
- Progress:
  - `public/machine.html` assignment queue now uses `/api/production-queue`
    instead of deriving work from `/api/orders?status=...`.
  - `public/machine.html` now loads `auth-client.js` and `safe-dom.js` before
    shared navigation.
  - `public/machine.html` and `public/production-queue.html` now use the shared
    `ITEM_STATUS` client contract for waiting, in-production, and done actions.
  - `public/kiosk.html` and `public/worker-visual.html` now source completion
    status values from the same shared `ITEM_STATUS` client contract.
  - `public/kiosk.html` now loads operators from `/api/kiosk/operators` instead
    of the admin-only `/api/users` route.
  - Kiosk PIN confirmation now authenticates through `/api/auth/login`, stores
    the returned session through `IronBendAuth.storeSession()`, and no longer
    checks `op.pin` in browser code.
  - `/api/kiosk/operators` exposes only safe operator fields and never returns
    `pin` or `pin_hash`.
  - Kiosk role access now covers the production-station routes the kiosk screen
    actually uses: machines, shifts, downtime reasons, machine stops, production
    queue, item status/waste updates, alerts, and tons-today KPI.
  - Security and client contract tests cover the kiosk operator list, PIN login
    flow, no `/api/users` regression, no browser `op.pin` check, and kiosk
    production-station mutations.
  - Headless Edge smoke now includes `machine.html` and
    `production-queue.html`.
  - `npm test` passes with 64 tests.

## Sprint 6: Procurement And Warehouse Ownership

Goal:

- Turn procurement and warehouse workflows from partial/demo screens into
  sellable internal modules with clear ownership and API-backed state.

### S6-01: Convert Procurement From Stub To API-Backed MVP

- Status: `done`
- Owner module: Inventory / Procurement
- Agent type: Worker
- Write scope:
  - `public/procurement.html`
  - `server.js`
  - focused tests if contracts change
- Source:
  - `docs/spec-gap-matrix.md`
  - `docs/screen-registry.md`
  - `routes/inventory.js` purchase-order, supplier, and steel-price routes
- Acceptance:
  - Procurement screen no longer presents itself as a coming-soon stub.
  - Purchase orders, suppliers, and steel prices load from APIs without silent
    demo fallback data.
  - New purchase orders send server field names and refresh from the API after
    creation.
  - Receiving purchase orders sends server field names and lets the server write
    raw-material inventory.
  - Supplier create/update uses the real supplier API.
  - Steel price updates send server field names and refresh from the API.
  - `npm test` passes.
- Progress:
  - Removed the `BUG-47` stub marker and coming-soon banner from
    `public/procurement.html`.
  - Added `auth-client.js` and `safe-dom.js` before shared navigation.
  - Removed procurement demo data arrays and added API normalization for purchase
    orders, suppliers, and steel prices.
  - Fixed purchase-order create, receive, supplier create/update, and steel-price
    update payloads to match server routes.
  - `server.js` purchase-order create now accepts an explicit status and defaults
    to `pending`.
  - Contract and app smoke tests prevent regression to demo/stub procurement.
  - `npm test` passes with 65 tests.

### S6-02: Stop Warehouse Mock Fallbacks And Restore Authenticated API Loading

- Status: `done`
- Owner module: Inventory / Delivery boundary
- Agent type: Worker
- Write scope:
  - `public/warehouse.html`
  - focused tests if contracts change
- Source:
  - `docs/module-inventory.md`
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
- Acceptance:
  - Warehouse does not silently show mock package, delivery, supplier, or receipt
    data when API calls fail.
  - Warehouse loads the shared auth fetch wrapper before protected API calls.
  - Warehouse empty/error states reflect real API state instead of demo state.
  - `npm test` passes and Edge smoke covers warehouse.
- Progress:
  - Added `auth-client.js` and `safe-dom.js` before warehouse inline logic.
  - Removed mock fallback package, delivery, supplier, and receipt data.
  - Failed package/delivery/supplier/inventory calls now leave real empty/error
    states instead of pretending the workflow succeeded.
  - Added warehouse to app smoke and Edge smoke.
  - Contract test prevents mock logistics fallbacks from returning.
  - `npm test` passes with 66 tests.

### S6-03: Freeze Supplier Portal Demo Until Supplier Auth Exists

- Status: `done`
- Owner module: Procurement / Supplier portal boundary
- Agent type: Worker
- Write scope:
  - `public/supplier.html`
  - focused tests
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
- Acceptance:
  - Supplier portal does not expose hard-coded demo suppliers.
  - Supplier portal does not call unsupported supplier-code purchase-order APIs.
  - Supplier portal does not optimistically mark ETA/certificate workflows as
    successful without a real supplier-authenticated server contract.
  - Internal supplier work remains routed through procurement until supplier auth
    and external access rules are defined.
- Progress:
  - Removed the demo supplier lookup from `public/supplier.html`.
  - Replaced supplier-code entry with an explicit frozen-state message that points
    work back to the internal procurement screen.
  - Disabled fake ETA/certificate success flows for the external supplier portal.
  - Added a contract test preventing demo supplier data and unsupported supplier
    endpoints from returning.

### S6-04: Align Driver Portal With Auth And Delivery Status Contracts

- Status: `done`
- Owner module: Delivery / Driver portal boundary
- Agent type: Worker
- Write scope:
  - `public/driver.html`
  - focused tests
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/fleet.js` delivery routes
- Acceptance:
  - Driver portal loads authenticated API wrapper before calling protected driver
    and delivery APIs.
  - Driver portal treats both `ממתין` and `מתוכנן` as departable statuses to
    match the server route.
  - API-sourced delivery fields are escaped before `innerHTML` rendering.
  - Delivery confirm/problem modals do not close as success when the server
    rejects the action.
- Progress:
  - Added `auth-client.js`, `safe-dom.js`, and status contract loading to
    `public/driver.html`.
  - Added delivery status constants for the server statuses used by
    `/api/deliveries`.
  - Escaped driver and delivery fields before card rendering.
  - Added error states for driver/delivery loading and failed delivery actions.
  - Added a contract test preventing regression to the old unauthenticated/unsafe
    driver portal behavior.

### S6-05: Stop Shared Sidebar Logo Distortion

- Status: `done`
- Owner module: Shared shell / UX
- Agent type: Worker
- Write scope:
  - `public/nav.js`
  - `public/theme.css`
  - focused tests
- Source:
  - Edge smoke screenshots
- Acceptance:
  - Shared Tene logo keeps its SVG aspect ratio in top nav, desktop sidebar, and
    drawer.
  - A contract test prevents returning to fixed logo heights that distort the SVG.
- Progress:
  - Replaced fixed logo heights with `height:auto` in shared nav CSS.
  - Adjusted desktop sidebar logo width to fit the 124px sidebar without squeezing.
  - Added a contract test for the shared navigation logo aspect ratio.
  - Edge smoke passed after the change.

## Sprint 7: Stub Governance And Commercial Module Readiness

- Goal:
  - Every visible module must be either API-backed MVP, explicitly frozen, or
    removed from commercial navigation until its workflow contract exists.

### S7-01: Convert Maintenance From Stub To API-Backed Internal Module

- Status: `done`
- Owner module: Maintenance
- Agent type: Worker
- Write scope:
  - `public/maintenance.html`
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/quality.js` maintenance, LOTO, and PM routes
- Acceptance:
  - Maintenance screen no longer displays itself as a coming-soon stub.
  - Maintenance, LOTO, PM, and machine health sections do not fall back to mock
    machine/log/LOTO/PM data when API calls fail.
  - Maintenance loads the shared auth wrapper before protected API calls.
  - App smoke and Edge smoke include the maintenance screen.
- Progress:
  - Removed the `BUG-47` stub marker and coming-soon banner from
    `public/maintenance.html`.
  - Added `auth-client.js` and `safe-dom.js` to the maintenance screen.
  - Removed `mockMachines`, `mockStats`, `mockLogs`, `mockLoto`, and `mockPm`.
  - API failures now leave real empty/error states instead of demo records.
  - Added contract coverage and smoke coverage for maintenance.

### S7-02: Convert Projects/Sites From Stub To Internal MVP

- Status: `done`
- Owner module: Projects / Sites
- Agent type: Worker
- Write scope:
  - `public/projects.html`
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/customers.js` project/site routes and `routes/finance.js` credit routes
- Acceptance:
  - Projects screen no longer displays itself as a coming-soon stub.
  - Projects screen loads the shared auth wrapper and safe DOM helper.
  - Projects screen owns projects/sites only and does not expose finance credit
    workflows.
  - App smoke and Edge smoke include the projects screen.
- Progress:
  - Removed the `BUG-47` stub marker and coming-soon banner from
    `public/projects.html`.
  - Added `auth-client.js` and `safe-dom.js` before shared navigation.
  - Removed the credit tab, credit modal, and `/api/credit` calls from the
    projects screen.
  - Kept projects/sites backed by `/api/projects`, `/api/sites`, and customer
    dropdown data.
  - Added contract and smoke coverage for projects.

### S7-03: Convert War Room From Mock Stub To API-Backed Internal Monitor

- Status: `done`
- Owner module: Quality / Maintenance incident monitor
- Agent type: Worker
- Write scope:
  - `public/warroom.html`
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/quality.js` incident routes and `routes/production.js` machine/OEE routes
- Acceptance:
  - War Room no longer displays itself as a coming-soon stub.
  - War Room loads shared auth and safe DOM helpers before protected API calls.
  - War Room does not fall back to local mock machines, OEE, active incidents, or
    resolved incident data.
  - Incident create/update/close operations report server errors instead of
    pretending a local-only event was saved.
  - App smoke and Edge smoke include War Room.
- Progress:
  - Removed the `BUG-47` stub marker and coming-soon banner from
    `public/warroom.html`.
  - Added `auth-client.js` and `safe-dom.js`.
  - Removed local mock machines, OEE, active incidents, and resolved incidents.
  - Normalized incident API fields from server shape to client rendering shape.
  - Changed incident create/update/close flows to use server payload fields
    (`machine_id`, `description`, `assigned_to`, `financial_impact`,
    `update_text`) and reload from API after success.
  - Added contract and smoke coverage for War Room.

### S7-04: Remove Quality NCR/CAPA Demo Persistence

- Status: `done`
- Owner module: Quality
- Agent type: Worker
- Write scope:
  - `public/quality.html`
  - `routes/quality.js` CAPA patch route
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/quality.js` quality, NCR, and CAPA routes
- Acceptance:
  - Quality screen loads the shared auth wrapper and safe DOM helper.
  - NCR/CAPA lists use `/api/ncr` and `/api/capa` only and do not seed demo
    records when the API fails.
  - NCR/CAPA create and update flows do not add local-only records or silently
    swallow server failures.
  - App smoke and Edge smoke include Quality.
- Progress:
  - Added `auth-client.js` and `safe-dom.js` to `public/quality.html`.
  - Removed local NCR/CAPA demo generators and local ID counters.
  - Normalized server NCR/CAPA rows into the client rendering shape.
  - Changed create/update flows to save through the server and reload from API
    after success.
  - Extended CAPA patch support for detail fields used by the screen.
  - Added contract and smoke coverage for Quality.

### S7-05: Bring Reports Into Auth/Safe Smoke Coverage

- Status: `done`
- Owner module: Dashboard / Reports
- Agent type: Worker
- Write scope:
  - `public/reports.html`
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/reports.js` report routes and `routes/production.js` OEE/machine efficiency routes
- Acceptance:
  - Reports screen loads shared auth and safe DOM helpers before navigation.
  - API-sourced customer, order, machine, and shape fields are escaped before
    table/card rendering.
  - Reports is included in app smoke and Edge smoke.
- Progress:
  - Added `auth-client.js` and `safe-dom.js` to `public/reports.html`.
  - Added escaping and number normalization around report table/card renderers.
  - Added contract coverage for report auth/safe loading and API field escaping.
  - Added Reports to app smoke and Edge smoke.

### S7-06: Harden Finance Rendering And Failure States

- Status: `done`
- Owner module: Finance
- Agent type: Worker
- Write scope:
  - `public/finance.html`
  - focused contract coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `routes/finance.js`, `routes/catalog.js`, and `routes/inventory.js` finance/pricing/cost/ledger routes
- Acceptance:
  - Finance loads the shared auth and safe DOM helpers before protected API use.
  - Customer, order, supplier, and selection labels rendered from APIs are escaped.
  - Steel price, order, customer, and cost recalculation failures show visible
    failure states instead of silently swallowing errors.
- Progress:
  - Added `safe-dom.js` and an `escH` helper to `public/finance.html`.
  - Escaped top-customer, low-margin order, ledger order, and status rendering.
  - Added safe runtime overrides for steel prices, order selector, customer
    selector, and order cost recalculation.
  - Added contract coverage so Finance remains in the high-risk safe-DOM set.

### S7-07: Remove Login Demo Copy And Silent Queue KPI Failure

- Status: `done`
- Owner module: Auth / Production Queue
- Agent type: Worker
- Write scope:
  - `public/login.html`
  - `public/production-queue.html`
  - focused contract coverage
- Source:
  - `public/auth-client.js`
  - `routes/auth.js` auth routes and `routes/production.js` production KPI routes
- Acceptance:
  - Login screen does not advertise demo credentials or demo login mode.
  - Login still stores sessions through the shared auth client.
  - Production queue does not silently swallow tons KPI failure.
- Progress:
  - Removed the visible demo PIN hint and stale demo-mode comment from
    `public/login.html`.
  - Added a visible failure state for tons KPI loading in
    `public/production-queue.html`.
  - Added contract coverage for both regressions.

### S7-08: Make Admin ERP Connector Availability Explicit

- Status: `done`
- Owner module: Platform Admin / Integrations
- Agent type: Worker
- Write scope:
  - `public/admin.html`
  - focused contract coverage
- Source:
  - `docs/admin-shell-split-plan.md`
  - `routes/admin.js` settings and integration test routes
- Acceptance:
  - Platform Admin does not show demo company placeholders for ERP setup.
  - Unimplemented ERP connector tests are disabled and labelled as planned
    connectors rather than active "in development" actions.
  - Contract coverage prevents reintroducing demo placeholders or `alert`-based
    fake test actions.
- Progress:
  - Replaced the Priority company `demo` placeholder with a neutral company
    placeholder.
  - Disabled SAP B1 and Maven selector buttons until official connectors exist.
  - Replaced the Hashavshevet fake test alert with a disabled control and clear
    tooltip.
  - Added contract coverage for Admin ERP connector availability.

### S7-09: Bring Inventory Into Auth/Safe Smoke Coverage

- Status: `done`
- Owner module: Inventory
- Agent type: Worker
- Write scope:
  - `public/inventory.html`
  - focused tests and smoke coverage
  - registry docs
- Source:
  - `docs/screen-registry.md`
  - `docs/spec-gap-matrix.md`
  - `routes/inventory.js` inventory/supplier routes and `routes/reports.js` waste routes
- Acceptance:
  - Inventory screen loads shared auth and safe DOM helpers before navigation.
  - Inventory, supplier, and waste sections use protected API routes and safe
    escaping for rendered API text.
  - Supplier dropdown failures show a visible failure state instead of silently
    swallowing errors.
  - App smoke and Edge smoke include Inventory.
- Progress:
  - Added `auth-client.js` and `safe-dom.js` to `public/inventory.html`.
  - Routed `escH` through `IronBendSafe.escapeHtml`.
  - Added safer response handling and visible supplier-loading failures.
  - Added contract coverage plus app and Edge smoke coverage for Inventory.

## Agent Assignment Rules

Every agent prompt must include:

1. Module owner.
2. File write scope.
3. Source docs.
4. Non-goals.
5. Acceptance checks.
6. Whether code edits are allowed.
7. Reminder that other agents/users may have changed files and nothing unrelated
   should be reverted.

Use `docs/agent-task-template.md` for all future agent prompts.
