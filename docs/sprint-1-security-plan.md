# Sprint 1 Security Plan

Sprint 1 goal: make the system safe enough to continue modular rebuilding and future customer sales.

This sprint does not aim to redesign the whole application. It creates the permission foundation that every later module split depends on.

## Source Of Truth

- `docs/permission-registry.md`
- `docs/api-route-permission-map.md`
- `docs/registry-reconciliation.md`
- `docs/agent-assignment-matrix.md`
- `docs/role-model-decision.md`
- `server.js`
- `auth-core.js`
- `test/auth-core.test.js`
- `IronBend_Permission_Matrix.docx`

## Current Security Baseline

Known current state:

- `AUTH_ENFORCEMENT` is explicitly disabled in `render.yaml` until the staging gate passes.
- `JWT_SECRET` is defined in `render.yaml` with `generateValue: true`; local development still needs an explicit secret when testing production-like auth.
- `app.use('/api', optionalAuth)` tries to decode auth but does not require it.
- `requireRole()` has been moved to `permissions.js` and no longer trusts
  `x-user-role` or `x-user-id`.
- 190 Express routes were found in `server.js`.
- 170 route declarations use direct `requireRole(...)` or `requireAnyRole(...)`.
- User management, settings, audit, admin database, finance-sensitive routes,
  order commitments, order lifecycle mutations, Priority sync, and production
  mutations are now protected. Dashboard, KPI, report, search, export, and
  alert routes are also protected. Production reads, logistics, suppliers,
  inventory, packages, delivery-note, quality, maintenance, incident, NCR,
  CAPA, LOTO, PM schedule, catalog, companies/holdings, projects/sites,
  pricing reads, purchase-order, Priority status, and AI prediction routes are
  protected. Portal bootstrap, webhooks, and several remaining module routes
  are not consistently protected yet.
  Cost snapshot reads are now included in the finance/manager/admin policy.
  Customer portal routes now have dedicated rate limits. WhatsApp webhook POST
  verifies provider signatures when `WHATSAPP_APP_SECRET` is configured.
  Logout requires an active refresh cookie or access token.
- `render.yaml` now defines a generated `JWT_SECRET` and keeps
  `AUTH_ENFORCEMENT=false` until the staging gate passes.

## Role Model Decision

The working decision is recorded in `docs/role-model-decision.md`:

| Source/current role | Working decision |
| --- | --- |
| `admin`, `manager`, `production`, `quality`, `maintenance`, `warehouse`, `driver` | Keep as internal staff roles. |
| `office`, `sales`, `viewer`, `kiosk` | Add to the internal role model from the source permission matrix. |
| `finance` | Keep as an internal finance role below manager/admin. |
| `operator` | Deprecate as top-level role; migrate to `kiosk` or `production`. |
| `customer`, `supplier` | External identities only; do not use as broad internal roles. |

Decision gate: no broad `server.js` auth refactor should contradict `docs/role-model-decision.md` without product-owner approval.

## P0 Route Families

These families must be protected before UI/module polish:

| Family | Target guard | Reason |
| --- | --- | --- |
| Users | `admin` | User creation/update controls access to the whole product. |
| Settings | `admin` | May expose or mutate integrations, secrets, and operational behavior. |
| Admin database | `admin` with real JWT enforcement | DB upload/download is full-system compromise if spoofable. |
| Audit log | `admin`/`manager` read-only | Audit data can expose user/business activity. |
| Finance/credit/costs | `manager`/`admin` plus `finance` if retained | Sensitive commercial data. |
| Customer pricing/token/ledger | `office`/`manager`/`admin`, finance for ledger if retained | Pricing and token creation are high risk. |
| Order approvals/status locks | `office`/`manager`/`admin`; production only for production states | Controls business commitments and production flow. |
| Priority sync | `manager`/`admin`, maybe office for status | External ERP mutation. |
| Production mutations | `production`/`kiosk`/`manager`/`admin` by action | Shop-floor state changes must be accountable. |
| Customer portal | customer-scoped auth, OTP bootstrap, token lifecycle, and ownership checks | Browser smoke tests still required before rollout. |

## P0 Screen Findings

Security Gate Screen Explorer confirmed the first UI risk group:

