# UI Stability Review

Date: 2026-06-24
Scope: existing UI stabilization review only. No business logic, API, database, permission, pricing, OCR, or production-flow changes are proposed here.

## Review Intent

This review identifies where the current UI is most likely to become unstable because styling is large, duplicated, or embedded directly inside screens. The goal is not to redesign IronBend. The safe path is to extract repeated visual rules gradually while preserving existing DOM, behavior, endpoints, and data contracts.

## Large UI Files

Largest frontend/UI files found under `public/`:

| File | Lines | Size | Stability note |
|---|---:|---:|---|
| `public/shape-editor.js` | 2,717 | 129.8 KB | High-touch visual/editor file. Changes can affect order intake, customer portal, OCR correction, and production shape display. |
| `public/index.html` | 2,707 | 106.2 KB | Main new-order workspace. Large embedded styles and UI logic in one file. |
| `public/intake.html` | 1,777 | 101.1 KB | OCR/intake review screen. Visually complex and business-sensitive. |
| `public/customer.html` | 1,601 | 80.2 KB | Customer portal. Contains portal UX, finance visibility, upload/document sections, and many inline styles. |
| `public/admin.html` | 1,554 | 83.2 KB | Admin/settings surface. Many inline styles and generated HTML blocks. |
| `public/customers.html` | 1,526 | 47.8 KB | CRM/customer management. Large embedded style block. |
| `public/orders.html` | 1,306 | 67.9 KB | Order detail/list UI. Contains approval/review workflows. |
| `public/pricing.html` | 1,295 | 49.4 KB | Document-like pricing editor. Styling should remain visually stable. |
| `public/dashboard.html` | 1,251 | 62.3 KB | Dashboard widgets and KPI layout; many inline styles. |
| `public/procurement.html` | 1,187 | 54.7 KB | Operational module with repeated cards, buttons, modals, and tables. |
| `public/quality.html` | 1,095 | 54.4 KB | Operational module with repeated card/modal/table patterns. |
| `public/docs.html` | 992 | 58.7 KB | Document area, moderate visual risk. |
| `public/maintenance.html` | 865 | 46.3 KB | Operational module with KPI/cards/modals. |
| `public/machine.html` | 865 | 47.4 KB | Machine view with dynamic status styling. |
| `public/kiosk.html` | 845 | 40.0 KB | Shop-floor UX; should be treated carefully because it is operator-facing. |
| `public/theme.css` | 620 | 23.7 KB | Existing shared style foundation. Best candidate for future safe extraction. |
| `public/nav.js` | 601 | 25.9 KB | Shared navigation behavior and styling hooks. Avoid casual edits. |

## Embedded CSS Hotspots

Screens with the largest `<style>` blocks:

| File | Embedded style lines | Inline `style=` attrs |
|---|---:|---:|
| `public/index.html` | 1,194 | 34 |
| `public/customers.html` | 785 | 4 |
| `public/pricing.html` | 468 | 0 |
| `public/supplier.html` | 376 | 2 |
| `public/admin.html` | 355 | 68 |
| `public/portal.html` | 307 | 3 |
| `public/login.html` | 289 | 1 |
| `public/intake.html` | 274 | 2 |
| `public/dashboard.html` | 273 | 62 |
| `public/orders.html` | 231 | 38 |
| `public/customer.html` | 229 | 48 |
| `public/warroom.html` | 203 | 22 |
| `public/machine.html` | 197 | 43 |
| `public/production-queue.html` | 169 | 6 |
| `public/warehouse.html` | 168 | 14 |

## Duplicated Styling

Repeated class names across embedded screen CSS suggest safe extraction candidates, but only after confirming visual parity screen by screen.

| Repeated selector | Screens using local definitions | Safe extraction potential |
|---|---:|---|
| `.btn-primary` | 19 | High. Extract button variants without changing markup. |
| `.btn` | 18 | High, but must preserve local sizing differences. |
| `.page` | 19 | Medium. Layout wrappers vary by screen; extract only base spacing first. |
| `.modal` | 15 | High value, medium risk. Modal behavior must remain untouched. |
| `.logo`, `.logo-icon` | 13-14 | Medium. Shared nav/logo already exists; avoid regressions in brand sizing. |
| `.card`, `.card-title`, `.card-header` | 7-13 | High. Extract base card visual rules, keep module-specific variants local. |
| `.badge` | 13 | High. Good token/component candidate. |
| `.modal-overlay`, `.modal-body`, `.modal-footer` | 7-12 | High value. Extract shell only, not modal content layout. |
| `.tabs`, `.tab-btn` | 7-10 | High. Extract standard tab visuals. |
| `.form-grid`, `.form-row`, `.field` | 7-10 | Medium. Form fields differ between dense admin and mobile portal screens. |
| `.kpi-card`, `.kpi-label`, `.kpi-val`, `.kpi-sub`, `.kpi-row` | 7-8 | High. Good candidate for dashboard/operations consistency. |
| `.empty` | 7 | High. Empty/loading state cleanup is low behavior risk. |

The existing test output already reports duplicated shared components such as `.btn`, `.tab-btn`, `.tabs`, `.card`, `.field`, `.modal`, `.table-wrap`, and `.badge`. That matches this scan and should be treated as the first cleanup lane.

## Risky Inline Styles

Files with the most inline style attributes and direct JS style mutations:

