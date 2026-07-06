# Dead Code Audit - IronBend / Tene Industry

Date: 2026-07-05
Scope: documentation-only audit for reducing unused files and open cleanup risk.

## Executive Summary

Do not delete runtime code yet. The repo is mostly wired through explicit registries and tests, so a safe cleanup must start with documentation/mockup artifacts and deprecated entry screens, not routes or shared services.

Current blocking issue before any deletion campaign:

- `public/shape-editor.js` is modified but not committed.
- Full `npm test` is already failing because of that open mesh/shape-editor change.
- Resolve or quarantine that change before using test results as cleanup proof.

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

## Cleanup Candidates - Safe First Pass

These are candidates for a future deletion/archive commit, not deleted in this audit.

### A. Mockups With No Runtime Use

These are standalone mockup artifacts under `docs/mockups/`. They are not loaded by the app runtime.

Recommended action: move to `docs/archive/mockups/` or delete after visual decisions are confirmed.

| File | Evidence | Recommendation |
|---|---|---|
| `docs/mockups/login-preview.html` | no runtime refs found | archive/delete candidate |
| `docs/mockups/order-items-field.html` | no runtime refs found | archive/delete candidate |
| `docs/mockups/order-tracking.html` | no runtime refs found | archive/delete candidate |

### B. Mockups Still Referenced By Tasks/Docs

These are not runtime files, but they are referenced by tasks or specs. Delete only after the related feature is stable and approved.

| File | Evidence | Recommendation |
|---|---|---|
| `docs/mockups/pricing-manager.html` | referenced from `TASKS_V2.md` | keep until Pricing UI is accepted |
| `docs/mockups/shape-editor-v2-preview.html` | referenced from `TASKS_V2.md` | keep until Shape V2 direction is accepted |
| `docs/mockups/shape-editor-engineering-workspace.html` | referenced from `TASKS_V2.md` | keep until Shape editor replacement is accepted |
| `docs/mockups/order-detail.html` | filename collides with runtime CSS/class names; manual check needed | do not delete automatically |

### C. Unloaded Client Guard

| File | Evidence | Recommendation |
|---|---|---|
| `public/access-guard.js` | no `<script src="/access-guard.js">` runtime usage found; only spec references | decide: wire into screens or delete after permission model decision |

This file looks like planned access-control UI infrastructure, not live runtime. It should not remain half-owned forever.

### D. Deprecated / Frozen Public Screens

These are not safe to delete immediately because they are still documented, tested, or deep-linkable.

| File | Current state | Recommendation |
|---|---|---|
| `public/portal.html` | documented as deprecated; `customer.html` is active portal; still tested | product decision: remove, redirect, or rebuild on scoped endpoint |
| `public/supplier.html` | documented as frozen/partial supplier portal; still tested | keep frozen or remove after supplier module decision |
| `public/worker.html` | documented as tiny/partial worker entry | verify whether it intentionally redirects/wraps `worker-visual.html` |
| `public/docs.html` | internal documentation surface linked from admin | keep unless replaced by docs module/admin view |

### E. Tracked Non-Code Artifact

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

1. Resolve `public/shape-editor.js` dirty state.
2. Run full `npm test` and get a clean baseline.
3. Archive/delete first-pass mockups with no runtime refs:
   - `docs/mockups/login-preview.html`
   - `docs/mockups/order-items-field.html`
   - `docs/mockups/order-tracking.html`
4. Decide `public/access-guard.js`: wire it or remove it.
5. Decide deprecated portal surfaces:
   - `public/portal.html`
   - `public/supplier.html`
   - `public/worker.html`
6. Move `_order_import.xls` to a fixture/archive location or remove it.
7. After each small batch: run tests, commit with explicit paths, push.

## Suggested First Deletion Batch After Approval

Only after the dirty `shape-editor.js` is resolved:

```text
docs/mockups/login-preview.html
docs/mockups/order-items-field.html
docs/mockups/order-tracking.html
```

This batch is low risk because these files have no runtime references and are documentation/mockup artifacts only.

## Remaining Risk

- Static Express serving means public files may be opened by old bookmarks even when not linked.
- Some docs intentionally preserve architectural history; deleting docs/mockups may reduce context for future agents.
- Current test baseline is not clean because of the uncommitted `public/shape-editor.js` change.
