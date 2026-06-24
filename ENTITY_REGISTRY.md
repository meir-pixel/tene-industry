# IronBend Entity Registry

Generated: 2026-06-24

This registry maps the current database entities to owning modules and shared consumers. It is documentation only and does not change the database schema.

Sources scanned:

- `db/coreSchema.js`
- `db/financeSchema.js`
- `db/startup.js`
- `auth-core.js`
- `services/settings.js`
- `services/portalAccess.js`
- Existing planning file: `docs/entity-registry.md`

## Ownership Rules

| Rule | Meaning |
| --- | --- |
| Owner Module | The module that should own schema meaning, lifecycle, and primary writes. |
| Shared Consumers | Modules that read or reference the entity but should not redefine it. |
| Contract Risk | Places where ownership is unclear or too many modules mutate the same table. |

## Platform Core

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `users` | Auth / Platform Core | Admin, Production Kiosk, Audit | Internal users, roles, login identity. | Core security table; do not mutate outside auth/admin. |
| `refresh_tokens` | Auth / Platform Core | Auth only | Rotating refresh tokens for JWT/session flow. | Must remain server-only and protected from UI/client assumptions. |
| `settings` | Settings / Admin | All modules | Runtime configuration, branding, integrations, module behavior. | Very broad table; setting keys need registry discipline. |
| `setting_groups` | Settings / Admin | Admin UI | Groups settings for admin display. | Partial settings subsystem; keep aligned with `settings`. |
| `setting_definitions` | Settings / Admin | Admin UI | Setting metadata, labels, permissions, customer visibility. | Risk of UI/backend drift if definitions are bypassed. |
| `audit_log` | Platform Core | Admin, Security, Portal | Important action log. | Not yet universal for all sensitive changes. |
| `alerts` | Dashboard / Platform Core | Orders, Inventory, Production, Procurement | Operational alerts and resolution status. | Alert source/type conventions need to stay consistent. |
| `companies` | Companies / Multi-company | Customers, Orders, Finance | Company/holding boundary. | Future tenant boundary; high-risk before multi-customer SaaS. |

## Customers and Portal

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `customers` | Customers / CRM | Orders, Portal, Finance, Pricing, Companies | Customer master record, tax ID, contact fields, portal and pricing flags. | High blast radius; portal token and pricing flags live here. |
| `customer_portal_otps` | Customer Portal | Auth, Customers | One-time portal login codes. | Security-sensitive; expiration and reuse rules must be strict. |
| `customer_guarantee_documents` | Customer Portal / Payment Terms | Finance, Customers | Customer guarantee/payment documents uploaded for portal workflow. | Needs future document lifecycle and approval ownership. |
| `customer_sites` | Customer Portal / Customers | Orders, Finance, Reports | Customer-created project/site records with budgets and permissions. | Overlaps with `projects` and `sites`; needs clear V2 decision. |
| `portal_users` | Customer Portal | Customers, Auth-like portal access | Customer-side users, roles, tokens, site defaults, finance permissions. | Runtime migrations also exist in `services/portalAccess.js`. |
| `customer_site_users` | Customer Portal | Customers, Orders | Assignment between portal users and customer sites. | Must enforce site-level access server-side. |
| `customer_portal_permission_audit` | Customer Portal | Admin, Security | Audit trail for customer-side permission changes. | Must capture before/after and actor consistently. |

## Orders and Order Items

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `orders` | Orders | Portal, Production, Finance, Warehouse, Reports, Intake | Main order lifecycle and commercial/production header. | Central transaction table; any field change affects many modules. |
| `order_sequences` | Orders | Orders only | Order numbering sequence. | Must stay atomic and single-writer. |
| `pallets` | Orders / Warehouse | Production, Warehouse | Pallet/order grouping. | Ownership between order planning and warehouse should be clarified. |
| `items` | Orders | Production, Warehouse, Finance, Shape Editor, Quality | Order lines and production units. | Shared mutation table; status/weight/shape fields need ownership boundaries. |
| `order_imports` | Orders / Intake | Intake | Staged order import previews before approval. | Created in startup migration; belongs to order intake boundary. |
| `production_card_weights` | Production Cards | Orders, Production | Override/actual weight data for production cards. | Duplicated create logic in core/startup; keep one owner. |

