# IronBend Project Risk Report

Generated: 2026-06-24

This is a documentation-only risk inventory. No code, UI, or database schema was changed.

## Executive Summary

The project is functional but tightly integrated. The biggest parallel-development risks are large browser files, large route files, shared SQLite tables, duplicated migration/schema logic, and central files that many modules naturally touch.

## Duplicate Logic

| Area | Current Pattern | Risk |
| --- | --- | --- |
| Portal user/schema setup | Portal tables/columns appear in `db/coreSchema.js`, `db/startup.js`, and `services/portalAccess.js` | Schema drift and inconsistent defaults between startup and runtime helper. |
| Pricing and finance | Pricing is in `routes/catalog.js` and `services/pricer.js`; finance is split across `routes/finance*.js` and `db/financeSchema.js` | Price calculation and financial reporting can diverge if one side changes alone. |
| Shape behavior | Shape editing/rendering/calculation spans `public/shape-editor.js`, `public/shape-renderer.js`, `modules/steel-rebar/*`, and print/production flows | Risk of inconsistent shape totals, bending interpretation, and customer quote output. |
| Browser UI patterns | Many HTML files include local card/button/modal/table logic | UI behavior and styling can drift across modules. |
| Settings | Settings definitions live in `services/settings.js`, admin routes, and several module consumers | Configuration meaning can diverge between UI, API, and runtime usage. |
| Vehicle/driver data | Fleet has `drivers`, `vehicles`, `vehicle_events`, startup compatibility columns, and `db/vehicleMigrations.js` | Migration and compatibility logic can be repeated or missed. |

## Large Files

These files are likely conflict hotspots because multiple agents may need to edit the same file.

| File | Approx. Size | Risk |
| --- | ---: | --- |
| `public/shape-editor.js` | 120 KB | Dense shared shape editor used by order, intake, portal, and production workflows. |
| `public/index.html` | 109 KB | Main operational dashboard/shell file with many responsibilities. |
| `public/intake.html` | 104 KB | Intake UI combines upload, review, order creation, and shape data. |
| `public/admin.html` | 85 KB | Admin/settings/users/modules/database concerns in one screen. |
| `public/customer.html` | 82 KB | Customer portal now combines login, ordering, finance, sites, users, guarantees, price list, and history. |
| `public/orders.html` | 70 KB | Order workflow and item management are broad. |
| `public/dashboard.html` | 64 KB | Dashboard pulls from many modules. |
| `routes/portal.js` | 43 KB | Portal route owns auth, users, sites, finance, price list, guarantees, order, approvals, and history. |
| `db/coreSchema.js` | 33 KB | Central schema for most modules. |
| `routes/catalog.js` | 28 KB | Pricing and shape catalog share one route module. |
| `routes/orders.js` | 23 KB | Order lifecycle, imports, item CRUD, review, and locking share one route module. |
| `services/productionCardPrintPage.js` | 44 KB | Print layout logic is large and tightly tied to order/card data. |
| `TASKS_V2.md` | 78 KB | Project coordination ledger can cause frequent merge conflicts. |

## Circular or Tight Coupling Risks

| Coupling | Why It Matters |
| --- | --- |
| Customer Portal -> Customers -> Pricing -> Orders -> Finance -> Customer Portal | Portal finance and order visibility consume finance/orders, while finance and orders also expose customer-specific state. Changes need careful sequencing. |
| Orders -> Items -> Production -> Warehouse -> Finance -> Reports | One order status or item field can affect downstream production, delivery, billing, and KPI screens. |
| Intake -> Orders -> Shape Editor -> Steel/Rebar -> Production | Intake approval produces order/item records that must match shape and production assumptions. |
| Pricing -> Steel Prices -> Procurement -> Finance | Steel price changes may affect quote, cost, margin, and invoice expectations. |
| Machines -> Production -> Maintenance -> Quality -> Reports | Machine state and item status drive several operational modules. |
| `server.js` route composition | Central mount/bootstrap file makes cross-module initialization order important. |

No explicit JavaScript import cycle was proven in this scan, but the domain dependency graph contains several bidirectional business dependencies that should be treated as coordination risks.

