# Role Model Decision

Working decision for Sprint 1. This document freezes the target direction unless a product-owner decision changes it.

Source:

- `IronBend_Permission_Matrix.docx`
- `docs/permission-registry.md`
- `docs/registry-reconciliation.md`
- `docs/api-route-permission-map.md`
- `server.js`
- `auth-core.js`

## Decision Summary

Use the source permission matrix as the product role baseline. Current code roles must be migrated or treated as external identities.

Internal staff roles:

- `admin`
- `manager`
- `office`
- `production`
- `quality`
- `maintenance`
- `warehouse`
- `driver`
- `sales`
- `viewer`
- `kiosk`
- `finance`

External identities:

- customer portal identity
- supplier portal identity

Do not use `customer` or `supplier` as broad internal staff roles.

## Target Internal Roles

| Role | Level | Decision |
| --- | ---: | --- |
| `admin` | 100 | Full system authority. Users, settings, database, all modules. |
| `manager` | 90 | Operational and business approval authority. No unrestricted DB upload unless explicitly granted. |
| `office` | 70 | Order desk, customers, documents, portal link administration, everyday business operations. |
| `finance` | 65 | Finance-sensitive reads/writes below manager/admin: ledgers, invoices, costs, margins, credit. |
| `production` | 50 | Production queue, machines, item status, shifts, production events. |
| `quality` | 50 | Quality checks, NCR, CAPA, inspection workflows. |
| `maintenance` | 50 | Maintenance logs, LOTO, PM schedule, machine stops. |
| `warehouse` | 30 | Inventory, receiving, packages, delivery notes, loading. |
| `driver` | 30 | Internal driver/dispatch role. External driver portal must be scoped separately. |
| `sales` | 20 | Customer/order/quote visibility with limited write rights. No finance or system settings. |
| `kiosk` | 15 | Narrow shop-floor station role. Can perform explicitly allowed production station actions only. |
| `viewer` | 10 | Read-only dashboards/reports where allowed. |

Why keep `finance`: the current product already has finance screens and endpoints, and commercial customers often need a finance user who is not a system admin or production manager.

## Current Code Role Mapping

| Current code role | Target treatment |
| --- | --- |
| `admin` | Keep, raise level to matrix model. |
| `manager` | Keep, raise level to matrix model. |
| `production` | Keep. |
| `operator` | Deprecate as a top-level role. Migrate to `kiosk` for station-only users or `production` for staff users. |
| `quality` | Keep. |
| `warehouse` | Keep. |
| `driver` | Keep for internal driver users only; do not use for public driver portal identity. |
| `finance` | Keep. Add to documented target roles. |
| `maintenance` | Keep. |
| `customer` | Remove from internal role model. Use scoped customer portal identity/session. |
| `supplier` | Remove from internal role model. Use scoped supplier portal identity/session. |

## Implementation Impact

`ROLE_PERMISSIONS` in `server.js` should become aligned with this model:
`ROLE_PERMISSIONS` now lives in `permissions.js`; remaining route work should
import/use that module rather than adding new local permission tables.

- `office`, `sales`, `viewer`, and `kiosk` are present in `permissions.js`
- `finance` is present in `permissions.js`
- `operator` is a migration alias to `kiosk`, not a privileged production role
- `customer` and `supplier` are not internal roles in `permissions.js`
- use matrix-like levels instead of the current 10/7/5 scale, or introduce named capabilities instead of relying only on numeric levels

Recommended migration stance:

- Existing users with `operator` should be treated as `kiosk` unless explicitly upgraded to `production`.
- Existing users with `customer` or `supplier` should not be allowed into internal APIs.
- Portal auth must use scoped customer/supplier sessions and ownership checks, not staff roles.

## Route Guard Implications

| Route family | Target roles |
| --- | --- |
| `/api/users*` | `admin` |
| `/api/settings*` | `admin`; optional `manager` read-only only after redaction |
| `/api/admin/database/*` | `admin` |
| `/api/audit-log` | `admin`, `manager` |
| `/api/customers*` | read: `office`, `sales`, `manager`, `admin`; pricing/token/credit: `office`, `manager`, `admin`; ledger: `finance`, `manager`, `admin` |
| `/api/orders*` | read: `office`, `sales`, `production`, `manager`, `admin`; create/update: `office`, `manager`, `admin`; production status: `production`, `manager`, `admin` |
| `/api/production-queue`, `/api/items/*`, `/api/shifts*`, `/api/machine-stops*` | `production`, `kiosk` for narrow station actions, `manager`, `admin` |
| `/api/finance/*`, `/api/credit*`, `/api/invoices*`, cost/margin routes | `finance`, `manager`, `admin` |
| `/api/quality*`, `/api/ncr*`, `/api/capa*` | `quality`, `manager`, `admin` |
| `/api/maintenance*`, `/api/loto*`, `/api/pm-schedule*` | `maintenance`, `manager`, `admin`; production may report stops |
| `/api/inventory*`, `/api/packages*`, `/api/delivery-notes*` | `warehouse`, `office`, `manager`, `admin`; driver only for scoped delivery actions |
| `/api/c/*` | customer-scoped portal auth, not staff roles |

## Sprint 1 Worker Rules

- Do not introduce route guards that rely on `customer` or `supplier` as internal roles.
- Do not trust `x-user-role` from browser clients for privileged access.
- Do not use `operator` for manager-like production permissions.
- When in doubt, allow fewer write roles and add explicit tests.

## Open Product Decisions

- Whether `sales` can create quotes/orders or remains read-mostly.
- Whether `office` can create portal tokens without manager approval.
- Whether `viewer` sees finance-free dashboards only or broader operational dashboards.
- Whether `kiosk` authenticates with user PIN, station PIN, device token, or a later kiosk-specific mechanism.
