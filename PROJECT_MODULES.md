# IronBend Project Modules

Generated: 2026-06-24

| Module | Status | Main Files | Depends On |
| --- | --- | --- | --- |
| Core Runtime | Active | `server.js`, `db/connection.js`, `jobs/scheduler.js`, `realtime/ws.js` | All route modules, DB, services |
| Auth / Users / Permissions | Active | `auth-core.js`, `permissions.js`, `middleware/auth.js`, `routes/auth.js`, `routes/access.js`, `routes/admin.js` | Core Runtime, Settings |
| Module Registry / License Gates | Active | `shared/module-catalog.json`, `routes/license.js`, `services/license.js`, `services/moduleLoader.js`, `core/module-gates/` | Settings, License Server |
| Branding / Theme / Navigation | Active | `routes/branding.js`, `services/branding.js`, `public/nav.js`, `public/theme.css` | Settings, Core Runtime |
| Admin / Settings | Active | `routes/admin.js`, `services/settings.js`, `public/admin.html` | Auth, Module Registry, DB |
| Dashboard / Reports | Active | `routes/reports.js`, `public/dashboard.html`, `public/reports.html` | Orders, Production, Inventory, Warehouse, Finance |
| Customers / CRM | Active | `routes/customers.js`, `public/customers.html`, `public/projects.html` | Companies, Orders, Pricing, Portal |
| Customer Portal | Active / Expanding | `routes/portal.js`, `routes/portalAdmin.js`, `services/portalAccess.js`, `public/customer.html` | Customers, Pricing, Orders, Finance, Warehouse |
| Orders | Active | `routes/orders.js`, `services/orders.js`, `services/orderNumbers.js`, `public/orders.html` | Customers, Pricing, Shapes, Intake, Production |
| Steel/Rebar Domain | Active | `modules/steel-rebar/*`, `routes/catalog.js`, `public/shape-editor.js`, `public/shape-renderer.js` | Orders, Pricing, Production, Inventory |
| Pricing | Active | `routes/catalog.js`, `services/pricer.js`, `db/financeSchema.js`, `public/pricing.html` | Customers, Steel/Rebar, Orders, Finance |
| Finance | Active / Split Routes | `routes/finance*.js`, `db/financeSchema.js`, `public/finance.html` | Orders, Customers, Pricing, Procurement |
| Intake / OCR | Active | `routes/intake*.js`, `services/intakeWorkflow.js`, `public/intake.html`, `ai.js` | Orders, AI, Shapes, Customers |
| Inventory | Active | `routes/inventory.js`, `routes/inventoryVision.js`, `services/inventory.js`, `public/inventory.html` | Procurement, Orders, Production, AI |
| Procurement | Active | `routes/procurement.js`, `public/procurement.html` | Inventory, Finance, Suppliers |
| Production Execution | Active | `routes/production.js`, `public/production-queue.html`, `public/kiosk.html` | Orders, Machines, Shapes, Realtime |
| Production Cards / Documents | Active | `routes/productionCards.js`, `routes/orderPrintA4.js`, `routes/orderDeliveryCertificate.js`, `services/productionCards.js` | Orders, Customers, Steel/Rebar, Warehouse |
| Machines / Shifts / Metrics | Active | `routes/productionMachines.js`, `routes/productionShifts.js`, `routes/productionMetrics.js`, `modbus.js` | Production, Maintenance, Realtime |
| Warehouse | Active | `routes/warehouse.js`, `public/warehouse.html` | Orders, Production, Logistics |
| Logistics / Fleet | Active | `routes/logistics.js`, `routes/fleet.js`, `services/fleet.js`, `public/driver.html`, `public/delivery-admin.html` | Warehouse, Orders, Customers |
| Quality | Active | `routes/quality.js`, `public/quality.html` | Production, Orders, Maintenance |
| Maintenance | Active | `routes/maintenance.js`, `public/maintenance.html` | Machines, Production, Quality |
| Companies / Holdings | Active | `routes/companies.js`, `public/holdings.html` | Customers, Orders, Finance |
| AI / Prediction | Active | `routes/ai.js`, `ai.js` | Orders, Intake, Production |
| BVBS | Active | `routes/bvbs.js`, `modules/steel-rebar/bvbs.js` | Orders, Steel/Rebar |
| Search / Alerts | Active | `routes/search.js`, `routes/alerts.js` | Orders, Customers, Production |
| Priority Integration | Partial / Integration | `routes/priority.js`, `docs/spec-priority-export.md` | Orders, Settings, external Priority |
| Realtime Events | Active | `realtime/ws.js`, `docs/event-registry.md` | Orders, Production, Machines, Alerts |
| Scheduler / Operations | Active | `jobs/scheduler.js`, `services/backup.js`, `scripts/start-local.js` | DB, Settings, Admin |
| Tests / Governance | Active | `test/*.test.js`, `docs/*.md`, `TASKS_V2.md`, `START_HERE.md` | All modules |
| License Server Subproject | Separate Subproject | `tene-license-server/server.js`, `tene-license-server/routes/`, `tene-license-server/db.js` | Main license concepts, separate runtime |
