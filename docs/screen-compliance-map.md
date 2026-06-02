# Screen Compliance Map

Working map for rebuilding the frontend into modular, sellable product screens.

Source files:

- `public/*.html`
- `public/nav.js`
- `public/auth-client.js`
- `docs/screen-registry.md`
- `docs/spec-gap-matrix.md`
- Volume 8 UI/UX requirements
- Volume 10 architecture requirements

## Current Snapshot

The project currently has 28 HTML screens in `public/`.

Large or mixed-responsibility screens:

| Screen | Size | Concern |
| --- | ---: | --- |
| `admin.html` | 132,737 bytes | Mixes system settings, users, database backup/restore, intake training/logs, machines, drivers, customer links, price list. |
| `index.html` | 76,030 bytes | Order creation and intake responsibilities need clearer module ownership. |
| `dashboard.html` | 62,746 bytes | Role tabs and KPIs mixed with production queue rendering; current queue source mismatch was already found. |
| `docs.html` | 58,793 bytes | Purpose needs confirmation against the spec; may be document center or operational docs surface. |
| `procurement.html` | 56,439 bytes | Marked as future/stub-like but has substantial UI surface. |
| `quality.html` | 55,449 bytes | NCR/CAPA/checks in one screen; should keep module ownership but needs state contracts. |
| `maintenance.html` | 50,243 bytes | Large future/partial module; needs clear maintenance state model. |

Cross-cutting concerns seen in the scan:

- Many screens render API data using `innerHTML`; shared safe rendering helpers are needed before major UI expansion.
- Navigation is inconsistent: some pages use shared `nav.js`, others hard-code navigation or omit shared auth.
- Role awareness is mostly UI-only or localStorage-based in places, not backed by server authorization.
- External portal screens use ad hoc token/code patterns and need scoped portal auth.
- Several screens are module hybrids and should not be expanded until ownership is split.

## Compliance Rules

| Rule | Required outcome |
| --- | --- |
| One screen owner | Every screen has exactly one module owner. Shared widgets go into shared frontend helpers, not into random pages. |
| One primary workflow | A page can show related panels, but it must not own unrelated workflows. |
| Auth mode explicit | Each page is public, internal role-based, kiosk-scoped, customer-scoped, supplier-scoped, or driver-scoped. |
| Server permissions win | UI role hiding is not security; every sensitive API call must be backed by route authorization. |
| RTL consistency | All commercial screens must be RTL-polished, responsive, and readable on desktop/tablet/mobile as relevant. |
| Safe rendering | API-sourced strings should not be inserted through raw template `innerHTML` without escaping/sanitization. |
| Error states | Each page needs loading, empty, error, retry, and permission-denied states. |
| Sellable modules | Screens must map to optional modules so future customers can buy only the modules they need. |

## Screen Compliance Table

