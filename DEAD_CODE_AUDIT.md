# Dead Code Audit - IronBend / Tene Industry

Date: 2026-07-06
Scope: documentation-only audit for reducing unused files and open cleanup risk.

## Executive Summary

Do not delete runtime code yet. The repo is mostly wired through explicit registries and tests, so a safe cleanup must start with documentation/mockup artifacts and deprecated entry screens, not routes or shared services.

Current cleanup baseline:

- Full `npm test` was clean after the Shape V2 merge baseline.
- `public/shape-editor.js` is clean in git status.
- The first approved non-runtime mockup deletion batch was completed on 2026-07-06.

## Method Used

Checked tracked files with `git ls-files`, then searched usage across:

- runtime files: `server.js`, `routes/`, `services/`, `public/`, `modules/`, `jobs/`, `db/`, `scripts/`, `tools/`
- tests: `test/*.test.js`
- docs and registries: `PROJECT_MAP.md`, `PROJECT_MODULES.md`, `docs/*`, `TASKS_V2.md`, `shared/module-catalog.json`

Important limitation: Express serves all files under `public/`, so an unlinked public HTML file can still be opened directly. Those files need product approval before deletion.

## What Is Clearly Active

### Routes

All files under `routes/*.js` are currently registered in `server.js` route module mapping and/or mounted via `app.use(...)`. Do not delete routes in this cleanup pass.

Evidence:

- `server.js` requires route factories for all current route files.
- `server.js` keeps a `routeModules` list with each route file.
- `test/module-governance.test.js` checks that route modules stay registered.

### Services

Most services are directly required by `server.js`, `routes/*`, `jobs/scheduler.js`, or tests. Do not delete services in this cleanup pass.

Examples:

- `services/backup.js` is active through `jobs/scheduler.js` and server startup.
- `services/productionCards.js` and `services/productionCardPrintPage.js` are active in Production Cards printing.
- `services/intakeWorkflow.js`, `services/orders.js`, `services/pricer.js`, `services/portalAccess.js`, and `services/inventory.js` are active runtime dependencies.

### Main Screens

Screens in `public/nav.js` are active app surfaces and should not be deleted as dead code:

- `dashboard.html`
- `orders.html`
- `index.html`
- `intake.html`
- `customers.html`
- `production-queue.html`
- `worker-visual.html`
- `machine.html`
- `kiosk.html`
- `production-setup.html`
- `warehouse.html`
- `inventory.html`
- `procurement.html`
- `delivery-admin.html`
- `driver.html`
- `quality.html`
- `maintenance.html`
- `warroom.html`
- `reports.html`
- `finance.html`
- `profitability.html`
- `pricing.html`
- `projects.html`
- `holdings.html`
- `admin.html`

### Active Static Assets / Shell Files

Do not delete:

- `public/nav.js`
- `public/theme.css`
- `public/auth-client.js`
- `public/safe-dom.js`
- `public/offline.html`
- `public/sw.js`
- `public/manifest.json`
- `public/icon-192.png`
- `public/icon-512.png`
- `public/brand/tene-pdf-logo.jpg`
- `public/shape-editor.js`
- `public/shape-renderer.js`
- `public/rebar-weights.js`

## Completed Cleanup

### 2026-07-06 - Mockups With No Runtime Use

Deleted the first approved documentation/mockup batch after confirming these files had no runtime references:

| File | Evidence | Action |
|---|---|---|
| `docs/mockups/login-preview.html` | no runtime refs found | deleted |
| `docs/mockups/order-items-field.html` | no runtime refs found | deleted |
| `docs/mockups/order-tracking.html` | no runtime refs found | deleted |

## Cleanup Candidates

### A. Mockups Still Referenced By Tasks/Docs

These are not runtime files, but they are referenced by tasks or specs. Delete only after the related feature is stable and approved.

| File | Evidence | Recommendation |
|---|---|---|
| `docs/mockups/pricing-manager.html` | referenced from `TASKS_V2.md` | keep until Pricing UI is accepted |
| `docs/mockups/shape-editor-v2-preview.html` | referenced from `TASKS_V2.md` | keep until Shape V2 direction is accepted |
| `docs/mockups/shape-editor-engineering-workspace.html` | referenced from `TASKS_V2.md` | keep until Shape editor replacement is accepted |
| `docs/mockups/order-detail.html` | filename collides with runtime CSS/class names; manual check needed | do not delete automatically |

### B. Access Guard - Keep For Now

| File | Evidence | Recommendation |
|---|---|---|
| `public/access-guard.js` | no `<script src="/access-guard.js">` runtime usage found; only spec references | keep for now; revisit when the active permission model is wired into screens |

This file is planned access-control UI infrastructure, not live runtime. Keep it for now so the permission-model decision can be made intentionally instead of deleting a planned guard prematurely.

### C. Deprecated / Frozen Public Screens

These are not safe to delete immediately because they are still documented, tested, or deep-linkable.

| File | Current state | Recommendation |
|---|---|---|
| `public/portal.html` | documented as deprecated; `customer.html` is active portal; still tested | product decision: remove, redirect, or rebuild on scoped endpoint |
| `public/supplier.html` | documented as frozen/partial supplier portal; still tested | keep frozen or remove after supplier module decision |
| `public/worker.html` | documented as tiny/partial worker entry | verify whether it intentionally redirects/wraps `worker-visual.html` |
| `public/docs.html` | internal documentation surface linked from admin | keep unless replaced by docs module/admin view |

### D. Tracked Non-Code Artifact

| File | Evidence | Recommendation |
|---|---|---|
| `_order_import.xls` | tracked spreadsheet; no direct filename references found | move to `test/fixtures/` if it is a fixture, otherwise archive/delete after approval |

## Not Cleanup Targets

Do not remove these during a dead-code pass even if they look old:

- `server.js`: still the HTTP/bootstrap root.
- `jobs/scheduler.js`: active backup/email/alert scheduler.
- `services/backup.js`: active through scheduler.
- `routes/orderPrintA4.js`, `routes/orderDeliveryCertificate.js`, `routes/orderDocuments.js`: active document/printing routes.
- `public/shape-editor.js`: active across orders, intake, customer portal, and tests.
- `public/customer.html`: active customer portal.
- `public/worker-visual.html`: active worker card dashboard.
- `tene-license-server/*`: separate license-server subproject, not part of app cleanup.

## Recommended Cleanup Order

1. Decide `public/access-guard.js`: wire it or remove it.
2. Decide deprecated portal surfaces:
   - `public/portal.html`
   - `public/supplier.html`
   - `public/worker.html`
3. Move `_order_import.xls` to a fixture/archive location or remove it.
4. After each small batch: run tests, commit with explicit paths, push.

## Suggested Next Cleanup Batch

No additional file deletion is recommended without a product decision. The next cleanup decision should be `public/access-guard.js`: either wire it into the permission model or delete it after confirming it is no longer planned.

## Remaining Risk

- Static Express serving means public files may be opened by old bookmarks even when not linked.
- Some docs intentionally preserve architectural history; deleting docs/mockups may reduce context for future agents.
- Keep each future cleanup batch small and test-backed.