## Steel/Rebar and Shapes

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `shapes` | Steel/Rebar | Orders, Portal, Pricing, Intake, Production | Shape catalog and sort/order metadata. | Route is currently in pricing/catalog module; split ownership later. |
| `steel_price_history` | Procurement / Finance | Pricing, Costing | Purchase price history by steel parameters. | Overlaps with `steel_prices`. |
| `steel_prices` | Finance / Costing | Pricing, Procurement, Reports | Financial steel price table. | Needs one authoritative price/cost model. |

## Pricing and Finance

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `pricing_price_books` | Pricing | Portal, Customers, Finance | Price book headers, customer binding, status, document terms. | Do not mix customer-visible display with internal source names. |
| `pricing_price_items` | Pricing | Portal, Orders, Finance | Price rows/SKUs/diameters/unit prices. | Must snapshot into orders before price changes. |
| `order_costs` | Costing / Finance | Orders, Reports | Calculated order material/labor/overhead costs. | Cost must not be confused with sale price. |
| `cost_snapshots` | Costing / Finance | Reports | Historical cost snapshots. | Needs locking/version rules. |
| `customer_credit` | Credit / Finance | Portal Finance, Reports | Customer ledger/credit analytics. | Overlaps with `credit_accounts`. |
| `credit_accounts` | Credit / Finance | Orders, Portal Finance | Credit limit and exposure model. | Decide if this or `customer_credit` is authoritative. |
| `credit_transactions` | Credit / Finance | Reports | Credit ledger transactions. | Needs event/source consistency. |
| `financial_events` | Finance | Reports, Portal Finance | Financial event stream. | Needs stable event taxonomy. |
| `invoices` | Invoicing / Finance | Portal, Reports, Credit | Invoice lifecycle and payment status. | Invoice totals must be based on order pricing snapshot. |

## Intake and AI

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `intake_log` | Intake / OCR | Orders, AI, Review | Incoming WhatsApp/email/image/text intake queue. | Can become source of truth accidentally; should stage into orders only after approval. |
| `intake_training_examples` | Intake / AI | AI, OCR Review | Training examples for parser/OCR improvement. | Must avoid leaking customer/private data into uncontrolled training. |
| `inventory_receipt_reviews` | Inventory Vision | Inventory, Procurement, AI | Staged receipt/label/shape review before inventory commit. | Similar staging lifecycle to intake; needs approval ownership. |

## Production

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `machines` | Machines / Production | Maintenance, Reports, Modbus | Machine config, capabilities, and operational state. | Machine state fields feed production and maintenance. |
| `workers` | Production | Kiosk, Admin | Worker/operator records. | Keep separate from internal `users` unless unified intentionally. |
| `scan_log` | Production | Reports, Audit | Barcode/card scan events. | Should remain append-only. |
| `shifts` | Production | Reports, Machines | Shift lifecycle. | Needed for KPI accuracy. |
| `downtime_reasons` | Production / Maintenance | Reports | Reason catalog for machine stops. | Shared taxonomy. |
| `machine_stops` | Production / Maintenance | Reports | Machine downtime events. | Must close active stops consistently. |
| `production_events` | Production | Realtime, Reports | Production event history. | Event naming/status contract needed. |
| `machine_state_log` | Machines / Production | Maintenance, Reports | Machine state transitions. | Should be append-only audit of state changes. |

## Inventory and Procurement

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `suppliers` | Procurement | Inventory, Finance | Supplier master data. | Inventory should reference but not own suppliers. |
| `raw_material` | Inventory | Production, Procurement, Reports | Material batches and stock. | Stock deduction and correction need single service owner. |
| `raw_material_usage` | Inventory | Production, Finance | Material consumption records. | Must be auditable; avoid silent quantity edits. |
| `purchase_orders` | Procurement | Inventory, Finance | Procurement requests and purchase order lifecycle. | Used for inventory shortage handoff. |

