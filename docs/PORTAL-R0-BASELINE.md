# PORTAL-R0 — Reality Engine and adversarial baseline

Date: 2026-08-20  
Branch: `codex/standalone-ring-editor`  
Baseline HEAD: `ed77e10140917c6519786399ad7234ce6c9ead05`

## Executive result

The portal is **not ready for production use**. The final Reality Engine run exercised the real Express application, real `/api/c/*` routes, real `public/customer.html`, and a temporary seeded SQLite database. It finished with **16 passed and 13 failed out of 29 browser scenarios**. The failures are retained as the honest product baseline; no product bug was fixed in this work.

There are no identified P0 issues in this pre-production baseline. The P1 blockers are:

1. Normal shaped-bar quote/order payloads do not match the server shape contract; order submission reproduces `shape type is not supported`.
2. An authorized approver cannot see the approval CTA, so the order cannot advance through the browser.
3. Empty/zero quantity is silently changed to `1` and persisted.
4. Rapid double submit creates two orders for one customer intent.
5. The source-document control displays an attachment but sends only its filename; the file is not persisted.
6. Five semantic customer statuses have no valid active timeline step.

## A. Captured baseline

The branch was already one commit ahead of `origin/codex/standalone-ring-editor`. Before PORTAL-R0 work, the working tree also contained three staged user-owned changes, which were preserved and excluded from this commit:

- `public/shape-editor.js`
- `public/sw.js`
- `test/shape-geometry.test.js`

Existing npm scripts at baseline were:

`start`, `start:local`, `dev`, `pm2`, `pm2:stop`, `pm2:logs`, `pm2:save`, `test`, `test:auth`, `test:client`, `test:intake`, `test:modules`, `test:security`, `test:smoke`, `test:status`, `auth:migrate:dry-run`, and `auth:migrate`.

Existing portal-focused Node tests were:

- `test/customer-portal-item-description.test.js`
- `test/customer-portal-safe-projection.test.js`
- `test/customer-portal-shape-builder-contract.test.js`
- `test/customer-workbench-contract.test.js`
- `test/permissions.test.js`
- `test/security-routes.test.js`
- `test/status-contracts.test.js`

The customer portal implementation was centered on:

- `public/customer.html` — current customer application
- `public/portal.html` — deprecated public lookup application, still shipped
- `routes/portal.js` and `routes/portalAdmin.js`
- `services/portalAccess.js`
- `services/customerPortalStatus.js`
- `services/customerPortalProjection.js`
- `services/customerPortalShapeDraft.js`
- `server.js`, which mounts the portal router under `/api`

`routes/portal.js` exposes real customer auth, password, user, profile, site, finance, order-history, shape, price-list, document, quote, order, approval, print, and order-detail routes under `/api/c/*`.

No browser E2E framework, Playwright/Cypress dependency, browser test directory, or browser-test npm script existed at the captured HEAD. The existing green Node tests therefore did not establish browser usability.

## B. Reality Engine architecture

Playwright `1.62.1` was added with one Chromium project, one worker, no retries, a 45-second test timeout, Hebrew locale, Jerusalem timezone, 1366×900 default viewport, screenshots only on failure, and traces/videos retained on failure. The mobile journey explicitly uses 390×844.

`scripts/run-portal-e2e.js` reserves a free loopback port, creates a unique OS temporary directory, seeds a new SQLite file, boots the application, runs Playwright, and removes the temporary DB directory in `finally`. The seeder refuses to overwrite an existing DB path. It applies the real schema/migrations and deterministic seed data.

The seed contains:

- customer Alpha: price-visible, multi-site
- customer Beta: price-hidden, one-site
- orderer, approver, combined, finance, field-manager, customer-admin, and expired-token users
- fixed test tokens and a deterministic test password
- tenant-scoped sites and user-site assignments
- orders for all nine semantic customer statuses
- an awaiting-approval order without approver permission and a customer-B private order

