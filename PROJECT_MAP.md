# IronBend Project Architecture Map

Generated: 2026-06-24

This document is a documentation-only inventory of the current repository. It maps the existing architecture without changing application code, UI, routes, or database schema.

## Repository Shape

| Area | Purpose | Notes |
| --- | --- | --- |
| `server.js` | Express runtime, static hosting, route mounting, health endpoint, app bootstrap | Still a central integration point. |
| `public/` | Browser screens, shared browser scripts, CSS, printable views | Large single-file screens are common. |
| `routes/` | Express route modules | Most business APIs are here. |
| `services/` | Shared server-side business logic | Pricing, portal access, orders, inventory, settings, branding, license, backup. |
| `db/` | SQLite connection, schema creation, startup migrations, seed data | `coreSchema.js`, `financeSchema.js`, `startup.js`. |
| `modules/` | Extracted domain modules and manifests | `steel-rebar`, `admin-users`, intake docs. |
| `core/` | Core auth, permissions, module gates manifests | Governance layer. |
| `middleware/` | Express middleware | Auth middleware. |
| `realtime/` | WebSocket event bridge | Production/order/status updates. |
| `jobs/` | Scheduled/background jobs | Scheduler for backup/cleanup/report jobs. |
| `scripts/` | Local ops, smoke tests, migrations, helpers | Startup and verification scripts. |
| `test/` | Node test suite | Auth, modules, shapes, intake, security, status contracts, smoke. |
| `docs/` | Specifications, registries, module docs, operating rules | Existing governance and feature docs. |
| `shared/` | Shared metadata | `module-catalog.json`. |
| `tene-license-server/` | Separate license server subproject | Own package, routes, DB, tests. |

## Modules

### Module Name: Core Runtime

Purpose:
Runs the Express app, static assets, API route mounting, health checks, WebSocket setup, scheduled jobs, and SQLite bootstrap.

Main Files:
`server.js`, `package.json`, `render.yaml`, `Dockerfile`, `ecosystem.config.js`, `db/connection.js`, `db/coreSchema.js`, `db/startup.js`, `jobs/scheduler.js`, `realtime/ws.js`

Routes:
Mounted under `/api`; static files from `public/`; health check `GET /api/health`.

Database Tables:
All core tables are initialized through `db/coreSchema.js`; startup migrations are in `db/startup.js`.

Services:
`services/moduleLoader.js`, `services/moduleMap.js`, `services/settings.js`, `services/backup.js`.

Dependencies:
Express, SQLite via `better-sqlite3`, route modules, services, WebSocket, scheduler, auth middleware.

Screens:
All `public/*.html` screens are served by the runtime.

API Endpoints:
`GET /api/health` plus all mounted route module endpoints.

Related Modules:
All modules.

### Module Name: Authentication, Users, and Permissions

Purpose:
User login, JWT/session handling, role checks, access matrix, audit visibility, and admin user management.

Main Files:
`auth-core.js`, `permissions.js`, `middleware/auth.js`, `routes/auth.js`, `routes/access.js`, `routes/admin.js`, `core/auth/module.manifest.js`, `core/permissions/module.manifest.js`, `modules/admin-users/module.manifest.js`

