# Registry Reconciliation

This document compares the first-pass markdown registries created from the
current codebase with the original registry DOCX files found in
`C:\Users\meir-tene\Downloads`.

Source registry files:

- `IronBend_API_Registry.docx`
- `IronBend_Entity_Registry.docx`
- `IronBend_Permission_Matrix.docx`
- `IronBend_Architecture_Diagram.docx`

The architecture diagram DOCX could not be parsed with the fast XML extractor
because its `word/document.xml` contains invalid XML for that parser. It should
be reviewed later through Word/visual extraction.

## API Registry

Original source summary:

- `IronBend_API_Registry.docx`
- 149 endpoints
- 34 endpoint groups
- Guards use: `admin`, `manager+`, `office+`, `production+`, `quality+`,
  `warehouse+`, `maintenance+`, `driver+`, and related role groups.

Original API groups:

1. Customers
2. Orders
3. Shapes
4. Machines
5. Scan
6. Dashboard & KPIs
7. Alerts
8. Settings
9. Companies
10. Drivers & Deliveries
11. Priority ERP
12. Intake AI
13. Suppliers
14. Inventory
15. Audit Log
16. Users
17. Quality
18. Maintenance
19. Projects & Sites
20. Credit & Finance
21. Shifts
22. Steel Prices
23. Packages
24. Delivery Notes
25. Production Queue
26. Invoices
27. CSV Export
28. BVBS Parser
29. Search
30. Reports
31. Admin
32. Health
33. Customer Portal
34. Price List

Current code evidence:

- `server.js` contains more than 100 route declarations in one file.
- The current markdown API registry is grouped by product module rather than
  by the original 34 API groups.

Reconciliation decision:

- Keep the markdown registry grouped by product module for agent ownership.
- Add original API group names as aliases when detailed route mapping begins.
- The next API task is to generate a route-by-route table with columns:
  `method`, `route`, `original_group`, `module_owner`, `expected_guard`,
  `current_guard`, `status`.

## Entity Registry

Original source summary:

- `IronBend_Entity_Registry.docx`
- 46 SQLite entities.

Original entity list:

1. `customers`
2. `orders`
3. `pallets`
4. `items`
5. `machines`
6. `shapes`
7. `workers`
8. `scan_log`
9. `drivers`
10. `deliveries`
11. `alerts`
12. `intake_log`
13. `settings`
14. `companies`
15. `price_list`
16. `suppliers`
17. `raw_material`
18. `raw_material_usage`
19. `audit_log`
20. `users`
21. `quality_checks`
22. `maintenance_logs`
23. `projects`
24. `sites`
25. `credit_accounts`
26. `credit_transactions`
27. `shifts`
28. `downtime_reasons`
29. `machine_stops`
30. `steel_price_history`
31. `packages`
32. `invoices`
33. `delivery_notes`
34. `production_events`
35. `machine_state_log`
36. `incidents`
37. `ncr`
38. `capa`
39. `loto`
40. `pm_schedule`
41. `purchase_orders`
42. `order_costs`
43. `cost_snapshots`
44. `customer_credit`
45. `financial_events`
46. `steel_prices`

Current code evidence:

- The first-pass markdown entity registry includes the original 46 plus current
  implementation extras such as:
  - `refresh_tokens`
  - `order_imports`
  - `intake_training_examples`

Reconciliation decision:

- Keep implementation extras in the markdown registry, but mark them as
  `implementation extension` where appropriate.
- The source entity registry remains the canonical business-entity list.
- Security/auth infrastructure entities such as `refresh_tokens` belong to
  Platform Core even if absent from the original business entity registry.

## Permission Matrix

Original source summary:

- `IronBend_Permission_Matrix.docx`
- 11 roles
- 48 operations
- 20 screens
- Explicit warning: current implementation uses `requireRole()` middleware that
  checks `x-user-role` header only; JWT was not yet implemented at the time of
  that document.

Original roles:

| Role | Source Level | Source Meaning |
| --- | ---: | --- |
| `admin` | 100 | Full administration, users, DB, system settings. |
| `manager` | 90 | Operations management, orders, customers, machines, reports, credit. |
| `office` | 70 | Orders, customers, invoices, deliveries; no financial reports/costs. |
| `production` | 50 | Production queue, item status, shifts, machine stops. |
| `quality` | 50 | QC, NCR, CAPA, LOTO, incidents; read orders. |
| `maintenance` | 50 | Maintenance log, PM, LOTO creation, incidents, machine read. |
| `driver` | 30 | Own deliveries, GPS, delivery status, signature. |
| `warehouse` | 30 | Packages and inventory; no orders/customers. |
| `sales` | 20 | Read-only customers, orders, price list. |
| `viewer` | 10 | Read-only dashboard and orders. |
| `kiosk` | 15 | Workstation only: barcode scan and item status, no business data. |

Current code evidence:

- `server.js` currently defines roles:
  - `admin`
  - `manager`
  - `production`
  - `operator`
  - `quality`
  - `warehouse`
  - `driver`
  - `finance`
  - `maintenance`
  - `customer`
  - `supplier`

Key mismatch:

- Source has `office`, `sales`, `viewer`, `kiosk`.
- Code has `operator`, `finance`, `customer`, `supplier`.
- Source levels are 100/90/70/50/30/20/15/10; code levels are 10/7/6/5/4/3/2/1.
- Source explicitly calls out the same security problem already found in code:
  spoofable `x-user-role` instead of verified JWT enforcement.

Reconciliation decision:

- Do not treat current code roles as final product roles.
- Use the source permission matrix as the target role model.
- Map current code roles to source roles during Sprint 1:
  - `operator` -> likely `kiosk` or `production` depending screen context.
  - `finance` -> keep as an added role or fold into `manager`/`office` after
    finance requirements are reviewed.
  - `customer` and `supplier` -> external portal identities, not internal staff
    roles.

## Required Doc Updates

1. Update `permission-registry.md` to show source roles vs current code roles.
2. Update `api-registry.md` to mention original 34 API groups.
3. Update `entity-registry.md` to distinguish source entities from
   implementation extensions.
4. Add a future task to parse/review `IronBend_Architecture_Diagram.docx`
   visually or through a more tolerant DOCX reader.

## Sprint 1 Impact

Sprint 1 must not merely "turn on auth". It must reconcile the role model first:

1. Decide the target internal roles from the Permission Matrix.
2. Decide how external identities (`customer`, `supplier`, `driver`, kiosk
   station) are represented.
3. Replace `x-user-role` fallback with verified JWT/portal identity.
4. Protect routes according to the API registry guard groups.
5. Add route permission tests for at least admin, manager, office, production,
   warehouse, finance/manager, driver, and kiosk scenarios.