`test/e2e/support/start-portal-server.js` imports and starts the real `server.js` on the reserved loopback port with `NODE_ENV=test`, `DB_PATH` pointed at the seeded temporary database, external AI/license features disabled, and a captured server log. Production rate limiting is unchanged; only the test environment raises the action-limit allowance so one deterministic single-IP suite can complete.

The reusable Reality fixture captures every browser `console.error`, uncaught page error, failed core request, and `/api/c/*` response with status, response body, method, URL, and request ID. Unexpected console/page errors, failed core requests, and unexpected HTTP errors fail the test. Expected negative-path responses must be allow-listed in the individual scenario. Every scenario writes network evidence; every failed scenario also retains screenshot, trace, video, DOM error context, and any Reality-guard failure list.

The round-trip scenario encodes the core rule:

> UI → API → DB → UI must agree.

It submits through the real page, waits for the real API response, queries SQLite directly, compares order/item/site/delivery/quantity/shape data, reopens the order in the UI, reloads the page, and compares the customer-visible values again.

## C. Commands

```text
npx playwright install chromium
npm run test:e2e:portal
npm run test:e2e:portal:headed
npm run test:portal:scan
node --check <PORTAL-R0 JavaScript files>
npm test
```

The runner forwards Playwright CLI filters, for example:

```text
node scripts/run-portal-e2e.js test/e2e/portal-auth.spec.js
node scripts/run-portal-e2e.js test/e2e/portal-adversarial.spec.js --grep "thirteen sides"
```

## D. Final journey matrix

| Area | Scenario | Result | Product observation |
|---|---|---:|---|
| Auth | Valid token/link | PASS | Real token opens the portal |
| Auth | Password login | PASS | Real password route issues a session |
| Auth | OTP login | PASS | Real test-mode OTP request/verify works |
| Auth | Invalid token explanation | FAIL | Generic auth screen; no rejection toast/explanation |
| Auth | Expired token explanation | FAIL | Generic auth screen; no expiry toast/explanation |
| New order | Normal desktop shaped bar, quote, submit | FAIL | Quote: `length must be positive`; submit: `shape type is not supported` |
| New order | 390px critical journey | FAIL | No horizontal overflow, but submission hits the same shape error |
| Persistence | UI → API → DB → UI | PASS | Order and item values agree after submit/reopen/reload using `custom_bar` to isolate the known shape-name defect |
| Approval | Authorized approval and persisted advance | FAIL | `customerCanApprove=true`, but CTA is absent |
| Approval | Unauthorized CTA/backend guard | PASS | CTA absent and direct API attempt is forbidden |
| Permissions | Orderer price/finance hiding | PASS | Price and finance-only information hidden |
| Permissions | Customer A/B order and site isolation | PASS | Cross-tenant order denied; foreign site unavailable |
| Permissions | One-site versus multi-site project control | PASS | Fixed site versus scoped picker rendered correctly |
| Timeline | `draft` | FAIL | No active step |
| Timeline | `submitted_review` | FAIL | No active step |
| Timeline | `needs_info` | FAIL | No active step |
| Timeline | `awaiting_customer_approval` | PASS | Valid active step |
| Timeline | `approved` | PASS | Valid active step |
| Timeline | `in_production` | PASS | Valid active step |
| Timeline | `ready_for_delivery` | FAIL | No active step |
| Timeline | `delivered` | PASS | Valid active step |
| Timeline | `cancelled` | FAIL | No active step |
| Adversarial | Empty/zero quantity | FAIL | Input becomes 1 and an order is persisted |
| Adversarial | Quantity above 100,000 | PASS | 400 is visible and no order is persisted |
| Adversarial | Custom bar with 13 sides | PASS | 400 `too many sides`; no order is persisted |
| Adversarial | Rapid double submit | FAIL | Two orders are persisted |
| Adversarial | Source document attachment | FAIL | Filename shown/noted; no file bytes persisted |
| Adversarial | Refresh and browser Back | PASS | Authenticated context remains usable |
| Adversarial | Missing diameter price | PASS | Actionable 409 is visible and no bad order is stored |