| Screen | P0 concern | Sprint 1 decision |
| --- | --- | --- |
| `login.html` | Stores access token, role, and user in browser storage; role display can mislead if treated as authority. | Server token is authoritative. Client role is display/navigation only. |
| `admin.html` | Mixed admin, machines, drivers, price list, portal links, users, DB, settings, audit, and intake workflows in one page. | Keep only settings/users/database/audit as Platform Core admin. Split the rest into module tasks after route guards. |
| `customers.html` | CRM, order history, and portal token creation live together; token creation is sensitive. | Customer token/link admin must require office/manager/admin and be visually separated from normal CRM. |
| `finance.html` | Contains sensitive margin/cost/ledger/credit data; prior client-sent `x-user-role: manager` patterns have been removed. | Keep finance permissions server-side and verify finance UI with real JWT sessions. |
| `customer.html` | Customer token stored in URL/localStorage; calls many `/api/c/*` endpoints. | Requires customer-scoped auth and ownership checks. |
| `portal.html` | Deprecated public tracking screen; no longer calls internal `/api/orders?order_num=`. | Keep deprecated until rebuilt on a scoped public tracking endpoint or merged into `customer.html`. |
| `nav.js` / `auth-client.js` | Fetch/auth behavior is now centralized in `auth-client.js`; broad nav links still need role-aware usability cleanup. | Nav role hiding is usability only, not security. |

These findings are tracked in `docs/agent-assignment-matrix.md` under `S1-01B`.

## Execution Sequence

### Gate 1: Decide Roles

Task: `S1-01A`

Output:

- Final role list.
- Mapping from current code roles to target roles.
- Decision on `finance`, `operator`, `customer`, `supplier`.

Acceptance:

- `ROLE_PERMISSIONS` can be updated without guessing.
- Route tests can create users/tokens for every needed internal role.

### Gate 2: Make Auth Enforcement Testable

Tasks: `S1-02`, `S1-03` are complete for the first protected route family.

Work:

- Add/adjust tests for authenticated route requests.
- Make user-management routes admin-only. Done for `/api/users` GET/POST and
  `/api/users/:id` PATCH.
- Replace or constrain spoofable fallback so privileged checks cannot pass via arbitrary headers. `requireRole()` now requires JWT-derived `req.auth`.
- Keep development migration workable through explicit test/dev mode, not hidden production behavior.

Acceptance:

- Anonymous requests fail on `/api/users`.
- Wrong-role requests fail on `/api/users`.
- Admin token succeeds.
- Spoofed `x-user-role: admin` does not grant admin access when production enforcement is active.

### Gate 3: Protect Platform Core

Task: `S1-05`

Routes:

- `/api/settings`
- `/api/settings/test/:service`
- `/api/audit-log`
- `/api/admin/database/download`
- `/api/admin/database/upload`
- `/api/customers/:id/token`
- `/api/customers/:id/pricing`
- `/api/order-imports/preview`
- `/api/analyze-image`
- `/api/intake/image`
- `/api/intake/email/poll`
- `/api/intake/log`
- `/api/intake/parse-text`
- `/api/intake/training`
- `/api/intake/training/:id`
- `/api/bvbs/parse`
- `/api/bvbs/create-order`

Acceptance:

- Settings write/test and DB upload/download are admin-only.
- Audit log is admin/manager read-only.
- Customer pricing and portal-token administration require office/manager/admin.
- Order import preview requires office/manager/admin.
- Intake parse/log/file/BVBS routes require office/manager/admin.
- Intake training writes require manager/admin.
- Tests cover anonymous, wrong role, correct role.

Status: complete for route guards and permission helper tests. Broader request-level integration tests can be added in the verification phase.
The first request-level integration harness now verifies `/api/settings`,
`/api/audit-log`, admin database download/upload, customer pricing/token, and
order import preview, intake parse/log/file/BVBS flows over HTTP with
anonymous, wrong-role, and allowed-role cases.

### Gate 4: Protect Money And Commitments

Tasks: `S1-05`, `S1-06`

Routes:

- `/api/finance/*`
- `/api/credit*`
- `/api/invoices*`
- `/api/orders/:id/costs*`
- `/api/orders/:id/margin`
- `/api/customers/:id/ledger`
- `/api/customers/:id/credit`
- `/api/customers/:id/pricing`
- `/api/customers/:id/token`
- `/api/customers`
- `/api/customers/:id`
- `/api/order-imports/:id/approve`
- `/api/orders`
- `/api/orders/:id`
- `/api/orders/:id/print-cards`
- `/api/orders/:id/print-a4`
- `/api/orders/:id/delivery-certificate`
- `/api/orders/:id/status`
- `/api/orders/:id/lock`
- `/api/orders/:id/unlock`
- `/api/priority/sync/:orderId`

