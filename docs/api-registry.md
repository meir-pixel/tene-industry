# API Registry

Source-of-truth registry required by Volume 10. Current routes are implemented
inside `server.js`; this file assigns each route family to a module and records
security posture.

The original `IronBend_API_Registry.docx` defines 149 endpoints across 34 API
groups. This markdown registry is grouped by product module for agent ownership;
the original 34 group names should be preserved as aliases during the route by
route reconciliation.

Original API groups:

Customers, Orders, Shapes, Machines, Scan, Dashboard & KPIs, Alerts, Settings,
Companies, Drivers & Deliveries, Priority ERP, Intake AI, Suppliers, Inventory,
Audit Log, Users, Quality, Maintenance, Projects & Sites, Credit & Finance,
Shifts, Steel Prices, Packages, Delivery Notes, Production Queue, Invoices, CSV
Export, BVBS Parser, Search, Reports, Admin, Health, Customer Portal, Price List.

Security posture values:

- `public`: intentionally public.
- `auth-required`: must have authenticated user.
- `role-required`: must require a named role.
- `portal`: external user/session/token model.
- `unsafe-current`: currently not safe enough for production.

## Platform Core

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/auth/login` | Platform Core | public with rate limit | Present. |
| `/api/auth/refresh` | Platform Core | refresh cookie | Present. |
| `/api/auth/logout` | Platform Core | refresh cookie | Present. |
| `/api/users*` | Platform Core | role-required: admin | Unsafe-current: routes are not consistently protected. |
| `/api/settings*` | Platform Core | role-required: admin | Unsafe-current until auth enforcement is active. |
| `/api/settings/test/:service` | Platform Core | role-required: admin | Can touch external services/secrets. |
| `/api/audit-log` | Platform Core | role-required: manager/admin | Audit visibility should be permissioned. |
| `/api/search` | Platform Core | auth-required | Cross-module data exposure risk. |
| `/api/admin/database/download` | Platform Core | role-required: admin | Critical. Must not rely on spoofable role headers. |
| `/api/admin/database/upload` | Platform Core | role-required: admin + maintenance flag | Critical. Upload flag exists; auth still must be real. |
| `/api/health` | Platform Core | public | Keep minimal. |

## Orders

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/customers*` | Orders / CRM | auth-required; writes manager/admin | Customer data exposure. |
| `/api/orders*` | Orders | auth-required; writes role-gated | Status/write routes need protection and tests. |
| `/api/order-imports/*` | Orders | role-required: manager | Import approval changes production data. |
| `/api/items*` | Orders / Production | auth-required; writes role-gated | Shared ownership with Production. |
| `/api/shapes*` | Orders | auth-required | Shape seed/write should be admin/manager. |
| `/api/intake/*` | Orders | role-required: manager | External/OCR content, approval creates orders. |
| `/api/bvbs/*` | Orders | role-required: manager | Import parser/order creation. |
| `/api/priority/*` | Orders / Integrations | role-required: admin/manager | Feature-flagged; keep frozen until core safe. |

## Production

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/production-queue` | Production | auth-required | Should be the only production queue source. |
| `/api/production-events` | Production | auth-required | Event reader contract needed. |
| `/api/machines*` | Production | auth-required; config admin/manager | Config/assignment/state writes are critical. |
| `/api/workers*` | Production | auth-required | Worker identity model needed. |
| `/api/scan` | Production | shop-floor auth TBD | Must not be anonymous in production. |
| `/api/shifts*` | Production | auth-required | Needs state machine/audit. |
| `/api/downtime-reasons` | Production | auth-required | Read low risk; writes absent currently. |
| `/api/machine-stops*` | Production | auth-required | Operational event; needs audit. |
| `/api/kpi/tons-today`, `/api/kpi/shift-summary` | Production | auth-required | Dashboard data. |
| `/api/machines/oee` | Production | auth-required | Dashboard/reporting. |

## Inventory, Procurement, Delivery

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/suppliers*` | Inventory | auth-required; writes manager | Supplier data. |
| `/api/inventory*` | Inventory | auth-required; writes warehouse/manager | Stock changes must be audited. |
| `/api/steel-prices*` | Finance / Inventory | role-required: finance/manager | Impacts pricing/costing. |
| `/api/purchase-orders*` | Inventory | role-required: procurement/manager | Stub/partial module. |
| `/api/drivers*` | Delivery | auth-required; writes dispatch/manager | Driver portal split needed. |
| `/api/deliveries*` | Delivery | auth-required or driver portal | Delivery state changes need auth/audit. |
| `/api/packages*` | Delivery | auth-required | Package/order status coupling risk. |
| `/api/delivery-notes*` | Delivery | auth-required | Document issuance. |

## Finance

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/price-list*` | Finance | role-required: finance/manager for writes | Sensitive pricing. |
| `/api/orders/:id/margin` | Finance | role-required: finance/manager | Sensitive profitability. |
| `/api/orders/:id/costs*` | Finance | role-required: finance/manager | Some role checks exist. |
| `/api/customers/:id/ledger` | Finance | role-required: finance/manager | Sensitive account data. |
| `/api/customers/:id/credit` | Finance | role-required: manager | Some role check exists. |
| `/api/credit*` | Finance | role-required: finance/manager | Credit changes sensitive. |
| `/api/invoices*` | Finance | role-required: finance | Financial state changes. |
| `/api/finance/*` | Finance | role-required: finance/manager | Sensitive KPIs/events. |
| `/api/export/orders`, `/api/export/inventory`, `/api/export/packages` | Reporting | role-required by data type | Exports can leak data. |

## Quality, Maintenance, War Room

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/quality*` | Quality | auth-required | Quality writes need audit. |
| `/api/maintenance*` | Maintenance | auth-required | Stub/partial screen. |
| `/api/incidents*` | War Room | auth-required | Incident workflow needs state model. |
| `/api/ncr*` | Quality | auth-required | NCR state machine needed. |
| `/api/capa*` | Quality | auth-required | CAPA state machine needed. |
| `/api/loto*` | Maintenance / Safety | role-required: maintenance/manager | Safety-critical. |
| `/api/pm-schedule*` | Maintenance | auth-required | Prevent unauthorized maintenance scheduling. |

## External Portals And AI

| Route Family | Module | Expected Security | Current Concern |
| --- | --- | --- | --- |
| `/api/c/*` | Portals | customer-scoped token + OTP bootstrap | Customer ownership, OTP bootstrap, rate limits, and token expiry/revocation are implemented; browser smoke tests remain. |
| `/api/customers/:id/token` | Portals / Admin | role-required: office/manager/admin | Generates customer access link with expiry metadata. |
| `/api/customers/:id/token/rotate` | Portals / Admin | role-required: office/manager/admin | Rotates customer access link and invalidates the previous token. |
| `/api/customers/:id/token` DELETE | Portals / Admin | role-required: office/manager/admin | Revokes customer portal access link. |
| `/api/ai/*` | AI | role-required + feature flag | Keep frozen until governance/data confidence exists. |
| `/api/analyze-image` | Orders / AI | role-required: manager when enforcement on | Feature-flag/security gate needed. |

## Sprint 1 Security Targets

1. Protect `/api/users*`.
2. Protect `/api/settings*`, `/api/audit-log`, and database admin routes.
3. Remove spoofable `x-user-role` trust from privileged flows.
4. Add stable `JWT_SECRET` deployment requirement.
5. Add tests proving anonymous and wrong-role users cannot call protected routes.