## Warehouse, Delivery, and Fleet

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `packages` | Warehouse | Logistics, Reports, Portal | Package/shipment grouping. | Status must align with item/order delivery status. |
| `delivery_notes` | Warehouse / Logistics | Portal, Finance, Reports | Delivery note documents and delivery proof. | Portal visibility and invoice timing may depend on this. |
| `deliveries` | Logistics | Fleet, Warehouse, Portal | Delivery lifecycle. | Delivery confirmation/problem flow affects customer visibility. |
| `drivers` | Fleet / Logistics | Delivery Admin | Driver records and location. | Some vehicle fields also exist for compatibility. |
| `vehicles` | Fleet | Drivers, Logistics | Vehicle master data. | Migration/compatibility logic exists separately. |
| `vehicle_events` | Fleet | Maintenance, Reports | Vehicle service/test/insurance/events. | `db/vehicleMigrations.js` rewrites this table. |
| `vehicle_documents` | Fleet | Admin, Compliance | Uploaded vehicle documents. | File retention and permission model should be explicit. |

## Quality, Maintenance, and Safety

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `quality_checks` | Quality | Production, Orders | Item/order quality checks. | Needs item status interaction rules. |
| `incidents` | Quality / War Room | Maintenance, Production, Reports | Operational incidents. | Owner naming should be clarified: quality vs war room. |
| `ncr` | Quality | Production, Reports | Non-conformance records. | Should link clearly to item/order/customer when relevant. |
| `capa` | Quality | Maintenance, Reports | Corrective/preventive actions. | Needs closure accountability. |
| `maintenance_logs` | Maintenance | Machines, Reports | Maintenance work log. | Machine state should not be changed only here without event. |
| `loto` | Maintenance / Safety | Production | Lockout/tagout records. | Safety-critical; enforce state and permissions. |
| `pm_schedule` | Maintenance | Machines, Reports | Preventive maintenance schedule. | Must coordinate with machine availability. |

## Project/Site Overlap

| Entity/Table | Owner Module | Shared Consumers | Purpose | Contract Risk |
| --- | --- | --- | --- | --- |
| `projects` | Customers / Finance | Orders, Portal | Project-level grouping. | Overlaps with `customer_sites`; V2 needs one contract. |
| `sites` | Customers / Delivery | Orders, Logistics | Delivery/project sites. | Overlaps with `customer_sites`; risk of duplicate site identity. |
| `customer_sites` | Customer Portal / Customers | Orders, Finance | Customer-managed project/site with budget and permissions. | Most current portal work uses this table. |

## Cross-Module Contract Decisions Needed

1. Decide whether `customer_sites`, `projects`, or `sites` is the long-term project/site source of truth.
2. Decide whether `credit_accounts` or `customer_credit` owns credit limit, exposure, and payment-term state.
3. Define which fields in `items` are owned by Orders, Production, Warehouse, Quality, and Finance.
4. Define whether customer portal auth remains in `portal_users` plus `customers.portal_token`, or moves fully into a portal identity model.
5. Split purchase price, sale price, customer quote, cost snapshot, and invoice amount into explicit contracts.
6. Treat `orders`, `items`, `customers`, `customer_sites`, `portal_users`, `pricing_price_items`, `invoices`, and `delivery_notes` as shared contract tables requiring serialized schema changes.
7. Replace scattered startup migrations with module-owned migrations before large-scale parallel development.

## Related Documents

- `PROJECT_MAP.md`
- `PROJECT_MODULES.md`
- `PROJECT_DEPENDENCY_GRAPH.md`
- `PROJECT_RISK_REPORT.md`
- `docs/entity-registry.md`
- `docs/api-registry.md`
- `docs/screen-registry.md`
