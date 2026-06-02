# Security Verification Report

Verification pass for Sprint 1 security work.

Date: 2026-06-01

## Evidence Collected

Commands run:

- `node --check server.js`
- `node --check permissions.js`
- `npm test`
- static route scan of `server.js`
- `node scripts/edge-smoke.js`

Current test result:

- 66 tests passed.
- Permission helper tests cover:
  - target role model exists
  - `operator` maps to `kiosk`
  - `customer` and `supplier` are not internal roles
  - anonymous/spoofed-header access is rejected by `requireRole()`
  - wrong role is rejected by `requireRole()`
  - admin JWT claim is accepted by `requireRole()`
  - `requireAnyRole()` accepts and rejects expected roles
- Request-level integration tests start the Express app with a temporary SQLite
  database and verify representative protected P0 routes over HTTP:
  - `/api/users`
  - `/api/settings`
  - `/api/audit-log`
  - `/api/admin/database/download`
  - `/api/admin/database/upload`
  - `/api/finance/kpis`
  - `/api/orders` mutation
  - `/api/order-imports/preview`
  - `/api/customers/:id/token`
  - `/api/customers/:id/pricing`
  - `/api/customers` and `/api/customers/:id`
  - `/api/orders`, `/api/orders/:id`, print cards, A4 print, and delivery certificate
  - `/api/intake/log`, `/api/intake/parse-text`, `/api/intake/training*`
  - `/api/analyze-image`, `/api/intake/image`, `/api/intake/email/poll`, `/api/bvbs/*`
  - `/api/dashboard`, `/api/reports/*`, `/api/waste/summary`, `/api/kpi/*`
  - `/api/alerts`, `/api/search`, `/api/export/*`
  - `/api/health` remains public but does not expose order counts
  - `/api/workers`, `/api/machines`, `/api/machines/:id/state-log`, `/api/machines/oee`
  - `/api/shifts`, `/api/downtime-reasons`, `/api/machine-stops`
  - `/api/production-queue`, `/api/production-events`
  - `/api/drivers*`, `/api/deliveries*`, `/api/suppliers*`
  - `/api/inventory*`, `/api/packages*`, `/api/delivery-notes*`
  - `/api/quality*`, `/api/maintenance*`, `/api/incidents*`
  - `/api/ncr*`, `/api/capa*`, `/api/loto*`, `/api/pm-schedule*`
  - `/api/shapes*`, `/api/companies*`, `/api/holdings`
  - `/api/priority/status`, `/api/price-list`, `/api/steel-prices`
  - `/api/projects*`, `/api/sites*`, `/api/purchase-orders*`
  - `/api/ai/*`
  - `/api/auth/logout`
  - `/api/kiosk/operators`
  - kiosk production-station mutations for shifts, stops, item status, and waste
  - `/api/intake/whatsapp` verification and provider signature behavior
  - `/api/items/:id/status` mutation
- Client auth contract tests verify:
  - `public/auth-client.js` is the only client-side `fetch` wrapper source
  - `public/nav.js` loads the auth client instead of redefining auth behavior
  - public browser files no longer send `x-user-role` or `x-user-id`
  - `login.html` stores sessions through `IronBendAuth.storeSession()`
  - `portal.html` no longer calls internal `/api/orders?order_num=...`
  - `kiosk.html` loads operators from `/api/kiosk/operators`, authenticates PIN
    through `/api/auth/login`, stores the returned session, and does not inspect
    `op.pin` in browser code
  - `procurement.html` is API-backed and no longer exposes coming-soon/demo
    procurement behavior
  - `warehouse.html` loads authenticated API data and does not mask failures with
    mock logistics/receiving data
- Customer portal ownership tests verify:
  - customer B cannot read customer A's order detail
  - customer B cannot approve customer A's order
  - valid customer token can read and approve only its own pending order
- Public-boundary tests verify:
  - logout without a refresh cookie or access token returns 401
  - logout with a valid JWT succeeds and clears the refresh cookie
  - WhatsApp webhook verification rejects a bad verify token
  - WhatsApp webhook POST requires a valid `x-hub-signature-256` when `WHATSAPP_APP_SECRET` is configured

Static route scan result:

- 190 Express routes detected.
- 170 routes have direct `requireRole(...)` or `requireAnyRole(...)` middleware.
- 20 routes remain without direct route-level auth middleware.