Acceptance:

- Low-level roles cannot see or mutate finance data.
- Order status and approval mutations require appropriate internal roles.
- Finance-sensitive endpoints are not reachable anonymously.

Status: finance-sensitive endpoints are guarded by `requireAnyRole(['finance', 'manager', 'admin'])`; order approval and ERP commitment mutations are guarded by `S1-06`.
The first request-level integration harness now verifies representative finance,
order mutation, and order import preview access over HTTP.
Customer CRM base read/write and order read/document routes are also guarded and
covered by request-level anonymous, wrong-role, and allowed-role checks.

### Gate 5: Protect Production Mutations

Task: `S1-08`

Routes:

- `/api/items/:id/status`
- `/api/items/:id`
- `/api/shifts`
- `/api/shifts/:id/end`
- `/api/machine-stops`
- `/api/machine-stops/:id/end`
- `/api/machines/:id/assign`
- `/api/machines/:id/config`
- `/api/machines/:id/complete`
- `/api/machines/:id/state`
- `/api/machines/:id/end-of-day`
- `/api/scan`

Acceptance:

- Production/kiosk permissions are narrow and action-specific.
- Config/delete actions remain manager/admin.
- Tests cover at least one allowed and one denied role for each mutation group.

Status: production mutation route guards are in place for workers, machines,
scan, shifts, machine-stops, and item updates. Permission helper tests cover the
role mechanics. The first request-level integration harness verifies
`/api/items/:id/status`; broader production mutation coverage remains in
`S1-09`.

### Gate 6: Customer Portal Auth Decision

Task: `S1-07`

Output:

- Decision recorded in `docs/customer-portal-auth-decision.md`.
- Sprint 1 identity is a customer-scoped portal token.
- `customer.html` is the active customer portal product.
- `portal.html` is deprecated until it is rebuilt on a scoped public endpoint or
  merged into `customer.html`.
- Ownership checks are defined for `/api/c/orders/:orderId`, `/api/c/approve`,
  `/api/c/order`, and quote flow.

Acceptance:

- A customer cannot read another customer's order.
- A customer cannot approve/mutate without scoped proof.
- Internal roles are not accepted as customer portal identity.

Status: complete for Sprint 1 code safety. Request-level tests cover customer A
vs customer B order detail and approval, OTP verification before phone bootstrap
can issue a portal token, token rotation, token revocation, and rejection of
unauthenticated portal order creation. Remaining work before production customer
rollout: browser smoke tests and final TTL policy review.

## Testing Strategy

Use focused API tests before UI rebuild:

- anonymous request should fail for internal P0 routes
- wrong role should fail
- exact required role should pass
- higher role should pass where hierarchy is intended
- spoofed headers should not pass privileged checks
- customer portal ownership checks should include customer A vs customer B

The first new test helper should create valid access tokens through `auth-core.js` rather than relying on request headers.
That helper now exists in `test/security-routes.test.js`, starts the Express app
against a temporary SQLite database, logs in through `/api/auth/login`, and
verifies JWT role enforcement over HTTP for representative P0 routes including
users, settings, audit log, admin database, finance, order mutation, order
import preview, customer pricing/token, customer/order reads and documents,
intake parse/log/file/BVBS flows, dashboard/KPI/report/search/export/alert
routes, production reads, logistics/inventory/package/delivery-note routes,
quality/maintenance/incident/NCR/CAPA/LOTO/PM routes, public health payload
behavior, catalog/company/project/pricing/procurement/AI routes, and
production item status. It also verifies logout session semantics and WhatsApp
webhook provider verification/signature behavior.

`test/client-auth-contract.test.js` verifies the frontend auth contract: only
`auth-client.js` wraps `fetch`, `nav.js` loads that client instead of redefining
it, browser files do not send spoofable role headers, and `login.html` stores
sessions through `IronBendAuth`.

## Release Gate

Sprint 1 is complete only when:

- P0 internal route families require real authenticated roles.
- User, settings, DB, finance, order approval, and production mutation tests pass.
- The deployment configuration requires `AUTH_ENFORCEMENT=true` and a stable `JWT_SECRET`.
- External portal auth has a written accepted decision, even if implementation starts in Sprint 2.
- `docs/permission-registry.md` and `docs/api-route-permission-map.md` match the implemented role model.