| File | `style=` attrs | `.style.` mutations | `innerHTML` usage | Risk note |
|---|---:|---:|---:|---|
| `public/admin.html` | 68 | 20 | 10 | Many generated admin/settings blocks. Extract visual classes first; do not alter settings logic. |
| `public/shape-editor.js` | 66 | 37 | 17 | High-risk editor. Avoid structural edits unless specifically scoped. |
| `public/dashboard.html` | 62 | 16 | 19 | KPI/status visuals are repeated; safe to extract display classes later. |
| `public/customer.html` | 48 | 18 | 21 | Portal permissions and price visibility make this risky. Visual-only extraction must be tightly reviewed. |
| `public/quality.html` | 46 | 2 | 18 | Operational status UI; extract cards/buttons only. |
| `public/holdings.html` | 46 | 0 | 4 | Visual cleanup candidate if module is active. |
| `public/machine.html` | 43 | 24 | 21 | Dynamic machine status styles; avoid changing status color logic. |
| `public/orders.html` | 38 | 0 | 13 | Approval/review UI. Do not touch order status behavior. |
| `public/kiosk.html` | 36 | 16 | 5 | Operator screen; prioritize stability and readability over refactor. |
| `public/index.html` | 34 | 39 | 7 | Main order entry. Any cleanup should be tiny and browser-verified. |
| `public/finance.html` | 33 | 2 | 26 | Finance data visibility and generated rows; visual classes only. |

Inline styles are not automatically wrong. The risky cases are generated HTML strings where style, data, and behavior are mixed together. Those should be cleaned only by replacing style attributes with existing/new classes while keeping the generated markup structure and event handlers unchanged.

## Safe Extraction Candidates

Recommended extraction order, from safest to more sensitive:

1. Buttons
   - Candidate selectors: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.btn-danger`, `.btn-success`, `.btn-sm`.
   - Safe method: add shared definitions to `public/theme.css`, then remove only duplicate identical rules from one screen at a time.
   - Do not rename classes.

2. Badges and status chips
   - Candidate selectors: `.badge`, `.danger`, `.success`, status pill variants.
   - Safe method: define shared color/spacing tokens and keep module-specific status labels local.
   - Do not change status text or status mapping logic.

3. Empty/loading states
   - Candidate selectors: `.empty`, `.empty-state`, `.loader`, muted placeholder blocks.
   - Safe method: centralize visual shell only.
   - Low business risk because these are presentation states.

4. Modal shell
   - Candidate selectors: `.modal`, `.modal-overlay`, `.modal-body`, `.modal-footer`.
   - Safe method: extract backdrop, spacing, radius, shadow, and responsive max-size.
   - Do not change open/close behavior, focus handling, IDs, or submit buttons.

5. KPI cards
   - Candidate selectors: `.kpi-card`, `.kpi-label`, `.kpi-val`, `.kpi-sub`, `.kpi-row`.
   - Safe method: extract base layout and typography. Leave colors driven by existing local variables or data classes.

6. Tabs
   - Candidate selectors: `.tabs`, `.tab-btn`, `.active` in tab context.
   - Safe method: use scoped shared selectors such as `.ib-tabs` only if a future approved change can update markup safely. Until then, avoid global `.active` changes.

7. Forms
   - Candidate selectors: `.form-grid`, `.form-row`, `.field`.
   - Safe method: extract only base label/input spacing after checking mobile. Forms differ between desktop admin, portal, and shop-floor screens.

## Proposed Stability Rules For Future Cleanup

- One cleanup PR/commit should touch one visual pattern or one screen, not the whole UI.
- Start with `theme.css` additions, then remove local duplicate rules only after visual comparison.
- Do not change IDs, `data-*` attributes, event handlers, fetch calls, or generated data fields.
- Do not change table columns, form field names, button actions, or modal submit flows.
- Prefer additive shared classes over renaming existing classes.
- Every extraction should be checked at desktop and mobile widths.
- For high-risk screens, use screenshots before/after and only accept no visible regression.

## Do-Not-Touch Areas

These areas should not be part of UI stabilization unless there is a separate explicit task:

- Business logic in `services/`, `routes/`, `db/`, `server.js`, and module contracts.
- API endpoints, request/response shapes, authorization checks, and portal token behavior.
- Database schema, migrations, seed data, and startup logic.
- Pricing calculations, price visibility, finance permissions, and customer portal money fields.
- OCR parsing, intake source comparison, document routing, and approval flows.
- Production status transitions, production card generation, barcode/token logic, and print card dimensions.
- Shape geometry calculations, normalization, weight formulas, and 3D/2D data contracts.
- Shared navigation behavior in `public/nav.js`, except for separately approved visual-only fixes.
- Auth/session behavior in `public/auth-client.js` and login/logout flow.
- `TASKS_V2.md` unless a task-management update is explicitly requested.

## Suggested First Approved Cleanup Package

If a future cleanup is approved, the safest first package would be:

- Add shared button, badge, empty-state, and KPI base styles to `public/theme.css`.
- Apply to one low-risk operational screen first, such as `public/procurement.html` or `public/warehouse.html`.
- Verify no JavaScript selectors depend on removed local class definitions.
- Run `npm test` plus browser screenshots for desktop and mobile.

This should reduce repeated styling without changing the product, workflows, APIs, or data behavior.