Important interpretation:

- The permission mechanism is tested.
- The presence of route guards is verified by static scan.
- Request-level tests now cover representative protected P0 route families, but
  not every guarded route or every still-open P0 family.

## Protected In Sprint 1

| Area | Status | Evidence |
| --- | --- | --- |
| Permission engine | Protected | `permissions.js`; `test/permissions.test.js` |
| Spoofed `x-user-role` fallback | Removed for guarded routes | `requireRole()` and `requireAnyRole()` require `req.auth`; tests prove spoofed header fails |
| Users | Protected | `/api/users` GET/POST and `/api/users/:id` PATCH require `admin` |
| Legacy user login | Disabled | `/api/users/login` returns HTTP 410 |
| Settings | Protected | `/api/settings` GET/POST and `/api/settings/test/:service` require `admin` |
| Admin database | Protected | download/upload require `admin`; upload still also has upload-specific safety middleware |
| Audit log | Protected | `/api/audit-log` requires `manager` or above through hierarchy |
| Customer CRM base routes | Protected | read uses office/sales/manager/admin; write uses office/manager/admin |
| Finance/credit/invoices/costs/margin/ledger | Protected | uses `requireAnyRole(['finance', 'manager', 'admin'])` |
| Cost snapshots | Protected | `/api/orders/:id/costs/snapshots` uses finance/manager/admin and is covered in the finance route test |
| Customer pricing/token admin actions | Protected | `/api/customers/:id/token` and `/api/customers/:id/pricing` require office/manager/admin |
| Price/steel write actions | Protected | price list PATCH and steel price POST use finance/manager/admin |
| Order commitments | Protected | order create/manual/import preview/import approve/intake approve/reject use office/manager/admin |
| Order reads and documents | Protected | order read/detail and main print/document routes require internal roles |
| Intake parse/log/file/BVBS flows | Protected | office/manager/admin for intake parsing and BVBS; manager/admin for training writes |
| Order lifecycle mutation | Protected | status change uses office/production/manager/admin |
| Order locks and Priority sync | Protected | lock/unlock/sync require manager/admin through hierarchy |
| Production setup | Protected | worker and machine create/update/config/delete require manager/admin |
| Production station actions | Protected | scan, send params, complete, end-of-day, item status, item waste, kiosk shifts, and kiosk stops use production/kiosk/manager/admin where appropriate |
| Kiosk operator auth | Protected | `/api/kiosk/operators` requires kiosk/production/manager/admin and returns no `pin` or `pin_hash`; PIN confirmation uses `/api/auth/login` |
| Production reads | Protected | workers, machines, machine state log, OEE, production queue, and production events require production/kiosk/maintenance/office/manager/admin by action |
| Shifts and machine stops | Protected | read/write/end routes use production/kiosk/maintenance/office/manager/admin as appropriate |
| Warehouse/inventory/suppliers | Protected | suppliers, inventory, inventory summary/forecast, packages, and package ship routes require warehouse/office/manager/admin |
| Drivers/deliveries | Protected | driver and delivery reads/actions require driver/warehouse/office/manager/admin; driver management requires office/manager/admin |
| Delivery notes | Protected | reads allow driver/warehouse/office/manager/admin; creation requires warehouse/office/manager/admin |
| Quality/incident/NCR/CAPA | Protected | quality checks, incidents, NCR, and CAPA require quality/production/office/maintenance/manager/admin by action |
| Maintenance/LOTO/PM | Protected | maintenance logs, LOTO, PM schedule, downtime reasons, and machine stops require maintenance/production/office/manager/admin by action |
| Catalog/shapes | Protected | shapes read requires office/sales/production/manager/admin; shape write/seed requires manager/admin |
| Companies/holdings | Protected | companies read requires office/finance/manager/admin; company writes require manager/admin; holdings require finance/manager/admin |
| Projects/sites | Protected | read requires office/sales/manager/admin; writes require office/manager/admin |
| Price list and steel prices | Protected | read requires office/sales/finance/manager/admin; writes remain finance/manager/admin |
| Purchase orders | Protected | read/create/receive require logistics roles; approval/status patch requires finance/manager/admin |
| AI prediction endpoints | Protected | manager/admin only pending data-exposure review |
| Dashboard/KPI/reports | Protected | dashboard/search/tons KPI require authenticated internal role; report/monthly KPI routes require production/office/finance/manager/admin by data sensitivity |
| Alerts/search/export | Protected | alerts/search require internal auth; exports are restricted to office/warehouse/manager/admin as appropriate |
| Health endpoint | Public minimal | public health no longer returns order counts or other business totals |
| Customer portal ownership | Protected for tested detail/approval flows | `/api/c/orders/:orderId` and `/api/c/approve` scope by portal token customer id |
| Customer portal rate limits + OTP + token lifecycle | Hardened for Sprint 1 | `/api/c/auth` and portal action routes use dedicated rate limits; phone bootstrap requires one-time OTP verification; portal tokens can expire, rotate, and be revoked |
| WhatsApp webhook boundary | Partially hardened | GET verify token and POST provider signature behavior are covered; signature enforcement activates when `WHATSAPP_APP_SECRET` is configured |
| Auth logout | Hardened | logout requires either a refresh cookie or valid JWT and is covered by HTTP tests |