## Database Bottlenecks

| Bottleneck | Impact |
| --- | --- |
| Single SQLite database file | All modules share the same write database; heavy finance/report/dashboard reads can compete with operational writes. |
| Shared `orders` and `items` tables | These tables are used by portal, production, finance, warehouse, reports, intake, and printing. Field changes have high blast radius. |
| Startup migrations in `db/startup.js` | Many modules add compatibility columns from one startup file, increasing merge and ordering risk. |
| Duplicate portal schema migration | Portal-related columns are initialized both by DB startup and portal access service. |
| Reporting/KPI queries over operational tables | Dashboard/report endpoints read from live operational tables; indexes and query plans should be reviewed before larger deployments. |
| Finance aggregates over orders/customer sites | Customer portal finance dashboard depends on order/site/payment term data; large customers may need indexed query paths. |

## Modules That Are Too Tightly Coupled

| Module | Coupled With | Reason |
| --- | --- | --- |
| Customer Portal | Customers, Pricing, Orders, Finance, Warehouse | It now owns customer self-service, site budgets, users, order creation, document visibility, and finance alerts. |
| Orders | Intake, Pricing, Production, Warehouse, Finance | Orders are the central transaction object. |
| Pricing | Finance, Portal, Procurement, Steel/Rebar | Same price/cost data feeds quotes, customer displays, margins, and steel-price history. |
| Production | Machines, Items, Quality, Maintenance, Reports | Machine and item status changes fan out widely. |
| Admin | Settings, Auth, Module Gates, DB backup/upload | Admin controls many platform concerns in one route/screen. |
| Shape Editor | Orders, Intake, Portal, Production Cards | Shape behavior is reused across very different workflows. |

## Files That Should Eventually Be Split

This section is not an instruction to refactor now. It identifies future split candidates so parallel work can avoid collisions.

| File | Suggested Split Direction |
| --- | --- |
| `public/customer.html` | Portal auth, portal home, sites/users, order builder, price list, guarantees, finance dashboard, order history. |
| `routes/portal.js` | Portal auth, users/permissions, sites/budgets, finance, guarantees, quotes/orders, approvals/history. |
| `public/shape-editor.js` | Geometry model, renderer adapter, form state, validation, export/import, reusable UI bindings. |
| `routes/catalog.js` | Pricing price books and shape catalog as separate route modules. |
| `public/admin.html` | Users/access, settings, integrations, database tools, module map. |
| `db/startup.js` | Module-owned startup migrations by domain. |
| `services/productionCardPrintPage.js` | Data preparation, print templates, CSS/layout helpers. |
| `public/index.html` | Dashboard widgets, machine cards, alert stream, navigation shell. |

## Conflict Hotspots for Parallel Agents

| Hotspot | Coordination Rule |
| --- | --- |
| `TASKS_V2.md` | Claim one task and update narrow lines only. |
| `server.js` | Avoid unless adding/removing route mounts or core middleware. |
| `db/coreSchema.js` and `db/startup.js` | Serialize schema/migration work. |
| `shared/module-catalog.json` | Platform owner should coordinate module changes. |
| `public/nav.js` and `public/theme.css` | UI/platform owner should coordinate global navigation/theme changes. |
| `routes/portal.js` and `public/customer.html` | Customer portal owner should control concurrent portal work. |
| `routes/orders.js` and `public/orders.html` | Order lifecycle changes should be isolated by endpoint/workflow. |

## Recommended Parallel Work Rules

- Assign one owner per module boundary before implementation.
- For a feature, list exact route, service, screen, and DB files before coding.
- Avoid mixed changes that touch portal, finance, orders, and DB schema in the same task unless the task explicitly owns the integration.
- Prefer new module-local route files over growing already-large route files, once a refactor task is approved.
- Keep schema changes in dedicated tasks with migration notes and tests.
- Keep visual/UI-only work separate from API/DB work.
- Treat `orders`, `items`, `customers`, `customer_sites`, `portal_users`, `pricing_price_items`, `invoices`, and `delivery_notes` as shared contract tables.
- Update architecture docs and registries when adding endpoints, screens, tables, or module dependencies.