Final result: **16 passed, 13 failed, 0 flaky, 0 skipped**.

## E. Complete bug baseline

### PORTAL-R0-001 — P1 — shaped-bar contract blocks quote and submission

- **Screen:** New Order, desktop and 390px mobile.
- **Role:** Customer approver with create-order and price visibility.
- **Exact reproduction:** Open the portal via the seeded valid link; start an order; select an Alpha site; edit the normal straight bar to 1,250 mm; set Ø12, quantity 7, delivery data and notes; request a quote; submit.
- **Expected:** A priced quote appears, one order is persisted, and success is visible.
- **Actual:** `POST /api/c/quote` returns 400 `length must be positive`; `POST /api/c/order` returns 400 with code `unsupported_shape_type` and message `shape type is not supported`. No normal shaped-bar order is created.
- **Screenshot/trace evidence:** `portal-order.spec.js` normal-browser failure and `portal-mobile.spec.js` 390px failure under `test-results/portal-e2e/artifacts/`; each contains `test-failed-1.png`, `trace.zip`, `video.webm`, and `error-context.md`.
- **Network/console evidence:** Each failure directory contains `attachments/network-evidence-*.json`; it records the two real 400 responses and request IDs. Expected browser resource errors are explicitly classified, not ignored globally.
- **Suspected code location:** `public/customer.html:1841-1846,1889-1901` sends legacy/top-level shape fields and Hebrew shape names; `services/customerPortalShapeDraft.js:98-120` accepts English aliases and expects straight geometry under `data`/`shapeDraft.data`.
- **Data impact:** Customer cannot price or submit the normal item; no order is persisted for this journey.
- **Required regression:** Real desktop and 390px UI journeys must quote, submit exactly one order, validate DB shape/quantity/price, reopen, and match the UI.

### PORTAL-R0-002 — P1 — empty/zero quantity becomes one and is persisted

- **Screen:** New Order item row.
- **Role:** Customer approver/order creator.
- **Exact reproduction:** Clear the quantity or enter `0`, blur the control, complete the order, and submit.
- **Expected:** Preserve the invalid value, display validation, and persist nothing.
- **Actual:** The field silently changes to `1`; submission succeeds; DB contains quantity 1.
- **Screenshot/trace evidence:** `portal-adversarial.spec.js` “empty and zero quantity…” failure artifacts.
- **Network/console evidence:** The network JSON records a successful real `POST /api/c/order`; DB assertion proves the unexpected row.
- **Suspected code location:** `public/customer.html:1688-1691`, specifically `+this.value||1`.
- **Data impact:** Silent quantity corruption and unintended financial/production order.
- **Required regression:** Empty and zero values must remain invalid, show a message, produce no API success, and create no DB rows.

### PORTAL-R0-003 — P1 — rapid submit creates duplicate orders

- **Screen:** New Order submit action.
- **Role:** Customer approver/order creator.
- **Exact reproduction:** Complete a valid isolated `custom_bar` order and double-click “שלח הזמנה ✓” with a 20 ms interval.
- **Expected:** One customer intent creates exactly one order.
- **Actual:** Two successful requests persist two distinct orders.
- **Screenshot/trace evidence:** `portal-adversarial.spec.js` “rapid double submit…” failure artifacts.
- **Network/console evidence:** Network JSON contains both successful order requests; direct DB count is 2.
- **Suspected code location:** `public/customer.html:1879-1903` has no in-flight lock/disabled button; `routes/portal.js:919-1019` has no client idempotency key or uniqueness guard.
- **Data impact:** Duplicate operational and billing records, duplicate confirmations, and possible duplicate production.
- **Required regression:** Double-click and repeated identical POST must resolve to one persisted order and one visible confirmation.

### PORTAL-R0-004 — P1 — source-document control discards file content