## Still Open Or Partially Open

These are not safe to treat as complete.

| Area | Current gap | Priority |
| --- | --- | --- |
| Customer portal `/api/c/*` | Remaining production work is browser smoke testing and final policy review for token TTL length. | P1 |
| Public/internal portal split | `customer.html` is active; `portal.html` is deprecated until rebuilt on a scoped endpoint. | P0 |
| Intake WhatsApp webhook | Public by design for Meta verification/ingest; rate-limited and signature-verified when `WHATSAPP_APP_SECRET` is configured. Deployment must set that secret. | P0/P1 |
| Health endpoint exposure | Still public; payload is minimal, but deployment exposure should still be approved. | P2 |

## Verification Gaps

These gaps are about proof quality, not only code behavior.

- Request-level API tests exist for representative protected P0 families, but
  do not yet cover every guarded route.
- Route guard counts come from static scanning and should be backed later by
  broader integration tests.
- Remaining 20 non-role route declarations include public auth, customer-scoped
  portal, provider webhook, minimal health, custom-middleware analysis, and
  disabled legacy `if (false)` routes.
- Frontend runtime compatibility now has a latest headless Edge smoke pass for login,
  admin, dashboard, intake, production setup, finance, procurement, warehouse, delivery admin, customers, orders, machine, and production queue. Contract tests also cover the shared
  JWT fetch wrapper, removal of spoofable role headers, customer portal OTP UI
  wiring, and customer CRM link rotate/revoke UI wiring. Shared DOM safety and
  status-contract tests cover the first Sprint 2 runtime contracts.
- `AUTH_ENFORCEMENT` remains `false` in deployment until staging completes; guarded routes still require JWT because `requireRole()` and `requireAnyRole()` no longer depend on that flag.

## Sprint 1 Status

Completed:

- `S1-01` Target role model decision.
- `S1-02` User management protection.
- `S1-03` Removal of spoofable privileged role fallback for guarded routes.
- `S1-04` Deployment secret and enforcement gate.
- `S1-01C` Unified client auth contract.
- `S1-05` Settings, audit, database admin, and finance guards.
- `S1-06` Order approval and ERP commitment guards.
- `S1-07` Customer portal auth decision and initial ownership verification.
- `S1-08` Production mutation guards.
- Dashboard/KPI/report/search/export/alert guards, plus minimal public health payload.
- Public-boundary hardening for customer portal rate limits, OTP bootstrap,
  token rotation/revocation/expiry, WhatsApp signature checks, and logout session semantics.

Not complete:

- Full `S1-09` request-level verification for every protected P0 route family.
- Remaining work focuses on production deployment of `WHATSAPP_APP_SECRET`,
  broader browser smoke coverage, and broader request-level coverage.

## Recommended Next Work

1. Run browser smoke tests for the customer portal OTP flow and CRM link
   rotate/revoke actions.
2. Require `WHATSAPP_APP_SECRET` in production deployment and monitor webhook
   signature failures.
3. Extend the Express integration-test harness to every protected P0 mutation
   family, not only representative routes.
4. Extend browser smoke tests to finance, order entry, production, and customer
   portal OTP flows after the route guard changes.
5. Only then begin admin/finance/customer portal UI splitting.