| Screen | Module owner | Intended user | Current status | Key API families | Compliance risk | Rebuild action |
| --- | --- | --- | --- | --- | --- | --- |
| `login.html` | Platform Core | Internal users | Active | Auth | Medium | Keep as first gate; align labels/demo text with real auth and final roles. |
| `admin.html` | Platform Core | Admin | Mixed partial | Settings, users, DB, intake, machines, drivers, price list, audit | Critical | Split into admin shell plus module tabs/pages; protect settings/users/DB first. |
| `help.html` | Platform Core | Internal users | Shared partial | Help/static | Low | Keep shared; add consistent nav/auth if internal. |
| `offline.html` | Platform Core | PWA fallback | Shared | Static/offline | Low | Keep minimal; verify no sensitive cached data is shown. |
| `dashboard.html` | Dashboard / Reports | Managers, production, office | Partial | Dashboard, KPIs, alerts, inventory forecast, production, incidents | High | Make read-only dashboard; pull queue from `/api/production-queue`; remove ownership of operational writes. |
| `reports.html` | Dashboard / Reports | Managers, office | Partial | Reports, AI, orders, margins, OEE | High | Separate finance-sensitive reports from operational reports; protect margin endpoints. |
| `holdings.html` | Dashboard / Reports | Management | Partial | Companies/holdings | Medium | Confirm commercial use; keep read-mostly management page. |
| `docs.html` | Dashboard / Reports | Internal users | Needs classification | Unknown/document workflows | Medium | Decide whether this is document center, order documents, or admin docs. Then assign owner. |
| `orders.html` | Orders | Office, sales, managers | Partial | Orders, customers, status, documents | High | Rebuild around one status model, safe table rendering, and role-aware actions. |
| `index.html` | Orders | Office/order entry | Partial | Orders, shapes, customers, intake | High | Rename/position as order creation; separate AI intake review from manual order form. |
| `customers.html` | CRM / Orders | Office, sales, managers | Partial | Customers, pricing, ledger | High | Split customer CRM, pricing overrides, and portal token management by permission. |
| `production-queue.html` | Production | Production, kiosk, managers | Active partial | Production queue, items, shifts, machine stops, users | High | Make this production source of truth; restrict shift/item mutations to production roles. |
| `machine.html` | Production | Production/maintenance | Partial | Machines, state, assign, complete | High | Define machine state contract and operator permissions. |
| `kiosk.html` | Production | Shop floor | Partial | Machines, scan, items | High | Decide kiosk auth/PIN model; keep actions narrow. |
| `worker.html` | Production | Shop floor | Tiny wrapper | Worker visual | Medium | Keep only if it routes intentionally to `worker-visual.html`; otherwise remove from nav. |
| `worker-visual.html` | Production | Shop floor | Partial | Worker/machine flows | High | Align with kiosk/production auth and shared item state model. |
| `inventory.html` | Inventory | Warehouse/office | Partial | Inventory, suppliers | Medium | Keep inventory ownership; connect to procurement/warehouse contracts. |
| `warehouse.html` | Inventory / Delivery | Warehouse | Mixed partial | Packages, deliveries, inventory, suppliers | High | Split receiving, packing/loading, and delivery handoff if workflow grows. |
| `procurement.html` | Procurement | Warehouse/procurement | Stub/partial | Purchase orders, suppliers | Medium | Decide if procurement is sellable module; then finish or hide behind feature flag. |
| `driver.html` | Delivery / Portal | Drivers | Partial | Deliveries, driver location/status | High | Convert to driver-scoped portal with own auth; no internal nav assumptions. |
| `finance.html` | Finance | Manager/finance | Partial | Finance, invoices, costs, credit | Critical | Protect before polishing; split sensitive views by role. |
| `projects.html` | Projects / Finance | Office/management | Stub/partial | Projects, sites, credit | High | Decide module owner; do not mix credit management with project page unless spec requires it. |
| `quality.html` | Quality | Quality/manager | Partial | Quality checks, NCR, CAPA | Medium | Keep module-owned; add state machine and permission-backed transitions. |
| `maintenance.html` | Maintenance | Maintenance/manager | Stub/partial | Maintenance, LOTO, PM, stops | Medium | Keep module-owned; define maintenance state model and LOTO release permissions. |
| `warroom.html` | Quality / Maintenance | Management/operations | Stub/partial | Incidents, machines, OEE | Medium | Treat as operations command center; read-mostly until incident permissions are stable. |
| `customer.html` | Customer Portal | Customers | External partial | Customer auth, quotes, orders, approve | Critical | Active portal. Token-scoped ownership checks exist for order detail/approval; still needs OTP/token lifecycle hardening. |
| `portal.html` | Customer Portal | Customers | Deprecated | Former order lookup portal | Critical | No longer calls internal order search. Rebuild on scoped endpoint or remove. |
| `supplier.html` | Supplier Portal | Suppliers | External partial | Purchase orders, ETA, receive | High | Supplier-scoped auth; receive action likely internal warehouse, not supplier. |

## Priority Rebuild Groups

### Group A: Security Gate Screens

- `login.html`
- `admin.html`
- `finance.html`
- `customers.html`
- `customer.html`
- `portal.html`

Goal: prevent selling or deploying a system where sensitive data is reachable through weak auth or mixed admin surfaces.

### Group B: Core Operations

- `orders.html`
- `index.html`
- `production-queue.html`
- `machine.html`
- `kiosk.html`
- `worker-visual.html`

Goal: one order lifecycle and one production lifecycle, with no duplicate status logic.

### Group C: Supply Chain

- `inventory.html`
- `warehouse.html`
- `procurement.html`
- `supplier.html`
- `driver.html`

Goal: separate internal warehouse work from external supplier/driver portals.

### Group D: Management And Compliance

- `dashboard.html`
- `reports.html`
- `quality.html`
- `maintenance.html`
- `warroom.html`
- `holdings.html`
- `docs.html`

Goal: read-heavy management views first, then controlled action workflows after permissions are stable.

## Agent Assignment Rules

Use one bounded agent per screen group, not one broad frontend agent.

Each agent must produce:

- APIs used by the screen.
- Current auth and target auth.
- Unsafe rendering points.
- Workflows that belong on another screen/module.
- Recommended rebuild order.
- Tests or manual checks needed.

No agent should edit code until the screen's target owner, auth mode, and API contract are accepted.

## Acceptance Checks

- Every screen maps to exactly one owner in `docs/screen-registry.md`.
- Every screen maps to an auth mode in `docs/permission-registry.md`.
- Every screen's API calls map to route families in `docs/api-route-permission-map.md`.
- Mixed screens have a split plan before new features are added.
- External portals do not share internal navigation or internal role assumptions.