- **Screen:** New Order source-document attachment.
- **Role:** Customer order creator.
- **Exact reproduction:** Attach deterministic `customer-source-order.pdf`, observe its displayed filename, submit, and query document/intake storage.
- **Expected:** The source file bytes, MIME type, original name, and order relationship are persisted.
- **Actual:** Order succeeds, only the filename is appended to notes, and no source record/bytes exist in `intake_log`.
- **Screenshot/trace evidence:** `portal-adversarial.spec.js` “source document attachment…” failure artifacts.
- **Network/console evidence:** Network JSON shows the successful JSON-only order POST; DB query finds no `original_data_url` record.
- **Suspected code location:** `public/customer.html:1785-1799,1885-1901` retains name/type metadata in memory but submits only names inside notes.
- **Data impact:** Customer believes source evidence was attached while the factory cannot retrieve it.
- **Required regression:** Upload a known PDF, submit, verify stored bytes/hash/name/MIME/order link, download it, and compare bytes.

### PORTAL-R0-005 — P1 — authorized customer approval CTA is hidden

- **Screen:** Order Detail for `awaiting_customer_approval`.
- **Role:** Customer approver; API projection reports `customerCanApprove=true`.
- **Exact reproduction:** Open seeded `R0-AWAITING-001` with the approver link.
- **Expected:** Approval CTA is visible; click advances DB status; reopen shows advanced status and no CTA.
- **Actual:** CTA is absent, so no approval request or state transition occurs.
- **Screenshot/trace evidence:** `portal-approval.spec.js` authorized-approver failure artifacts.
- **Network/console evidence:** Network JSON shows a successful order-detail response with no subsequent approve POST because the UI exposes no action.
- **Suspected code location:** `services/customerPortalProjection.js:52-69` deliberately returns display label `ממתינה לאישורך` plus semantic `customerStatus`; `public/customer.html:1467,1520-1531` ignores `customerCanApprove`/semantic status and compares the display value to legacy `ממתינה לאישור לקוח`.
- **Data impact:** Customer-confirmation gate is blocked in the browser.
- **Required regression:** Assert CTA from `customerCanApprove`, click real approval endpoint, verify exact DB transition, reload/reopen, and assert CTA removal.

### PORTAL-R0-006 — P2 — invalid and expired links have no actionable explanation

- **Screen:** Portal entry/authentication.
- **Role:** Anonymous customer with invalid or expired link.
- **Exact reproduction:** Open `customer.html?token=definitely-invalid-r0` or the deterministic expired token.
- **Expected:** Remain unauthenticated and visibly explain invalid/expired access.
- **Actual:** The generic auth form appears with an empty toast and no reason.
- **Screenshot/trace evidence:** Both invalid-token and expired-token failures in `portal-auth.spec.js`.
- **Network/console evidence:** Per-test network JSON records the rejected auth validation without unexpected page errors.
- **Suspected code location:** Initial token validation/error handling in `public/customer.html` auth bootstrap.
- **Data impact:** No unauthorized access observed; customer support/recovery burden and confusing UX.
- **Required regression:** Invalid and expired tokens must show distinct, accessible messages and issue no authenticated session.

### PORTAL-R0-007 — P1 — timeline does not consume the semantic status contract

- **Screen:** Order Detail timeline.
- **Role:** Authenticated customer order viewer.
- **Exact reproduction:** Open seeded orders for each semantic customer status.
- **Expected:** The projected badge is correct and exactly one timeline step is active for every semantic status.
- **Actual:** `draft`, `submitted_review`, `needs_info`, `ready_for_delivery`, and `cancelled` render zero active steps. The other four statuses pass.
- **Screenshot/trace evidence:** Five failing `portal-timeline.spec.js` result directories, one per status.
- **Network/console evidence:** Each network JSON contains a successful order-detail API response; failure is deterministic UI mapping, not transport.
- **Suspected code location:** `services/customerPortalStatus.js:5-38` defines nine semantics; `public/customer.html:1390-1397,1467-1474` defines six Hebrew-keyed steps and searches display text fragments.
- **Data impact:** Customers see incomplete or misleading lifecycle state and next action.
- **Required regression:** Table-driven browser coverage for all nine semantic values, one active step each, using semantic keys rather than localized labels.

