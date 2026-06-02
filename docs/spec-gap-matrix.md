# Specification Gap Matrix

This matrix compares the extracted specification requirements against the
current `tene-industry` codebase at a recovery-planning level. It is not a full
line-by-line compliance audit yet; it is the first management map that tells us
where to send agents and what order to work in.

Status legend:

- `Missing`: no reliable implementation found.
- `Partial`: some code exists, but it does not satisfy the specification.
- `Present`: implementation exists and appears aligned at planning level.
- `Freeze`: future/strategic item; do not build before the platform is stable.

## Platform And Governance

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| One Entity Registry | Entities are implicit in SQLite schema creation inside `server.js`. | Missing | Create `docs/entity-registry.md` first; later extract schema ownership by module. |
| One Screen Registry | Screens are standalone `public/*.html`; no central registry. | Missing | Create screen registry from `module-inventory.md`; every screen gets owner, status, route, auth mode. |
| One API Registry | Routes are all in `server.js`; no formal registry. | Missing | Generate API registry from `server.js` and assign every route to a module. |
| One Permission Registry | `ROLE_PERMISSIONS` exists, but enforcement is partial. | Partial | Sprint 1: central permission matrix and tests. |
| Universal Audit/Event Trail | `auditLog` and WebSocket events exist for some flows, not all important actions. | Partial | Define event contract before broad refactors. |
| Versioning and feature flags | Some env feature flags exist for AI/Priority/auth. | Partial | Keep feature flags; add module-level product flags later. |
| Offline and fail-safe | Service worker and offline files exist, but fail-safe workflows are not systematic. | Partial | Treat as Sprint 4/5 after auth and state machines. |

## Security And Access

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| No critical action without identity | `AUTH_ENFORCEMENT` defaults false. | Partial | P0. Finish auth rollout before feature work. |
| Role checks cannot be spoofed | Guarded routes now require JWT-derived identity; browser clients strip `x-user-role`/`x-user-id`. Unguarded route families remain separately tracked. | Partial | P0. Continue adding route guards and request-level tests for remaining P0 families. |
| User management admin-only | `/api/users` routes are not protected consistently. | Missing | First security agent task. |
| Stable JWT secret in deployment | `render.yaml` has generated `SESSION_SECRET`, but no `JWT_SECRET`. | Missing | Add deployment checklist and configure environment. |
| Public portal identity | Customer portal can issue portal token from phone. | Partial | Design OTP/magic-link before commercial release. |
| CSRF/headers/rate limits | Login/image have rate limits; no global API/admin rate model seen. | Partial | Sprint 1b hardening. |

## Orders

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| Full order lifecycle workflow | Orders, pallets, items, statuses exist. | Partial | Keep, but formalize state machine and owner module. |
| Document intake with source preservation | Intake/OCR/import flows exist partially. | Partial | Freeze AI/OCR expansion until auth + approval flow are safe. |
| Every status change audited | Order status route audits; not all lifecycle events appear covered. | Partial | Add tests and event contract. |
| Project/site/customer context | Projects/sites screen is API-backed MVP; customer CRM remains separate. | Partial | Define deeper project/order/site reporting rules before commercial release. |
| Approval before production | `/api/production-queue` filters approved statuses. | Partial | Dashboard must use same source; test unapproved exclusion globally. |

## Production

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| Machine state doctrine | Machine state endpoints exist. | Partial | Extract state constants and tests. |
| Shift lifecycle | Shift endpoints exist. | Partial | Validate against Volume D before expanding. |
| Worker/kiosk execution | Worker/kiosk screens exist. | Partial | Must define auth mode before enforcement. |
| Production queue source of truth | Dashboard uses the production queue API source. | Partial | Keep production queue contract centralized and extend status policy before commercial release. |
| Reporting visibility | Reports screen is API-backed and covered by smoke/auth/safe tests. | Partial | Define role-specific report visibility and finance data boundaries before commercial release. |
| Quality, incidents, and war room | Quality, maintenance, and warroom are API-backed internal MVP screens. | Partial | Define NCR/CAPA state policy, incident severity, escalation, ownership, and SLA policy before commercial release. |

