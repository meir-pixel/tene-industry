# Module Inventory

This inventory assigns the current screens and API route families to product
modules. It is intentionally practical: every future agent task should name one
module and one bounded file set from this document.

## Platform Core

Purpose:

- Identity, roles, permissions, shared shell, settings, audit, search, and
  deployment safety.

Screens:

- `public/login.html`
- `public/admin.html` for users/settings/audit only
- `public/help.html`

Shared frontend:

- `public/auth-client.js`
- `public/nav.js`
- `public/theme.css`
- `public/help.js`
- `public/sw.js`
- `public/offline.html`
- `public/offline-db.js`

Server route families:

- `/api/auth/*`
- `/api/users*`
- `/api/settings*`
- `/api/settings/test/:service`
- `/api/audit-log`
- `/api/search`
- `/api/admin/database/*`
- `/api/health`

Current risks:

- Auth enforcement is disabled.
- `requireRole()` can trust spoofable role headers while enforcement is off.
- User management routes are not consistently protected.
- Many screens do not load `auth-client.js` directly and rely on `nav.js`.

## Orders

Purpose:

- Internal order creation, import, approval, status, item/pallet structure,
  documents, and customer order history as an internal domain.

Screens:

- `public/orders.html`
- `public/index.html`
- order panels inside `public/dashboard.html`

Server route families:

- `/api/orders*`
- `/api/order-imports/*`
- `/api/items/*`
- `/api/shapes*`
- `/api/bvbs/*`
- `/api/intake/*`
- `/api/priority/*`

Current risks:

- Order statuses are Hebrew strings scattered across server and screens.
- Some order detail rendering uses unescaped database values.
- Intake/OCR review renders external content in admin.
- Priority and AI flows are partially feature-flagged and should stay frozen
  until the core flow is stable.

## Production

Purpose:

- Approved work queue, machine assignment, execution, worker/kiosk operation,
  production events, OEE, shifts, stops.

Screens:

- `public/production-queue.html`
- `public/machine.html`
- `public/kiosk.html`
- `public/worker.html`
- `public/worker-visual.html`
- production sections inside `public/dashboard.html`

Server route families:

- `/api/production-queue`
- `/api/production-events`
- `/api/machines*`
- `/api/workers*`
- `/api/scan`
- `/api/shifts*`
- `/api/downtime-reasons`
- `/api/machine-stops*`
- `/api/kpi/tons-today`
- `/api/kpi/shift-summary`
- `/api/machines/oee`

Current risks:

- Dashboard production queue uses recent orders instead of the production queue
  service.
- Machine and queue screens need one status contract.
- Kiosk/worker flows need clear auth treatment before enforcement.

## Inventory And Procurement

Purpose:

- Raw material stock, suppliers, receiving, purchase orders, forecasts, steel
  prices.

Screens:

- `public/inventory.html`
- `public/warehouse.html` for receiving/stock areas
- `public/procurement.html`

Server route families:

- `/api/suppliers*`
- `/api/inventory*`
- `/api/inventory/summary`
- `/api/inventory/forecast`
- `/api/steel-prices*`
- `/api/purchase-orders*`

Current risks:

- Procurement appears to be a partially stubbed module.
- Warehouse mixes delivery/package work with inventory receiving.
- Inventory reservation rules are not clearly separated from production demand.

## Delivery

Purpose:

- Packages, delivery notes, drivers, shipment status, route lifecycle.

Screens:

- `public/driver.html`
- delivery/package areas inside `public/warehouse.html`

Server route families:

- `/api/drivers*`
- `/api/deliveries*`
- `/api/packages*`
- `/api/delivery-notes*`
- `/api/export/packages`

Current risks:

- Driver portal and internal dispatch need different auth models.
- Package shipping can easily diverge from order status if not centralized.

## Finance

Purpose:

- Price lists, order costs, margin, credit, ledger, invoices, finance KPIs.

Screens:

- `public/finance.html`
- finance sections inside `public/reports.html`
- credit/project sections inside `public/projects.html`

Server route families:

- `/api/price-list*`
- `/api/orders/:id/margin`
- `/api/orders/:id/costs*`
- `/api/customers/:id/ledger`
- `/api/customers/:id/credit`
- `/api/credit*`
- `/api/invoices*`
- `/api/finance/*`
- `/api/export/orders`
- `/api/export/inventory`

Current risks:

- There are overlapping credit concepts.
- Finance endpoints contain sensitive data and must be protected before use.

## Quality And Maintenance

Purpose:

- Quality checks, NCR/CAPA, incidents, maintenance, LOTO, PM schedule.

Screens:

- `public/quality.html`
- `public/maintenance.html`
- `public/warroom.html`

Server route families:

- `/api/quality*`
- `/api/maintenance*`
- `/api/incidents*`
- `/api/ncr*`
- `/api/capa*`
- `/api/loto*`
- `/api/pm-schedule*`

Current risks:

- Several pages are marked as coming soon/stub.
- State machines for NCR/CAPA and maintenance need a specification before
  expanding functionality.

## Customer And External Portals

Purpose:

- External customer, supplier, driver, and worker experiences.

Screens:

- `public/customer.html`
- `public/portal.html`
- `public/supplier.html`
- `public/driver.html`
- `public/worker.html`
- `public/worker-visual.html`

Server route families:

- `/api/c/*`
- `/api/customers/:id/token`
- supplier routes used by `supplier.html`
- driver routes used by `driver.html`
- worker routes used by `worker*.html`

Current risks:

- Customer access can be granted from phone alone.
- Portal token policy is not strong enough for a sellable product.
- External portals need a separate session/OTP decision.

## Dashboard And Reports

Purpose:

- Cross-module overview and reporting. This module must read from module-owned
  services, not reimplement business logic.

Screens:

- `public/dashboard.html`
- `public/reports.html`
- `public/holdings.html`
- `public/docs.html`

Server route families:

- `/api/dashboard`
- `/api/reports/*`
- `/api/waste/summary`
- `/api/kpi/monthly`
- `/api/reports/summary`
- `/api/holdings`
- `/api/companies*`

Current risks:

- Dashboard currently duplicates production queue logic.
- Reporting is broad and should not own write behavior.

## First Agent Assignments

Use these as the first concrete work packages after Sprint 0 approval:

1. Security Agent: protect user/admin/settings/database endpoints and remove
   spoofable role fallback from privileged flows.
2. Production Agent: make dashboard production queue read from the same source
   as `/api/production-queue`.
3. Design System Agent: introduce shared escape/render helpers and patch admin
   intake + orders first.
4. Architecture Agent: extract route-family ownership into a formal API map.
5. Portal Agent: design customer portal OTP/magic-link flow without implementing
   until approved.
