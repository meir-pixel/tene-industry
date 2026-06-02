# Architecture Diagram Notes

Date: 2026-06-01

Source files:

- `C:\Users\meir-tene\Downloads\02_מסמכים\ARCHITECTURE_STATUS_REPORT_V2.docx`
- `C:\Users\meir-tene\Downloads\02_מסמכים\כרך_י_Master_Architecture_Bible_Core_Integration_טנא_תעשיות_ברזל.docx`

## Extracted Architecture Direction

Volume 10 is the controlling architecture source. Its main rule is that every
business object, screen, API, event, permission, workflow, state machine, and KPI
must have one source of truth before code expands.

The architecture explicitly rejects:

- multiple screens for the same operation,
- duplicate naming for the same concept,
- fake 3D or placeholder industrial features,
- mixed screens that own unrelated workflows,
- permissions shown in UI but not enforced on the server,
- dashboards calculating KPIs from undefined sources,
- customer portals exposing data not marked as external safe.

## Status Report Snapshot

The architecture status report from 2026-05-31 recorded:

- 66% overall compliance with Volume 10.
- 46 DB tables.
- 177 API endpoints.
- 17 WebSocket events.
- 24 screens.

The report's critical/high issues included:

| Issue | Original status | Current recovery status |
| --- | --- | --- |
| `SEC-01` JWT missing / role header trust | Critical | Fixed for guarded routes through `auth-core.js`, `permissions.js`, and JWT route middleware |
| `SEC-03` public endpoint rate limits missing | Critical | Partially fixed: auth, customer portal, OCR/intake, and webhook boundaries now have rate limits |
| `DB-01` portal resolver exposed `SELECT *` | High | Fixed: portal resolver uses limited projection |
| `AUTH-02` most endpoints lacked role guards | High | Major Sprint 1 pass complete: 190 routes detected, 170 direct role-guarded, 20 public/customer/webhook/health/legacy exceptions |
| `TEST-01` no tests | Medium | Fixed baseline: `npm test` currently passes 50 tests |
| `UI-01` screens using old nav | Medium | Partially fixed by shared `nav.js`, `auth-client.js`, and first shared `safe-dom.js` helper |

## Conflicts With Current Codebase

- Current implementation still keeps many modules in `server.js`, while Volume
  10 expects module boundaries and registries to govern expansion.
- Several frontend screens still mix module responsibilities, especially
  `admin.html`, `dashboard.html`, `customers.html`, and `orders.html`.
- Status logic is now partially centralized in `status-contracts.js`, but more
  screens still contain hard-coded status labels and should be migrated.
- Dashboard production queue source has been corrected to `/api/production-queue`,
  but KPI registry ownership is still not fully formalized.
- There is still no full migrations framework; schema changes are handled by
  startup `CREATE TABLE` / `addCol` logic.

## Recovery Decisions Already Applied

- Created registries for APIs, entities, events, screens, permissions, modules,
  and recovery backlog.
- Implemented Sprint 1 security foundation before broad UI rebuilds.
- Created shared client auth and safe DOM helper contracts.
- Created shared status contract for order and production item states.
- Corrected dashboard production queue source to use the production queue API.

## Next Architecture Work

1. Create a formal workflow registry.
2. Create a formal state registry from `status-contracts.js` and machine state
   rules.
3. Create a KPI registry and align dashboard calculations to it.
4. Split `admin.html` into Platform Core admin plus module-specific screens.
5. Move route families out of `server.js` only after each route family has an
   explicit permission and state contract.