### PORTAL-R0-008 — P2 — deprecated demo portal is still publicly shipped

- **Screen:** Deprecated `public/portal.html` lookup page.
- **Role:** Public/anonymous.
- **Exact reproduction:** Load the static artifact and search for sample codes `1042` or `1055`.
- **Expected:** Deprecated public lookup artifact and demo customer/order data are absent from the shipped public surface.
- **Actual:** `DEMO_ORDERS` contains named sample companies, dates, phone, items, and timelines, and is returned directly for matching codes.
- **Screenshot/trace evidence:** Static scanner finding; this is separate from E2E failures.
- **Network/console evidence:** No API call is required for a matching demo code because the response is local static data.
- **Suspected code location:** `public/portal.html:416-474`.
- **Data impact:** Misleading/stale customer experience and an unnecessary deprecated public surface; the values appear synthetic, not production data.
- **Required regression:** Static scan must reject deprecated portal/demo identifiers and a browser check must confirm only the supported authenticated portal is shipped.

## F. Integrity scanner result

`npm run test:portal:scan` reports separately and does not alter the E2E result. Final scan: **14 findings — 4 errors and 10 warnings**.

- Errors: filename-only source upload; deprecated `public/portal.html`; two `DEMO_ORDERS` references.
- Warnings: nine Hebrew business-state comparisons in `public/customer.html` and one in `routes/portal.js`.
- No obvious dead `href="#"` or detectable missing inline `onclick` target was found.
- Machine-readable and Markdown reports are written under `test-results/portal-integrity/`.

## G. Test and artifact status

- Relevant portal/security/status Node subset: **170/170 passed**.
- Full repository Node suite: **740 passed, 3 failed, 743 total**. The three failures are in the pre-existing staged shape-editor work (`test/shape-geometry.test.js`): bench preset 3D/schedule elevation, bench production-card classification, and the expected shape-editor cache version (`v=66` versus current `v=61`). PORTAL-R0 did not modify those staged files.
- PORTAL-R0 JavaScript syntax checks: passed.
- Reality Engine: **16 passed, 13 failed, 29 total**; failures are the product baseline described above.

Artifacts are intentionally gitignored and are regenerated on every run:

- `test-results/portal-e2e/results.json` — machine-readable result summary
- `test-results/portal-e2e/html/index.html` — browsable Playwright report
- `test-results/portal-e2e/server.log` — real server log
- `test-results/portal-e2e/seed-manifest.json` — deterministic seed manifest without a retained DB
- `test-results/portal-e2e/artifacts/<test>/` — network JSON for every test; screenshot, trace, video, and DOM context for failures
- `test-results/portal-integrity/findings.json` and `findings.md` — scanner output

The isolated temporary SQLite database and backup directory are deleted after each run. No production or developer database is migrated, seeded, or retained.

## H. PORTAL-R0 changed paths

- `.gitignore`
- `package.json`
- `package-lock.json`
- `playwright.config.js`
- `scripts/run-portal-e2e.js`
- `scripts/portal-integrity-scan.js`
- `server.js` (test-environment rate-limit allowance only)
- `test/e2e/support/db.js`
- `test/e2e/support/portal.js`
- `test/e2e/support/reality-test.js`
- `test/e2e/support/seed-portal-db.js`
- `test/e2e/support/start-portal-server.js`
- `test/e2e/portal-auth.spec.js`
- `test/e2e/portal-order.spec.js`
- `test/e2e/portal-approval.spec.js`
- `test/e2e/portal-permissions.spec.js`
- `test/e2e/portal-timeline.spec.js`
- `test/e2e/portal-mobile.spec.js`
- `test/e2e/portal-adversarial.spec.js`
- `docs/PORTAL-R0-BASELINE.md`