## Inventory, Procurement, Delivery

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| Raw material inventory and receiving | Inventory and warehouse screens/routes are API-backed and covered by auth/safe smoke checks. | Partial | Separate raw-material receiving policy from delivery/package warehouse flows before commercial release. |
| Procurement workflow | Purchase order routes and procurement screen are API-backed for purchase orders, suppliers, and steel prices. | Partial | MVP includes internal procurement; continue with workflow policy, approvals, and warehouse receiving split. |
| Supplier management | Supplier routes/screen exist. | Partial | Needs portal auth and role model. |
| Delivery lifecycle | Drivers, deliveries, packages, delivery notes exist. | Partial | Centralize package/order status transitions. |

## Finance

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| Cost engine | Order cost routes exist. | Partial | Validate formulas against Volume 12. |
| Realtime profitability | Margin/KPI endpoints exist. | Partial | Protect endpoints and tie to source costs. |
| Customer ledger/credit | Ledger and credit routes exist, with overlapping credit concepts. | Partial | Resolve authoritative credit model before refactor. |
| Israeli accounting and ERP integration | Priority flags/routes exist; invoices exist. | Partial | Commercial release scope, not Sprint 1. |
| Dynamic pricing/market intelligence | Steel prices and price list exist. | Partial | Later module; keep behind governance. |

## UI/UX

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| RTL-first, role-aware, consistent shell | Shared `nav.js` and `theme.css` exist, but pages differ. | Partial | Design System Agent owns shell and helpers. |
| Each primary action appears once | Many screens contain dense inline actions and repeated concepts. | Partial | Enforce during screen rebuilds. |
| Loading/empty/error/retry states | Some screens have ad hoc states. | Partial | Add shared patterns. |
| Safe rendering | Many screens use `innerHTML` with DB/OCR/import data. | Partial | P1. Shared escaping/render helper; patch high-risk screens. |
| Tables support search/filter/sort/export by permission | Some screens do, many do not. | Partial | Add per screen during Sprint 4. |
| Mobile/tablet-first for warehouse/delivery/operator | Some screens responsive, but not uniform. | Partial | Verify screen by screen. |

## AI And Autonomy

| Spec Requirement | Current Evidence | Status | Recovery Decision |
| --- | --- | --- | --- |
| AI scheduling engine | Some AI endpoints exist; feature flags default false. | Freeze | Correctly frozen. Do not expand before reliable data and governance. |
| Explainability and rollback for AI decisions | Not implemented as a platform contract. | Missing | Future sprint after event/governance foundation. |
| Digital twin/self-healing | Not production-ready. | Freeze | Future/strategic. |

## First Recovery Backlog From Specs

1. Create `entity-registry.md`, `screen-registry.md`, `api-registry.md`,
   `event-registry.md`, and `permission-registry.md`.
2. Finish Sprint 1 security gate: stable JWT, protected user/admin/settings,
   no spoofable role fallback, auth tests.
3. Fix dashboard production queue to use the production module source of truth.
4. Add shared frontend safety helpers and patch admin intake/orders/dashboard.
5. Extract order and production status constants into one server-side source.
6. Decide portal auth model from the spec: OTP, magic link, or customer account.
7. Mark every stub module as `frozen`, `MVP`, or `commercial release`.
8. Only after the above: assign page rebuilds to module agents.

## Registry Creation Status

Created in Sprint 0:

- `docs/entity-registry.md`
- `docs/screen-registry.md`
- `docs/api-registry.md`
- `docs/event-registry.md`
- `docs/permission-registry.md`

These are first-pass planning registries generated from current code evidence.
They were compared at summary level with the downloaded registry DOCX sources:

- `C:\Users\meir-tene\Downloads\IronBend_API_Registry.docx`
- `C:\Users\meir-tene\Downloads\IronBend_Entity_Registry.docx`
- `C:\Users\meir-tene\Downloads\IronBend_Permission_Matrix.docx`

See `docs/registry-reconciliation.md` for the mismatch summary.