Routes:
`POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/users/login`, `GET /api/access/me`, `GET /api/access/matrix`, `PUT /api/access/matrix`, `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `GET /api/audit-log`.

Database Tables:
`users`, `audit_log`, `settings`.

Services:
`services/accessControl.js`, `services/settings.js`.

Dependencies:
Core Runtime, Settings, Module Gates.

Screens:
`public/login.html`, `public/admin.html`.

API Endpoints:
Authentication endpoints, access matrix endpoints, user administration endpoints.

Related Modules:
Admin, Module Registry, Customer Portal, all protected APIs.

### Module Name: Module Registry and License Gates

Purpose:
Defines available product modules, package tiers, route manifests, enabled module gates, and license-visible module lists.

Main Files:
`shared/module-catalog.json`, `routes/license.js`, `services/license.js`, `services/moduleLoader.js`, `services/moduleMap.js`, `core/module-gates/index.js`, `core/module-gates/module.manifest.js`, `docs/spec-license-modules.md`

Routes:
`GET /api/license/modules`, `GET /api/admin/module-map`.

Database Tables:
`settings` stores license/module configuration.

Services:
`services/license.js`, `services/moduleLoader.js`, `services/moduleMap.js`.

Dependencies:
Settings, Admin, Route manifests, `tene-license-server/`.

Screens:
`public/admin.html`, navigation in `public/nav.js`.

API Endpoints:
`GET /api/license/modules`, `GET /api/admin/module-map`.

Related Modules:
All feature modules.

### Module Name: Branding, Theme, and Navigation

Purpose:
Central branding assets, UI shell navigation, theme CSS, logo exposure, and client navigation behavior.

Main Files:
`routes/branding.js`, `services/branding.js`, `public/nav.js`, `public/theme.css`, `public/logo.*`, `public/tna-logo.*`

Routes:
`GET /api/branding`.

Database Tables:
`settings`.

Services:
`services/branding.js`, `services/settings.js`.

Dependencies:
Settings, Core Runtime.

Screens:
All HTML screens use common theme/navigation assets where integrated.

API Endpoints:
`GET /api/branding`.

Related Modules:
Admin, Dashboard, Customer Portal, all browser screens.

### Module Name: Dashboard and Reports

Purpose:
Operational dashboard, KPIs, exports, waste reports, monthly KPI, and summary reporting.

Main Files:
`routes/reports.js`, `public/dashboard.html`, `public/reports.html`, `status-contracts.js`, `docs/widget-data-contracts.md`

Routes:
`GET /api/dashboard`, `GET /api/reports/summary`, `GET /api/reports/waste`, `GET /api/waste/summary`, `GET /api/kpi/monthly`, `GET /api/export/orders`, `GET /api/export/packages`, `GET /api/export/inventory`.

Database Tables:
`orders`, `items`, `machines`, `packages`, `raw_material`, `raw_material_usage`, `financial_events`.

Services:
Reporting logic is primarily in `routes/reports.js`; dashboard widgets depend on status contracts and route queries.

Dependencies:
Orders, Production, Inventory, Warehouse, Finance.

Screens:
`public/dashboard.html`, `public/reports.html`, `public/warroom.html`.

API Endpoints:
Dashboard, report, KPI, and export endpoints listed above.

Related Modules:
Production, Finance, Warehouse, Inventory, Orders.

### Module Name: Customers and CRM

Purpose:
Customer records, projects, sites, portal-site setup, portal user setup, and customer metadata.

Main Files:
`routes/customers.js`, `public/customers.html`, `public/projects.html`, `db/coreSchema.js`, `db/startup.js`, `docs/customer-onboarding.md`

Routes:
`GET /api/customers`, `GET /api/customers/:id`, `POST /api/customers`, `PATCH /api/customers/:id`, `GET /api/projects`, `POST /api/projects`, `PATCH /api/projects/:id`, `GET /api/sites`, `POST /api/sites`, `PATCH /api/sites/:id`, `GET /api/customers/:id/portal-sites`, `POST /api/customers/:id/portal-sites`, `GET /api/customers/:id/portal-users`, `POST /api/customers/:id/portal-users`.

Database Tables:
`customers`, `projects`, `sites`, `customer_sites`, `portal_users`, `customer_site_users`, `customer_portal_permission_audit`.

Services:
Customer logic is mostly route-local; portal user/session helper in `services/portalAccess.js`.

Dependencies:
Companies, Pricing, Orders, Customer Portal, Finance.

Screens:
`public/customers.html`, `public/projects.html`.

API Endpoints:
Customer, project, site, portal-site, and portal-user endpoints listed above.

Related Modules:
Customer Portal, Orders, Finance, Companies, Pricing.

### Module Name: Customer Portal

Purpose:
Customer self-service portal for login/link access, site and user management, self-ordering, customer price list visibility, guarantees/payment terms, finance dashboard, payment alerts, and order history.

Main Files:
`routes/portal.js`, `routes/portalAdmin.js`, `services/portalAccess.js`, `services/pricer.js`, `public/customer.html`, `docs/modules/portal.md`, `docs/spec-customer-finance-control-dashboard.md`, `docs/spec-portal-roles.md`, `docs/spec-project-budgets.md`

Routes:
`POST /api/c/auth`, `POST /api/c/auth/verify`, `POST /api/c/auth/password`, `POST /api/c/password/change`, `GET /api/c/me`, `GET /api/c/users`, `POST /api/c/users`, `POST /api/c/users/:id/deactivate`, `GET /api/c/sites`, `POST /api/c/sites`, `GET /api/c/sites/:siteId/summary`, `GET /api/c/finance/summary`, `GET /api/c/finance/sites`, `GET /api/c/finance/payments-due`, `GET /api/c/orders/history`, `GET /api/c/shapes`, `GET /api/c/price-list`, `GET /api/c/guarantee-documents`, `POST /api/c/guarantee-documents`, `POST /api/c/quote`, `POST /api/c/order`, `GET /api/c/approve/:token`, `POST /api/c/approve`, `GET /api/c/orders/:orderId`, `GET /api/customers/:id/token`, `POST /api/customers/:id/token/rotate`, `DELETE /api/customers/:id/token`, `PATCH /api/customers/:id/pricing`, `POST /api/customers/:id/portal-password/reset`.

Database Tables:
`customers`, `customer_portal_otps`, `customer_guarantee_documents`, `customer_sites`, `portal_users`, `customer_site_users`, `customer_portal_permission_audit`, `orders`, `items`, `shapes`, `pricing_price_books`, `pricing_price_items`, `invoices`, `delivery_notes`.

Services:
`services/portalAccess.js`, `services/pricer.js`, `services/orderNumbers.js`.

Dependencies:
Customers, Pricing, Orders, Shapes, Finance, Warehouse/Delivery Notes, Settings, Auth.

Screens:
`public/customer.html`, admin customer/portal controls in `public/customers.html`.

API Endpoints:
Customer portal `/api/c/*` endpoints and supplier-side portal admin endpoints listed above.

Related Modules:
Customers, Orders, Pricing, Finance, Warehouse, Branding, Auth.

### Module Name: Orders

Purpose:
Order creation, manual order entry, imports, item management, order status, locking, intake-source lookup, and print/export integration.

Main Files:
`routes/orders.js`, `services/orders.js`, `services/orderNumbers.js`, `public/orders.html`, `public/intake.html`, `docs/modules/orders.md`

Routes:
`GET /api/orders`, `GET /api/orders/:id`, `GET /api/orders/:id/intake-source`, `POST /api/orders/manual`, `POST /api/orders`, `PATCH /api/orders/:id/status`, `PATCH /api/orders/:id/lock`, `PATCH /api/orders/:id/unlock`, `POST /api/order-imports/preview`, `POST /api/order-imports/:id/approve`, `POST /api/orders/:orderId/items`, `PATCH /api/orders/:orderId/items/:itemId`, `DELETE /api/orders/:orderId/items/:itemId`, `PATCH /api/orders/:orderId/items/:itemId/review`.

Database Tables:
`orders`, `order_sequences`, `items`, `order_imports`, `customers`, `projects`, `sites`, `customer_sites`, `shapes`, `intake_log`.

Services:
`services/orders.js`, `services/orderNumbers.js`, `services/pricer.js`, `services/inventory.js`.

Dependencies:
Customers, Pricing, Shapes, Intake, Production, Inventory, Finance, Realtime.

Screens:
`public/orders.html`, order panels in `public/index.html`, `public/intake.html`.

API Endpoints:
Order and item endpoints listed above.

Related Modules:
Customer Portal, Intake, Shape Editor, Production, Finance, Reports.

### Module Name: Steel/Rebar Domain

Purpose:
Domain utilities for rebar shapes, weights, BVBS parsing, bending machine constraints, and steel-specific calculation logic.

Main Files:
`modules/steel-rebar/index.js`, `modules/steel-rebar/shapes.js`, `modules/steel-rebar/weights.js`, `modules/steel-rebar/bvbs.js`, `modules/steel-rebar/machines.js`, `routes/catalog.js`, `routes/bvbs.js`, `public/shape-editor.js`, `public/shape-renderer.js`, `docs/modules/steel-rebar.md`

Routes:
Shape catalog endpoints in `routes/catalog.js`; BVBS endpoints in `routes/bvbs.js`.

Database Tables:
`shapes`, `items`, `machines`, `raw_material`, `steel_price_history`.

Services:
Steel logic is in `modules/steel-rebar/*`; pricing uses `services/pricer.js`.

Dependencies:
Orders, Pricing, Production, Machines, Inventory.

Screens:
`public/shape-editor.html`, `public/shape-editor.js`, `public/shape-renderer.js`, shape forms embedded in order/intake/customer screens.

API Endpoints:
`GET /api/shapes`, `POST /api/shapes`, `POST /api/shapes/seed`, `POST /api/bvbs/parse`, `POST /api/bvbs/create-order`.

Related Modules:
Orders, Intake, Production, Pricing, BVBS.

### Module Name: Pricing

Purpose:
Price books, general/customer-specific price items, uploaded price-book analysis, quote calculation, and customer visibility of price lists.

Main Files:
`routes/catalog.js`, `services/pricer.js`, `db/financeSchema.js`, `public/pricing.html`, `docs/spec-dual-pricing.md`

Routes:
`GET /api/pricing/price-books`, `POST /api/pricing/price-books/analyze-upload`, `POST /api/pricing/price-books`, `PATCH /api/pricing/price-books/:id`, `GET /api/pricing/price-books/:id/items`, `POST /api/pricing/price-books/:id/items`, `PATCH /api/pricing/price-books/:id/items/:itemId`, `DELETE /api/pricing/price-books/:id/items/:itemId`.

Database Tables:
`pricing_price_books`, `pricing_price_items`, `customers`, `orders`, `items`, `steel_prices`.

Services:
`services/pricer.js`.

Dependencies:
Customers, Steel/Rebar, Orders, Finance, Intake image analysis for uploads.

Screens:
`public/pricing.html`, customer-facing display in `public/customer.html`.

API Endpoints:
Pricing endpoints listed above; portal quote endpoint `POST /api/c/quote` consumes pricing.

Related Modules:
Customer Portal, Finance, Orders, Procurement.

### Module Name: Finance

Purpose:
Margins, finance KPIs, events, order costs, snapshots, customer credit, invoices, payment tracking, and finance dashboard support.

Main Files:
`routes/finance.js`, `routes/financeCosts.js`, `routes/financeCredit.js`, `routes/financeInvoices.js`, `routes/financeLedger.js`, `db/financeSchema.js`, `public/finance.html`, `docs/modules/finance.md`, `docs/spec-billing.md`

Routes:
`GET /api/orders/:id/margin`, `GET /api/finance/kpis`, `GET /api/finance/events`, `GET /api/orders/:id/costs`, `POST /api/orders/:id/costs/recalculate`, `PATCH /api/orders/:id/costs/lock`, `GET /api/orders/:id/costs/snapshots`, `GET /api/credit`, `GET /api/credit/:customerId`, `PATCH /api/credit/:customerId`, `POST /api/credit/:customerId/transaction`, `GET /api/credit/:customerId/status`, `GET /api/invoices`, `POST /api/invoices`, `PATCH /api/invoices/:id/pay`, `PATCH /api/invoices/:id/cancel`, `GET /api/customers/:id/ledger`, `PATCH /api/customers/:id/credit`.

Database Tables:
`order_costs`, `cost_snapshots`, `customer_credit`, `financial_events`, `steel_prices`, `credit_accounts`, `credit_transactions`, `invoices`, `orders`, `customers`.

Services:
`services/pricer.js`; finance logic is mostly route-local.

Dependencies:
Orders, Customers, Pricing, Procurement/Steel Prices, Customer Portal.

Screens:
`public/finance.html`, customer finance sections in `public/customer.html`.

API Endpoints:
Finance, cost, credit, invoice, and ledger endpoints listed above.

Related Modules:
Customer Portal, Pricing, Reports, Procurement, Orders.

### Module Name: Intake and OCR

Purpose:
Image/text intake, order recognition, WhatsApp/email intake, review queue, training examples, and order creation from intake.

Main Files:
`routes/intake.js`, `routes/intakeChannels.js`, `routes/intakeReview.js`, `routes/intakeTraining.js`, `services/intakeWorkflow.js`, `intake.js`, `ai.js`, `public/intake.html`, `docs/modules/intake.md`

Routes:
`POST /api/analyze-image`, `POST /api/intake/image`, `GET /api/intake/whatsapp`, `POST /api/intake/whatsapp`, `POST /api/intake/email/poll`, `GET /api/intake/log`, `GET /api/intake/order-review-tasks`, `POST /api/intake/:id/approve`, `POST /api/intake/:id/reject`, `POST /api/intake/parse-text`, `GET /api/intake/training`, `POST /api/intake/training`, `DELETE /api/intake/training/:id`.

Database Tables:
`intake_log`, `intake_training_examples`, `order_imports`, `orders`, `items`, `customers`.

Services:
`services/intakeWorkflow.js`, `ai.js`.

Dependencies:
Orders, AI, Shape Editor, Pricing, Customers, Settings, external WhatsApp/email providers.

Screens:
`public/intake.html`.

API Endpoints:
Intake, channel, review, and training endpoints listed above.

Related Modules:
Orders, AI, Steel/Rebar, Customer Portal only through final order flow.

### Module Name: Inventory

Purpose:
Raw material stock, receipt review, inventory updates, forecasts, visual inventory label/shape analysis.

Main Files:
`routes/inventory.js`, `routes/inventoryVision.js`, `services/inventory.js`, `public/inventory.html`, `docs/spec-material-area.md`

Routes:
`GET /api/inventory`, `GET /api/inventory/summary`, `GET /api/inventory/receipt-reviews`, `POST /api/inventory/receipt-reviews/:id/approve`, `POST /api/inventory/receipt-reviews/:id/reject`, `POST /api/inventory`, `PATCH /api/inventory/:id`, `GET /api/inventory/forecast`, `POST /api/inventory/analyze-bending-shape`, `POST /api/inventory/scan-label`, `POST /api/inventory/receipt-reviews/analyze`.

Database Tables:
`raw_material`, `raw_material_usage`, `inventory_receipt_reviews`, `items`, `purchase_orders`.

Services:
`services/inventory.js`.

Dependencies:
Procurement, Orders, Production, AI image analysis, Finance.

Screens:
`public/inventory.html`.

API Endpoints:
Inventory and inventory vision endpoints listed above.

Related Modules:
Procurement, Warehouse, Production, Finance.

### Module Name: Procurement

Purpose:
Suppliers, steel prices, purchase orders, receiving workflow.

Main Files:
`routes/procurement.js`, `public/procurement.html`

Routes:
`GET /api/suppliers`, `POST /api/suppliers`, `PATCH /api/suppliers/:id`, `GET /api/steel-prices`, `POST /api/steel-prices`, `GET /api/purchase-orders`, `POST /api/purchase-orders`, `PATCH /api/purchase-orders/:id`, `PATCH /api/purchase-orders/:id/receive`.

Database Tables:
`suppliers`, `steel_price_history`, `steel_prices`, `purchase_orders`, `raw_material`.

Services:
Route-local procurement logic; feeds `services/inventory.js` and finance price data.

Dependencies:
Inventory, Finance, Companies.

Screens:
`public/procurement.html`.

API Endpoints:
Supplier, steel price, and purchase order endpoints listed above.

Related Modules:
Inventory, Finance, Reports.

### Module Name: Production Execution

Purpose:
Worker management, barcode/scan flow, production queue, item status, machine assignment, production events.

Main Files:
`routes/production.js`, `public/production-queue.html`, `public/kiosk.html`, `public/worker-visual.html`, `docs/modules/production.md`

Routes:
`GET /api/workers`, `POST /api/workers`, `PATCH /api/workers/:id`, `POST /api/scan`, `POST /api/machines/:id/end-of-day`, `PATCH /api/items/:id/status`, `PATCH /api/items/:id`, `GET /api/production-queue`, `GET /api/production-events`.

Database Tables:
`workers`, `scan_log`, `items`, `orders`, `machines`, `production_events`, `shifts`, `machine_stops`.

Services:
Production logic is primarily route-local; card printing uses `services/productionCards.js`.

Dependencies:
Orders, Machines, Shape/Steel calculations, Realtime, Quality, Maintenance.

Screens:
`public/production-queue.html`, `public/kiosk.html`, `public/worker-visual.html`, dashboard machine cards.

API Endpoints:
Production execution endpoints listed above.

Related Modules:
Production Cards, Machines, Quality, Maintenance, Warehouse.

### Module Name: Production Cards and Order Documents

Purpose:
Printable production cards, A4 order prints, delivery certificates, card weight overrides, and order documents.

Main Files:
`routes/productionCards.js`, `routes/orderPrintA4.js`, `routes/orderDeliveryCertificate.js`, `routes/orderDocuments.js`, `services/productionCards.js`, `services/productionCardPrintPage.js`, `public/print.html`, `docs/modules/production-cards.md`

Routes:
`GET /api/orders/:id/print-cards`, `PATCH /api/orders/:orderId/production-card-weight`, `GET /api/orders/:id/print-a4`, `GET /api/orders/:id/delivery-certificate`.

Database Tables:
`orders`, `items`, `production_card_weights`, `customers`, `delivery_notes`.

Services:
`services/productionCards.js`, `services/productionCardPrintPage.js`.

Dependencies:
Orders, Steel/Rebar, Customers, Warehouse.

Screens:
Printable pages from route-generated HTML; `public/print.html`.

API Endpoints:
Production card, A4 print, and delivery certificate endpoints listed above.

Related Modules:
Orders, Production, Warehouse, Customer Portal documents.

### Module Name: Machines, Shifts, and Metrics

Purpose:
Machine configuration, machine assignment/completion, machine state logs, shift tracking, downtime, OEE, and KPI metrics.

Main Files:
`routes/productionMachines.js`, `routes/productionShifts.js`, `routes/productionMetrics.js`, `modbus.js`, `public/machine.html`

Routes:
`GET /api/machines`, `POST /api/machines`, `DELETE /api/machines/:id`, `POST /api/machines/:id/send-params`, `POST /api/machines/:id/assign`, `PATCH /api/machines/:id/config`, `POST /api/machines/:id/complete`, `PATCH /api/machines/:id/state`, `GET /api/machines/:id/state-log`, `GET /api/shifts`, `POST /api/shifts`, `PATCH /api/shifts/:id/end`, `GET /api/downtime-reasons`, `GET /api/machine-stops`, `POST /api/machine-stops`, `PATCH /api/machine-stops/:id/end`, `GET /api/kpi/tons-today`, `GET /api/machines/oee`, `GET /api/kpi/shift-summary`.

Database Tables:
`machines`, `machine_state_log`, `shifts`, `downtime_reasons`, `machine_stops`, `items`, `production_events`.

Services:
Modbus integration in `modbus.js`; route-local machine logic.

Dependencies:
Production, Steel/Rebar, Maintenance, Realtime.

Screens:
`public/machine.html`, dashboard machine widgets, `public/kiosk.html`.

API Endpoints:
Machine, shift, downtime, and KPI endpoints listed above.

Related Modules:
Production, Maintenance, Reports.

### Module Name: Warehouse

Purpose:
Packages, shipping state, delivery notes, and warehouse export source.

Main Files:
`routes/warehouse.js`, `public/warehouse.html`

Routes:
`GET /api/packages`, `POST /api/packages`, `PATCH /api/packages/:id/ship`, `GET /api/delivery-notes`, `POST /api/delivery-notes`.

Database Tables:
`packages`, `delivery_notes`, `items`, `orders`.

Services:
Warehouse logic is route-local.

Dependencies:
Orders, Production, Logistics, Customer Portal, Reports.

Screens:
`public/warehouse.html`.

API Endpoints:
Package and delivery-note endpoints listed above.

Related Modules:
Logistics, Customer Portal, Reports, Production.

### Module Name: Logistics and Fleet

Purpose:
Deliveries, drivers, vehicles, vehicle events/documents, driver location and delivery confirmation/problem flow.

Main Files:
`routes/logistics.js`, `routes/fleet.js`, `services/fleet.js`, `public/driver.html`, `public/delivery-admin.html`, `public/fleet.html`

Routes:
`GET /api/deliveries`, `POST /api/deliveries`, `POST /api/deliveries/:id/depart`, `POST /api/deliveries/:id/confirm`, `POST /api/deliveries/:id/problem`, `GET /api/vehicles`, `POST /api/vehicles`, `PATCH /api/vehicles/:id`, `GET /api/vehicles/:id/events`, `POST /api/vehicles/:id/events`, `GET /api/vehicles/:id/documents`, `POST /api/vehicles/:id/documents`, `GET /api/drivers`, `POST /api/drivers`, `PATCH /api/drivers/:id`, `DELETE /api/drivers/:id`, `GET /api/drivers/:id/vehicle-events`, `POST /api/drivers/:id/vehicle-events`, `PATCH /api/drivers/:id/location`.

Database Tables:
`drivers`, `vehicles`, `vehicle_events`, `vehicle_documents`, `deliveries`, `delivery_notes`, `orders`.

Services:
`services/fleet.js`.

Dependencies:
Warehouse, Orders, Customers, Reports.

Screens:
`public/driver.html`, `public/delivery-admin.html`, `public/fleet.html`.

API Endpoints:
Delivery, vehicle, driver, event, and document endpoints listed above.

Related Modules:
Warehouse, Customer Portal, Reports.

### Module Name: Quality

Purpose:
Quality checks, incidents, NCR, CAPA, and quality statistics.

Main Files:
`routes/quality.js`, `public/quality.html`

Routes:
`GET /api/quality`, `POST /api/quality`, `GET /api/quality/stats`, `GET /api/incidents`, `POST /api/incidents`, `PATCH /api/incidents/:id`, `GET /api/ncr`, `POST /api/ncr`, `PATCH /api/ncr/:id`, `GET /api/capa`, `POST /api/capa`, `PATCH /api/capa/:id`.

Database Tables:
`quality_checks`, `incidents`, `ncr`, `capa`, `items`, `machines`, `orders`.

Services:
Quality logic is route-local.

Dependencies:
Production, Maintenance, Orders.

Screens:
`public/quality.html`.

API Endpoints:
Quality, incidents, NCR, and CAPA endpoints listed above.

Related Modules:
Production, Reports, Maintenance.

### Module Name: Maintenance

Purpose:
Maintenance logs, LOTO, preventive maintenance schedule, and maintenance statistics.

Main Files:
`routes/maintenance.js`, `public/maintenance.html`

Routes:
`GET /api/maintenance`, `POST /api/maintenance`, `PATCH /api/maintenance/:id`, `GET /api/maintenance/stats`, `GET /api/loto`, `POST /api/loto`, `PATCH /api/loto/:id/release`, `GET /api/pm-schedule`, `POST /api/pm-schedule`.

Database Tables:
`maintenance_logs`, `loto`, `pm_schedule`, `machines`, `incidents`.

Services:
Maintenance logic is route-local.

Dependencies:
Machines, Production, Quality.

Screens:
`public/maintenance.html`.

API Endpoints:
Maintenance, LOTO, and PM schedule endpoints listed above.

Related Modules:
Production, Quality, Reports.

### Module Name: Companies and Holdings

Purpose:
Multi-company records and holding/company group management.

Main Files:
`routes/companies.js`, `public/holdings.html`

Routes:
`GET /api/companies`, `POST /api/companies`, `PATCH /api/companies/:id`, `GET /api/holdings`.

Database Tables:
`companies`, `customers`, `orders`.

Services:
Company logic is route-local.

Dependencies:
Customers, Orders, Finance.

Screens:
`public/holdings.html`.

API Endpoints:
Company and holdings endpoints listed above.

Related Modules:
Customers, Finance, Reports.

### Module Name: AI and Prediction

Purpose:
Predictive endpoints for order prediction, waste patterns, and machine efficiency.

Main Files:
`routes/ai.js`, `ai.js`

Routes:
`POST /api/ai/predict`, `GET /api/ai/predict-order/:orderId`, `GET /api/ai/waste-patterns`, `GET /api/ai/machine-efficiency`.

Database Tables:
`orders`, `items`, `machines`, `intake_log`.

Services:
`ai.js`.

Dependencies:
Orders, Intake, Production, Reports.

Screens:
Embedded through operational screens; no dedicated primary screen identified.

API Endpoints:
AI endpoints listed above.

Related Modules:
Intake, Inventory Vision, Reports.

### Module Name: BVBS

Purpose:
BVBS parsing and order creation from BVBS payloads.

Main Files:
`routes/bvbs.js`, `modules/steel-rebar/bvbs.js`

Routes:
`POST /api/bvbs/parse`, `POST /api/bvbs/create-order`.

Database Tables:
`orders`, `items`, `shapes`.

Services:
`modules/steel-rebar/bvbs.js`, order creation services.

Dependencies:
Orders, Steel/Rebar, Customers.

Screens:
BVBS entry points are embedded in order/intake workflows.

API Endpoints:
BVBS endpoints listed above.

Related Modules:
Orders, Intake, Shape Editor.

### Module Name: Search and Alerts

Purpose:
Global search and operational alert creation/resolution.

Main Files:
`routes/search.js`, `routes/alerts.js`

Routes:
`GET /api/search`, `GET /api/alerts`, `POST /api/alerts`, `PATCH /api/alerts/:id/resolve`.

Database Tables:
`alerts`, `orders`, `customers`, `items`.

Services:
Route-local logic.

Dependencies:
Orders, Customers, Production.

Screens:
Search and alert widgets in dashboard/admin screens.

API Endpoints:
Search and alert endpoints listed above.

Related Modules:
Dashboard, Orders, Production.

### Module Name: Priority Integration

Purpose:
Priority ERP sync status and order sync trigger.

Main Files:
`routes/priority.js`, `docs/spec-priority-export.md`

Routes:
`POST /api/priority/sync/:orderId`, `GET /api/priority/status`.

Database Tables:
`orders`, `settings`.

Services:
Route-local integration wrapper.

Dependencies:
Orders, Settings, external Priority service.

Screens:
Admin/order integration surfaces.

API Endpoints:
Priority sync endpoints listed above.

Related Modules:
Orders, Finance.

### Module Name: Settings and Admin

Purpose:
System settings, integration tests, data audit, DB download/upload, user management, and admin controls.

Main Files:
`routes/admin.js`, `services/settings.js`, `public/admin.html`, `docs/admin-shell-split-plan.md`

Routes:
`GET /api/settings`, `POST /api/settings`, `POST /api/settings/test/:service`, `GET /api/admin/settings`, `PATCH /api/admin/settings/:key`, `GET /api/admin/data-audit`, `GET /api/admin/database/download`, `POST /api/admin/database/upload`, plus user/admin endpoints described in Auth.

Database Tables:
`settings`, `setting_groups`, `setting_definitions`, `users`, `audit_log`.

Services:
`services/settings.js`, `services/backup.js`.

Dependencies:
Auth, Module Registry, Branding, all configured integrations.

Screens:
`public/admin.html`, `public/docs.html`, `public/help.html`.

API Endpoints:
Settings, audit, database, user, and admin endpoints listed above.

Related Modules:
All modules.

### Module Name: Realtime Events

Purpose:
WebSocket bridge for live production/order/machine/dashboard state updates.

Main Files:
`realtime/ws.js`, `docs/event-registry.md`

Routes:
WebSocket endpoint mounted by server runtime.

Database Tables:
No independent tables; emits state from orders, production, machines, alerts.

Services:
`realtime/ws.js`.

Dependencies:
Core Runtime, Orders, Production, Machines, Alerts.

Screens:
Dashboard, machine, production, kiosk, and order screens.

API Endpoints:
WebSocket channel rather than REST endpoint.

Related Modules:
Production, Dashboard, Orders.

### Module Name: Scheduler and Operations

Purpose:
Scheduled jobs, backups, operational housekeeping, and local startup helpers.

Main Files:
`jobs/scheduler.js`, `services/backup.js`, `scripts/start-local.js`, `docs/OPERATIONS_HE.md`

Routes:
Admin backup/database endpoints are in `routes/admin.js`.

Database Tables:
`settings`, operational tables used by jobs.

Services:
`services/backup.js`.

Dependencies:
Core Runtime, Settings, filesystem, database.

Screens:
Admin/operations surfaces.

API Endpoints:
`GET /api/admin/database/download`, `POST /api/admin/database/upload`.

Related Modules:
Admin, Database, all data-owning modules.

### Module Name: Tests and Governance

Purpose:
Safety net, module contracts, API/screen/entity/event registries, development rules, and architectural governance.

Main Files:
`test/*.test.js`, `docs/module-inventory.md`, `docs/api-registry.md`, `docs/screen-registry.md`, `docs/entity-registry.md`, `docs/event-registry.md`, `docs/BUILD_RULES_HE.md`, `docs/V2_INTEGRATION_PROTOCOL_HE.md`, `TASKS_V2.md`, `START_HERE.md`

Routes:
No runtime routes; tests exercise API and contracts.

Database Tables:
Test fixtures touch many tables depending on suite.

Services:
Test runners and scripts in `scripts/`.

Dependencies:
All modules.

Screens:
Registry covers `public/*.html`.

API Endpoints:
Registry covers REST/WebSocket contracts.

Related Modules:
All modules.

### Module Name: License Server Subproject

Purpose:
Separate license service for tenants, product packages, activations, and signed license payloads.

Main Files:
`tene-license-server/package.json`, `tene-license-server/server.js`, `tene-license-server/db.js`, `tene-license-server/routes/`, `tene-license-server/public/`, `tene-license-server/test/`

Routes:
Subproject routes under its own Express server.

Database Tables:
Subproject-specific license DB tables in `tene-license-server/db.js`.

Services:
License server internals.

Dependencies:
Main app `services/license.js` consumes license concepts; deployment/runtime separation required.

Screens:
License server admin/public screens under `tene-license-server/public/`.

API Endpoints:
License activation/validation/admin routes inside subproject.

Related Modules:
Module Registry and License Gates.
